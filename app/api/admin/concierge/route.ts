import { env } from 'cloudflare:workers';
import { asError, ensureSchema, getDb, getFiles, requireProjectLead, requirePublisher, requireStaff } from '../../../../db';
import { memberAccess } from '../../../../lib/access-control';
import { analyzeConversation, createEmployeeReply, type TranscriptMessage } from '../../../../lib/conversation-assist';
import { contentChecksum } from '../../../../lib/embedding-provider';
import { SEMANTIC_PROMPT_VERSION, type EmployeeReplyDraft, type SemanticSnapshot } from '../../../../lib/model-contracts';
import { routeModelComplexity } from '../../../../lib/model-routing';
import { createRuntimeModel, ModelProviderError, type ModelProviderName } from '../../../../lib/model-provider';
import { classifyRisk, safeJson } from '../../../../lib/public-domain';
import { readJsonBody } from '../../../../lib/request-body';
import { cleanupExpiredConversations } from '../../../../lib/conversation-lifecycle';
import { buildStaffWorkspaceView, STAFF_WORKSPACE_CONTRACT_VERSION, staffQueueSummary } from '../../../../lib/staff-workspace';
import { visionContext, type VisionSnapshot } from '../../../../lib/vision-analysis';

const LEAD_STATUSES = ['new', 'reviewing', 'contacted', 'qualified', 'closed'] as const;
const KNOWLEDGE_STATUSES = ['draft', 'published', 'archived'] as const;
const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;

function response(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { 'cache-control': 'private, no-store' } });
}

type ConversationState = { id: string; status: string; assigned_to: string; message_count: number; expires_at: string };
type AnalysisRow = { id: string; source_message_id: string; source_message_count: number; snapshot_json: string; status: string; model: string };
type DraftRow = {
  id: string; analysis_id: string; version: number; english_content: string; chinese_meaning: string;
  meaning_changes_json: string; risks_json: string; cases_json: string; status: string; confirmed_by: string; confirmed_at: string;
};

function requestedCaseIds(value: unknown) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw Response.json({ error: '案例编号必须是数组' }, { status: 422 });
  return [...new Set(value.map(String).map((id) => id.trim()).filter(Boolean))].slice(0, 6);
}

function storedCaseIds(value: string) {
  try {
    const cases = JSON.parse(value || '[]') as unknown;
    if (!Array.isArray(cases)) throw new Error('shape');
    return [...new Set(cases.map((item) => item && typeof item === 'object' ? String((item as { id?: unknown }).id ?? '') : '').filter(Boolean))].slice(0, 6);
  } catch {
    throw Response.json({ error: '草稿中的案例数据异常，请重新生成草稿' }, { status: 409 });
  }
}

async function loadAuthorizedCases(caseIds: string[]) {
  if (!caseIds.length) return [];
  const placeholders = caseIds.map(() => '?').join(', ');
  const now = new Date().toISOString();
  const result = await getDb().prepare(`SELECT id, public_title_en AS title_en, public_description_en AS description_en,
    building_type, viewpoint, shot_scale, atmosphere FROM assets WHERE id IN (${placeholders})
    AND visibility = 'public' AND rights_status = 'approved' AND rights_proof_ref <> ''
    AND rights_approved_by <> '' AND rights_approved_at <> '' AND (rights_expires_at = '' OR rights_expires_at >= ?)`)
    .bind(...caseIds, now).all<Record<string, unknown>>();
  const byId = new Map(result.results.map((item) => [String(item.id), {
    ...item, id: String(item.id), image_url: `/api/public/files/${item.id}`, disclosure: 'sample',
  }]));
  if (byId.size !== caseIds.length) throw Response.json({ error: '所选案例已撤回、过期或缺少完整展示授权，请重新选择' }, { status: 409 });
  return caseIds.map((id) => byId.get(id)!);
}

async function ownedConversation(id: string, ownerId: string) {
  const conversation = await getDb().prepare('SELECT id, status, assigned_to, message_count, expires_at FROM conversations WHERE id = ?')
    .bind(id).first<ConversationState>();
  if (!conversation) throw Response.json({ error: '会话不存在' }, { status: 404 });
  if (conversation.status !== 'human' || conversation.assigned_to !== ownerId) throw Response.json({ error: '请先接管会话' }, { status: 409 });
  if (conversation.expires_at && conversation.expires_at <= new Date().toISOString()) throw Response.json({ error: '会话已过期' }, { status: 410 });
  return conversation;
}

async function loadTranscript(conversationId: string) {
  const [result, attachments] = await Promise.all([
    getDb().prepare("SELECT id, sender, content, created_at FROM chat_messages WHERE conversation_id = ? AND sender IN ('customer', 'assistant', 'human') ORDER BY created_at ASC LIMIT 200")
      .bind(conversationId).all<{ id: string; sender: TranscriptMessage['sender']; content: string; created_at: string }>(),
    getDb().prepare("SELECT message_id, status, analysis_json FROM conversation_attachments WHERE conversation_id = ? AND message_id <> '' ORDER BY created_at ASC LIMIT 20")
      .bind(conversationId).all<{ message_id: string; status: string; analysis_json: string }>(),
  ]);
  const imageContext = new Map<string, string[]>();
  for (const attachment of attachments.results) {
    const snapshot = safeJson<VisionSnapshot | null>(attachment.analysis_json, null);
    const context = attachment.status === 'analyzed' && snapshot
      ? visionContext(snapshot)
      : '[Image attachment is preserved for staff review; automated image analysis is unavailable.]';
    imageContext.set(attachment.message_id, [...(imageContext.get(attachment.message_id) ?? []), context]);
  }
  return result.results.map((item) => ({
    id: item.id, sender: item.sender,
    content: [item.content, ...(imageContext.get(item.id) ?? [])].join('\n\n'), createdAt: item.created_at,
  }));
}

async function validAnalysis(conversation: ConversationState) {
  const analysis = await getDb().prepare("SELECT id, source_message_id, source_message_count, snapshot_json, status, model FROM semantic_analyses WHERE conversation_id = ? AND purpose = 'staff_assist' AND status = 'valid' ORDER BY created_at DESC LIMIT 1")
    .bind(conversation.id).first<AnalysisRow>();
  if (!analysis || analysis.source_message_count !== conversation.message_count) throw Response.json({ error: '请先重新分析最新对话' }, { status: 409 });
  return analysis;
}

function requireAiAnalysis(analysis: AnalysisRow) {
  if (analysis.model === 'human-review') {
    throw Response.json({ error: '当前记录是人工复核，请使用人工双语草稿流程', code: 'manual_review_only' }, { status: 409 });
  }
}

function modelErrorCode(error: unknown) {
  return error instanceof ModelProviderError ? error.code : 'invalid_response';
}

async function recordModelRun(args: {
  conversationId: string; operation: string; status: string; model: string; provider?: ModelProviderName; inputTokens?: number;
  outputTokens?: number; latencyMs?: number; retryCount?: number; errorCode?: string;
}) {
  await getDb().prepare(`INSERT INTO model_runs
    (id, conversation_id, operation, provider, model, status, input_tokens, output_tokens, latency_ms, estimated_cost_micros, retry_count, error_code, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`)
    .bind(crypto.randomUUID(), args.conversationId, args.operation, args.provider ?? 'deepseek', args.model, args.status, args.inputTokens ?? 0,
      args.outputTokens ?? 0, args.latencyMs ?? 0, args.retryCount ?? 0, args.errorCode ?? '', new Date().toISOString()).run();
}

async function prepareKnowledge(record: { title_en: string; title_zh: string; content_en: string; content_zh: string; keywords_json: string }) {
  const content = [record.title_en, record.title_zh, record.content_en, record.content_zh, record.keywords_json].join('\n');
  const checksum = await contentChecksum(content);
  return { checksum };
}

async function generateAndStoreDraft(args: {
  conversation: ConversationState;
  ownerId: string;
  analysis: AnalysisRow;
  operation: 'draft_reply' | 'revise_reply';
  previous?: DraftRow;
  requestedEnglish?: string;
  requestedChinese?: string;
  caseIds?: string[];
}) {
  const snapshot = JSON.parse(args.analysis.snapshot_json) as SemanticSnapshot;
  const modelRoute = routeModelComplexity(snapshot);
  const model = createRuntimeModel(env, modelRoute.mode);
  const messages = await loadTranscript(args.conversation.id);
  const previous: EmployeeReplyDraft | undefined = args.previous ? {
    english: args.previous.english_content,
    chineseMeaning: args.previous.chinese_meaning,
    meaningChanges: JSON.parse(args.previous.meaning_changes_json || '[]') as string[],
    ambiguities: [],
    riskSentences: JSON.parse(args.previous.risks_json || '[]') as string[],
  } : undefined;
  let generated;
  try {
    generated = await createEmployeeReply({
      messages,
      snapshot,
      model,
      previous,
      requestedEnglish: args.requestedEnglish,
      requestedChinese: args.requestedChinese,
    });
  } catch (error) {
    await recordModelRun({ conversationId: args.conversation.id, operation: `${args.operation}_${modelRoute.mode}`, status: 'failed', model: model.model, provider: model.provider, errorCode: modelErrorCode(error) });
    throw Response.json({ error: '模型暂时无法生成草稿，可继续查看对话或稍后重试', code: modelErrorCode(error) }, { status: 503 });
  }
  await recordModelRun({
    conversationId: args.conversation.id, operation: `${args.operation}_${modelRoute.mode}`, status: 'completed', model: generated.model, provider: generated.provider,
    inputTokens: generated.usage.inputTokens, outputTokens: generated.usage.outputTokens, latencyMs: generated.latencyMs,
  });
  const current = await ownedConversation(args.conversation.id, args.ownerId);
  const currentAnalysis = await validAnalysis(current);
  if (currentAnalysis.id !== args.analysis.id) throw Response.json({ error: '对话在生成期间发生变化，请重新分析' }, { status: 409 });
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const cases = await loadAuthorizedCases(args.caseIds ?? []);
  const stored = await getDb().batch([
    getDb().prepare("UPDATE reply_drafts SET status = 'stale', updated_at = ? WHERE conversation_id = ? AND status IN ('draft', 'confirmed')").bind(now, args.conversation.id),
    getDb().prepare(`INSERT INTO reply_drafts
      (id, conversation_id, analysis_id, previous_draft_id, version, english_content, chinese_meaning, meaning_changes_json, risks_json, cases_json, status, created_by, confirmed_by, confirmed_at, sent_message_id, created_at, updated_at)
      SELECT ?, ?, ?, ?, COALESCE((SELECT MAX(version) + 1 FROM reply_drafts WHERE conversation_id = ?), 1), ?, ?, ?, ?, ?, 'draft', ?, '', '', '', ?, ? WHERE EXISTS (
        SELECT 1 FROM conversations WHERE id = ? AND status = 'human' AND assigned_to = ? AND message_count = ?
      ) AND EXISTS (SELECT 1 FROM semantic_analyses WHERE id = ? AND status = 'valid')`)
      .bind(id, args.conversation.id, args.analysis.id, args.previous?.id ?? '', args.conversation.id, generated.value.english,
        generated.value.chineseMeaning, JSON.stringify(generated.value.meaningChanges), JSON.stringify(generated.value.riskSentences), JSON.stringify(cases),
        args.ownerId, now, now, args.conversation.id, args.ownerId, current.message_count, args.analysis.id),
  ]);
  if (!stored[1]?.meta.changes) throw Response.json({ error: '对话在保存草稿前发生变化，请重新分析' }, { status: 409 });
  const savedVersion = await getDb().prepare('SELECT version FROM reply_drafts WHERE id = ?').bind(id).first<{ version: number }>();
  const version = Number(savedVersion?.version ?? 0);
  return {
    id, analysis_id: args.analysis.id, previous_draft_id: args.previous?.id ?? '', version,
    english_content: generated.value.english, chinese_meaning: generated.value.chineseMeaning,
    meaning_changes: generated.value.meaningChanges, ambiguities: generated.value.ambiguities,
    risks: generated.value.riskSentences, cases, status: 'draft', created_at: now, updated_at: now,
  };
}

export async function GET(request: Request) {
  try {
    const ownerId = requireStaff(request);
    let canReassign = false;
    try { requireProjectLead(request); canReassign = true; } catch {}
    const staffMembers = canReassign
      ? [...new Set((env.STAFF_USER_IDS ?? '').split(',').map((id) => id.trim()).filter(Boolean))]
        .slice(0, 50).map((id) => ({ id, label: id }))
      : [];
    await ensureSchema();
    await cleanupExpiredConversations(getDb(), getFiles()).catch((error) => console.error('conversation cleanup failed', { error: error instanceof Error ? error.name : 'unknown' }));
    const url = new URL(request.url);
    const conversationId = url.searchParams.get('conversation_id')?.trim();
    const now = new Date().toISOString();
    const [conversations, leads, knowledge, approvedCases] = await Promise.all([
      getDb().prepare(`SELECT c.id, c.locale, c.status, c.assigned_to, c.priority, c.next_action, c.inquiry_json, c.message_count, c.created_at, c.updated_at,
        c.client_timezone, c.client_timezone_source,
        MAX(0, CAST((julianday('now') - julianday(c.updated_at)) * 86400 AS INTEGER)) AS waiting_seconds,
        l.id AS lead_id, l.contact_name, l.organization, l.email, l.country, l.timezone, l.status AS lead_status,
        (SELECT content FROM chat_messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS last_message
        FROM conversations c LEFT JOIN leads l ON l.conversation_id = c.id
        WHERE (c.assigned_to = '' OR c.assigned_to = ?) AND (c.expires_at = '' OR c.expires_at > ?)
        ORDER BY c.updated_at DESC LIMIT 200`).bind(ownerId, now).all(),
      getDb().prepare(`SELECT l.* FROM leads l JOIN conversations c ON c.id = l.conversation_id
        WHERE (c.assigned_to = '' OR c.assigned_to = ?) AND (c.expires_at = '' OR c.expires_at > ?)
        ORDER BY l.updated_at DESC LIMIT 200`).bind(ownerId, now).all(),
      getDb().prepare('SELECT * FROM public_knowledge ORDER BY updated_at DESC LIMIT 200').all(),
      getDb().prepare(`SELECT id, public_title_en AS title_en, public_title_zh AS title_zh
        FROM assets WHERE visibility = 'public' AND rights_status = 'approved' AND rights_proof_ref <> ''
          AND rights_approved_by <> '' AND rights_approved_at <> ''
          AND (rights_expires_at = '' OR rights_expires_at >= ?)
          AND public_title_en <> '' AND public_title_zh <> '' ORDER BY created_at DESC LIMIT 50`)
        .bind(now).all<{ id: string; title_en: string; title_zh: string }>(),
    ]);
    let selected = null;
    if (conversationId) {
      const conversation = await getDb().prepare(`SELECT id, locale, status, assigned_to, priority, next_action, inquiry_json,
        message_count, created_at, updated_at, client_timezone, client_timezone_source,
        MAX(0, CAST((julianday('now') - julianday(updated_at)) * 86400 AS INTEGER)) AS waiting_seconds
        FROM conversations WHERE id = ? AND (assigned_to = '' OR assigned_to = ?) AND (expires_at = '' OR expires_at > ?)`)
        .bind(conversationId, ownerId, now).first();
      if (conversation) {
        const [messages, attachments, events, notes, analyses, drafts] = await Promise.all([
          getDb().prepare('SELECT id, sender, content, citations_json, cases_json, mode, created_at FROM chat_messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT 200').bind(conversationId).all(),
          getDb().prepare("SELECT id, message_id, mime_type, byte_size, status, analysis_json, confidence, provider, model, error_code, created_at, analyzed_at FROM conversation_attachments WHERE conversation_id = ? AND message_id <> '' ORDER BY created_at ASC LIMIT 20")
            .bind(conversationId).all<Record<string, unknown>>(),
          getDb().prepare("SELECT id, event_type, metadata_json, created_at FROM audit_events WHERE entity_type = 'conversation' AND entity_id = ? ORDER BY created_at DESC LIMIT 100").bind(conversationId).all(),
          getDb().prepare('SELECT id, author_id, content, created_at FROM conversation_notes WHERE conversation_id = ? ORDER BY created_at ASC LIMIT 200').bind(conversationId).all(),
          getDb().prepare("SELECT id, source_message_id, source_message_count, purpose, status, snapshot_json, provider, model, prompt_version, latency_ms, created_at FROM semantic_analyses WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 20").bind(conversationId).all(),
          getDb().prepare('SELECT id, analysis_id, previous_draft_id, version, english_content, chinese_meaning, meaning_changes_json, risks_json, cases_json, status, confirmed_by, confirmed_at, sent_message_id, created_at, updated_at FROM reply_drafts WHERE conversation_id = ? ORDER BY version DESC LIMIT 20').bind(conversationId).all(),
        ]);
        selected = {
          conversation,
          messages: messages.results,
          attachments: attachments.results.map((item) => ({
            id: String(item.id), message_id: String(item.message_id), mime_type: String(item.mime_type), byte_size: Number(item.byte_size),
            status: String(item.status), analysis: safeJson(String(item.analysis_json), {}), confidence: Number(item.confidence) / 100,
            provider: String(item.provider), model: String(item.model), error_code: String(item.error_code),
            created_at: String(item.created_at), analyzed_at: String(item.analyzed_at),
            content_url: `/api/admin/concierge/attachments/${item.id}`,
          })),
          events: events.results, notes: notes.results, analyses: analyses.results, drafts: drafts.results,
          staff_assist: buildStaffWorkspaceView({
            conversation: conversation as Record<string, unknown>, ownerId,
            analyses: analyses.results as Record<string, unknown>[],
            drafts: drafts.results as Record<string, unknown>[],
          }),
        };
      }
    }
    return response({
      contract_version: STAFF_WORKSPACE_CONTRACT_VERSION,
      capabilities: { can_reassign: canReassign }, staff_members: staffMembers,
      conversations: (conversations.results as Record<string, unknown>[]).map((item) => ({ ...item, ...staffQueueSummary(item) })),
      leads: leads.results, knowledge: knowledge.results,
      approved_cases: approvedCases.results.map((item) => ({ ...item, image_url: `/api/public/files/${item.id}` })), selected,
    });
  } catch (error) {
    return asError(error);
  }
}

export async function POST(request: Request) {
  try {
    const ownerId = requireStaff(request);
    await ensureSchema();
    await cleanupExpiredConversations(getDb(), getFiles()).catch((error) => console.error('conversation cleanup failed', { error: error instanceof Error ? error.name : 'unknown' }));
    const body = await readJsonBody<Record<string, unknown>>(request, 32 * 1024);
    const action = String(body.action ?? '');
    const now = new Date().toISOString();

    if (action === 'claim') {
      const id = String(body.conversation_id ?? '');
      const claimed = await getDb().prepare(`UPDATE conversations SET status = 'human', assigned_to = ?, updated_at = ?
        WHERE id = ? AND assigned_to = '' AND status <> 'closed' AND (expires_at = '' OR expires_at > ?) RETURNING assigned_to`)
        .bind(ownerId, now, id, now).first<{ assigned_to: string }>();
      if (!claimed) {
        const current = await getDb().prepare('SELECT status, assigned_to, expires_at FROM conversations WHERE id = ?').bind(id).first<{ status: string; assigned_to: string; expires_at: string }>();
        if (!current) return response({ error: '会话不存在' }, 404);
        if (current.status === 'closed' || (current.expires_at && current.expires_at <= now)) return response({ error: '会话已关闭或过期' }, 409);
        if (current.assigned_to === ownerId) {
          await getDb().prepare("UPDATE conversations SET status = 'human', updated_at = ? WHERE id = ? AND assigned_to = ?").bind(now, id, ownerId).run();
          return response({ id, status: 'human', assigned_to: ownerId });
        }
        return response({ error: '该会话已由其他同事接管', assigned_to: current.assigned_to }, 409);
      }
      await getDb().batch([
        getDb().prepare("UPDATE semantic_analyses SET status = 'stale' WHERE conversation_id = ? AND purpose = 'public_turn' AND status = 'valid'").bind(id),
        getDb().prepare('INSERT INTO audit_events (id, actor_id, event_type, entity_type, entity_id, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .bind(crypto.randomUUID(), ownerId, 'conversation_claimed', 'conversation', id, '{}', now),
      ]);
      return response({ id, status: 'human', assigned_to: ownerId });
    }

    if (action === 'add_note') {
      const id = String(body.conversation_id ?? '');
      await ownedConversation(id, ownerId);
      const content = String(body.content ?? '').trim().slice(0, 3000);
      if (!content) return response({ error: '内部备注不能为空' }, 422);
      const noteId = crypto.randomUUID();
      await getDb().batch([
        getDb().prepare('INSERT INTO conversation_notes (id, conversation_id, author_id, content, created_at) VALUES (?, ?, ?, ?, ?)')
          .bind(noteId, id, ownerId, content, now),
        getDb().prepare('INSERT INTO audit_events (id, actor_id, event_type, entity_type, entity_id, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .bind(crypto.randomUUID(), ownerId, 'conversation_note_added', 'conversation', id, JSON.stringify({ note_id: noteId }), now),
      ]);
      return response({ id: noteId, conversation_id: id, author_id: ownerId, content, created_at: now }, 201);
    }

    if (action === 'analyze' || action === 'acknowledge_context') {
      const id = String(body.conversation_id ?? '');
      const conversation = await ownedConversation(id, ownerId);
      const messages = await loadTranscript(id);
      const sourceMessage = messages.at(-1);
      if (!sourceMessage) return response({ error: '当前会话没有可分析消息' }, 409);
      const manual = action === 'acknowledge_context';
      if (manual && (body.reviewed !== true || Number(body.source_message_count) !== conversation.message_count)) {
        return response({ error: '请阅读最新完整对话，再确认人工核对' }, 409);
      }
      const model = manual ? null : createRuntimeModel(env, 'simple');
      let analyzed;
      try {
        analyzed = manual ? {
          value: {
            language: 'en' as const, intent: 'unknown' as const, intentConfidence: 0,
            confirmedFacts: [], missingFacts: [], entities: {}, pronounReferences: [], ambiguities: [], conflicts: [],
            tone: 'neutral' as const, risks: [], humanRequested: false, caseRequested: false,
            summaryEn: 'The assigned employee reviewed the full conversation. No AI interpretation was generated.',
            summaryZh: '当前接管员工已核对完整对话。本记录为人工复核，不包含 AI 语义分析。',
          },
          provider: 'human-review' as const, model: 'human-review', usage: { inputTokens: 0, outputTokens: 0 }, latencyMs: 0, retryCount: 0,
        } : await analyzeConversation(messages, model!);
      } catch (error) {
        await recordModelRun({ conversationId: id, operation: 'staff_analyze', status: 'failed', model: model!.model, provider: model!.provider, errorCode: modelErrorCode(error) });
        return response({ error: 'AI 分析暂时不可用。阅读完整对话后，可选择人工核对并填写双语草稿。', code: modelErrorCode(error) }, 503);
      }
      if (!manual) await recordModelRun({
        conversationId: id, operation: 'staff_analyze', status: 'completed', model: analyzed.model, provider: analyzed.provider,
        inputTokens: analyzed.usage.inputTokens, outputTokens: analyzed.usage.outputTokens,
        latencyMs: analyzed.latencyMs, retryCount: analyzed.retryCount,
      });
      const current = await ownedConversation(id, ownerId);
      if (current.message_count !== conversation.message_count) return response({ error: '分析期间收到新消息，请重新分析' }, 409);
      const analysisId = crypto.randomUUID();
      const stored = await getDb().batch([
        getDb().prepare("UPDATE semantic_analyses SET status = 'stale' WHERE conversation_id = ? AND status = 'valid'").bind(id),
        getDb().prepare("UPDATE reply_drafts SET status = 'stale', updated_at = ? WHERE conversation_id = ? AND status IN ('draft', 'confirmed')").bind(now, id),
        getDb().prepare(`INSERT INTO semantic_analyses
          (id, conversation_id, source_message_id, source_message_count, purpose, status, snapshot_json, provider, model, prompt_version, latency_ms, created_by, created_at)
          SELECT ?, ?, ?, ?, 'staff_assist', 'valid', ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (
            SELECT 1 FROM conversations WHERE id = ? AND status = 'human' AND assigned_to = ? AND message_count = ?
          )`).bind(analysisId, id, sourceMessage.id, conversation.message_count, JSON.stringify(analyzed.value), analyzed.provider,
            analyzed.model, manual ? 'staff-context-review-v1' : SEMANTIC_PROMPT_VERSION, analyzed.latencyMs, ownerId, now, id, ownerId, conversation.message_count),
        getDb().prepare('INSERT INTO audit_events (id, actor_id, event_type, entity_type, entity_id, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .bind(crypto.randomUUID(), ownerId, manual ? 'conversation_reviewed_manually' : 'conversation_analyzed', 'conversation', id, JSON.stringify({ analysis_id: analysisId, source_message_id: sourceMessage.id }), now),
      ]);
      if (!stored[2]?.meta.changes) return response({ error: '对话在保存分析前发生变化，请重试' }, 409);
      return response({
        id: analysisId, conversation_id: id, source_message_id: sourceMessage.id,
        source_message_count: conversation.message_count, status: 'valid', snapshot: analyzed.value,
        model: analyzed.model, prompt_version: manual ? 'staff-context-review-v1' : SEMANTIC_PROMPT_VERSION, latency_ms: analyzed.latencyMs, created_at: now,
      }, 201);
    }

    if (action === 'draft_reply') {
      const id = String(body.conversation_id ?? '');
      const conversation = await ownedConversation(id, ownerId);
      const analysis = await validAnalysis(conversation);
      requireAiAnalysis(analysis);
      const caseIds = requestedCaseIds(body.case_ids) ?? [];
      return response(await generateAndStoreDraft({ conversation, ownerId, analysis, operation: 'draft_reply', caseIds }), 201);
    }

    if (action === 'save_manual_draft') {
      const id = String(body.conversation_id ?? '');
      const conversation = await ownedConversation(id, ownerId);
      const analysis = await validAnalysis(conversation);
      const english = String(body.english_content ?? '').trim().slice(0, 3000);
      const chineseMeaning = String(body.chinese_meaning ?? '').trim().slice(0, 3000);
      if (!english || !chineseMeaning) return response({ error: '人工草稿必须同时填写英文和员工核对用中文含义' }, 422);
      if (/[\u3400-\u9fff]/.test(english)) return response({ error: '发送给客户的版本只能使用英文' }, 422);
      const risk = classifyRisk(english);
      const cases = await loadAuthorizedCases(requestedCaseIds(body.case_ids) ?? []);
      const draftId = crypto.randomUUID();
      const stored = await getDb().batch([
        getDb().prepare("UPDATE reply_drafts SET status = 'stale', updated_at = ? WHERE conversation_id = ? AND status IN ('draft', 'confirmed')").bind(now, id),
        getDb().prepare(`INSERT INTO reply_drafts
          (id, conversation_id, analysis_id, previous_draft_id, version, english_content, chinese_meaning, meaning_changes_json, risks_json, cases_json, status, created_by, confirmed_by, confirmed_at, sent_message_id, created_at, updated_at)
          SELECT ?, ?, ?, '', COALESCE((SELECT MAX(version) + 1 FROM reply_drafts WHERE conversation_id = ?), 1), ?, ?, '[]', ?, ?, 'draft', ?, '', '', '', ?, ? WHERE EXISTS (
            SELECT 1 FROM conversations WHERE id = ? AND status = 'human' AND assigned_to = ? AND message_count = ?
          ) AND EXISTS (SELECT 1 FROM semantic_analyses WHERE id = ? AND purpose = 'staff_assist' AND status = 'valid')`)
          .bind(draftId, id, analysis.id, id, english, chineseMeaning, JSON.stringify(risk ? [risk] : []), JSON.stringify(cases),
            ownerId, now, now, id, ownerId, conversation.message_count, analysis.id),
        getDb().prepare('INSERT INTO audit_events (id, actor_id, event_type, entity_type, entity_id, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .bind(crypto.randomUUID(), ownerId, 'manual_reply_drafted', 'conversation', id, JSON.stringify({ draft_id: draftId, analysis_id: analysis.id }), now),
      ]);
      if (!stored[1]?.meta.changes) return response({ error: '保存前会话状态发生变化，请刷新' }, 409);
      const savedVersion = await getDb().prepare('SELECT version FROM reply_drafts WHERE id = ?').bind(draftId).first<{ version: number }>();
      const version = Number(savedVersion?.version ?? 0);
      return response({
        id: draftId, analysis_id: analysis.id, version, english_content: english, chinese_meaning: chineseMeaning,
        meaning_changes: [], risks: risk ? [risk] : [], cases, status: 'draft', created_at: now, updated_at: now,
      }, 201);
    }

    if (action === 'revise_reply') {
      const id = String(body.conversation_id ?? '');
      const conversation = await ownedConversation(id, ownerId);
      const analysis = await validAnalysis(conversation);
      requireAiAnalysis(analysis);
      const previous = await getDb().prepare(`SELECT id, analysis_id, version, english_content, chinese_meaning, meaning_changes_json, risks_json, cases_json, status, confirmed_by, confirmed_at
        FROM reply_drafts WHERE conversation_id = ? ORDER BY version DESC LIMIT 1`).bind(id).first<DraftRow>();
      if (!previous || previous.analysis_id !== analysis.id || previous.status === 'sent') return response({ error: '没有可修改的当前草稿' }, 409);
      const requestedEnglish = String(body.english_content ?? '').trim().slice(0, 3000);
      const requestedChinese = String(body.chinese_meaning ?? '').trim().slice(0, 3000);
      if (!requestedEnglish && !requestedChinese) return response({ error: '请至少修改英文或中文其中一项' }, 422);
      const caseIds = requestedCaseIds(body.case_ids) ?? storedCaseIds(previous.cases_json);
      return response(await generateAndStoreDraft({
        conversation, ownerId, analysis, previous, operation: 'revise_reply', requestedEnglish, requestedChinese, caseIds,
      }), 201);
    }

    if (action === 'confirm_reply') {
      const id = String(body.conversation_id ?? '');
      const conversation = await ownedConversation(id, ownerId);
      const analysis = await validAnalysis(conversation);
      const draft = await getDb().prepare(`SELECT id, analysis_id, version, english_content, chinese_meaning, meaning_changes_json, risks_json, cases_json, status, confirmed_by, confirmed_at
        FROM reply_drafts WHERE conversation_id = ? ORDER BY version DESC LIMIT 1`).bind(id).first<DraftRow>();
      if (!draft || draft.id !== String(body.draft_id ?? '') || draft.analysis_id !== analysis.id || draft.status !== 'draft') return response({ error: '只能确认当前最新草稿' }, 409);
      const risks = JSON.parse(draft.risks_json || '[]') as string[];
      if (risks.length) return response({ error: '草稿仍含风险句，修改后才能确认', risks }, 409);
      const confirmed = await getDb().prepare(`UPDATE reply_drafts SET status = 'confirmed', confirmed_by = ?, confirmed_at = ?, updated_at = ?
        WHERE id = ? AND conversation_id = ? AND analysis_id = ? AND status = 'draft'`).bind(ownerId, now, now, draft.id, id, analysis.id).run();
      if (!confirmed.meta.changes) return response({ error: '草稿状态刚刚变化，请刷新' }, 409);
      await getDb().prepare('INSERT INTO audit_events (id, actor_id, event_type, entity_type, entity_id, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(crypto.randomUUID(), ownerId, 'reply_confirmed', 'conversation', id, JSON.stringify({ draft_id: draft.id, version: draft.version }), now).run();
      return response({ id: draft.id, status: 'confirmed', confirmed_by: ownerId, confirmed_at: now });
    }

    if (action === 'send_confirmed_reply') {
      const id = String(body.conversation_id ?? '');
      const conversation = await ownedConversation(id, ownerId);
      const analysis = await validAnalysis(conversation);
      const draft = await getDb().prepare(`SELECT id, analysis_id, version, english_content, chinese_meaning, meaning_changes_json, risks_json, cases_json, status, confirmed_by, confirmed_at
        FROM reply_drafts WHERE conversation_id = ? ORDER BY version DESC LIMIT 1`).bind(id).first<DraftRow>();
      if (!draft || draft.id !== String(body.draft_id ?? '') || draft.analysis_id !== analysis.id || draft.status !== 'confirmed' || draft.confirmed_by !== ownerId) {
        return response({ error: '只能发送自己确认的当前最新草稿' }, 409);
      }
      const risks = JSON.parse(draft.risks_json || '[]') as string[];
      if (risks.length) return response({ error: '草稿风险检查未通过', risks }, 409);
      const caseIds = storedCaseIds(draft.cases_json);
      const cases = await loadAuthorizedCases(caseIds);
      const messageId = crypto.randomUUID();
      const sent = await getDb().batch([
        getDb().prepare(`INSERT INTO chat_messages (id, conversation_id, sender, content, citations_json, cases_json, mode, created_at)
          SELECT ?, ?, 'human', ?, '[]', ?, 'human', ? WHERE EXISTS (
            SELECT 1 FROM conversations WHERE id = ? AND status = 'human' AND assigned_to = ? AND message_count = ?
          ) AND EXISTS (SELECT 1 FROM reply_drafts WHERE id = ? AND status = 'confirmed' AND confirmed_by = ?)`)
          .bind(messageId, id, draft.english_content, JSON.stringify(cases), now, id, ownerId, conversation.message_count, draft.id, ownerId),
        getDb().prepare("UPDATE reply_drafts SET status = 'sent', sent_message_id = ?, updated_at = ? WHERE id = ? AND status = 'confirmed' AND EXISTS (SELECT 1 FROM chat_messages WHERE id = ?)")
          .bind(messageId, now, draft.id, messageId),
        getDb().prepare("UPDATE semantic_analyses SET status = 'stale' WHERE id = ? AND status = 'valid' AND EXISTS (SELECT 1 FROM chat_messages WHERE id = ?)").bind(analysis.id, messageId),
        getDb().prepare("UPDATE conversations SET message_count = message_count + 1, updated_at = ? WHERE id = ? AND status = 'human' AND assigned_to = ? AND message_count = ? AND EXISTS (SELECT 1 FROM chat_messages WHERE id = ?)")
          .bind(now, id, ownerId, conversation.message_count, messageId),
        getDb().prepare(`INSERT INTO audit_events (id, actor_id, event_type, entity_type, entity_id, metadata_json, created_at)
          SELECT ?, ?, 'human_replied', 'conversation', ?, ?, ? WHERE EXISTS (SELECT 1 FROM chat_messages WHERE id = ?)`)
          .bind(crypto.randomUUID(), ownerId, id, JSON.stringify({ message_id: messageId, draft_id: draft.id, version: draft.version, case_ids: caseIds }), now, messageId),
      ]);
      if (!sent[0]?.meta.changes || !sent[3]?.meta.changes) return response({ error: '发送前会话状态发生变化，请刷新后重试' }, 409);
      return response({ id: messageId, sender: 'human', content: draft.english_content, cases, mode: 'human', draft_id: draft.id, created_at: now }, 201);
    }

    if (action === 'reply') {
      return response({ error: '回复必须先生成或保存草稿、核对中英文并确认后才能发送', requires_confirmation: true }, 409);
    }

    if (action === 'update_queue') {
      const id = String(body.conversation_id ?? '');
      await ownedConversation(id, ownerId);
      const priority = String(body.priority ?? 'normal');
      const nextAction = String(body.next_action ?? '').trim().slice(0, 500);
      if (!PRIORITIES.includes(priority as typeof PRIORITIES[number])) return response({ error: '优先级不正确' }, 422);
      const changed = await getDb().prepare("UPDATE conversations SET priority = ?, next_action = ?, updated_at = ? WHERE id = ? AND status = 'human' AND assigned_to = ?")
        .bind(priority, nextAction, now, id, ownerId).run();
      if (!changed.meta.changes) return response({ error: '会话状态刚刚变化，请刷新' }, 409);
      await getDb().prepare('INSERT INTO audit_events (id, actor_id, event_type, entity_type, entity_id, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(crypto.randomUUID(), ownerId, 'queue_updated', 'conversation', id, JSON.stringify({ priority, next_action: nextAction }), now).run();
      return response({ id, priority, next_action: nextAction, updated_at: now });
    }

    if (action === 'complete') {
      const id = String(body.conversation_id ?? '');
      await ownedConversation(id, ownerId);
      const completed = await getDb().batch([
        getDb().prepare("UPDATE conversations SET status = 'closed', next_action = '', updated_at = ? WHERE id = ? AND status = 'human' AND assigned_to = ?").bind(now, id, ownerId),
        getDb().prepare("UPDATE semantic_analyses SET status = 'stale' WHERE conversation_id = ? AND status = 'valid'").bind(id),
        getDb().prepare("UPDATE reply_drafts SET status = 'stale', updated_at = ? WHERE conversation_id = ? AND status IN ('draft', 'confirmed')").bind(now, id),
        getDb().prepare('INSERT INTO audit_events (id, actor_id, event_type, entity_type, entity_id, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .bind(crypto.randomUUID(), ownerId, 'conversation_completed', 'conversation', id, '{}', now),
      ]);
      if (!completed[0]?.meta.changes) return response({ error: '会话状态刚刚变化，请刷新' }, 409);
      return response({ id, status: 'closed', assigned_to: ownerId });
    }

    if (action === 'reopen') {
      const id = String(body.conversation_id ?? '');
      const current = await getDb().prepare('SELECT status, assigned_to, expires_at FROM conversations WHERE id = ?').bind(id)
        .first<{ status: string; assigned_to: string; expires_at: string }>();
      if (!current) return response({ error: '会话不存在' }, 404);
      if (current.expires_at && current.expires_at <= now) return response({ error: '会话已过期，不能重开' }, 410);
      if (current.assigned_to && current.assigned_to !== ownerId) return response({ error: '该会话属于其他同事，请由项目负责人重新分配' }, 409);
      const reopened = await getDb().prepare("UPDATE conversations SET status = 'human', assigned_to = ?, updated_at = ? WHERE id = ? AND status = 'closed'")
        .bind(ownerId, now, id).run();
      if (!reopened.meta.changes) return response({ error: '只有已完成会话可以重开' }, 409);
      await getDb().prepare('INSERT INTO audit_events (id, actor_id, event_type, entity_type, entity_id, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(crypto.randomUUID(), ownerId, 'conversation_reopened', 'conversation', id, '{}', now).run();
      return response({ id, status: 'human', assigned_to: ownerId });
    }

    if (action === 'reassign') {
      requireProjectLead(request);
      const id = String(body.conversation_id ?? '');
      const assignedTo = String(body.assigned_to ?? '').trim().slice(0, 160);
      if (assignedTo && memberAccess(assignedTo, '', env.STAFF_USER_IDS, '') !== 'allowed') return response({ error: '目标员工不在公司员工名单中' }, 422);
      const current = await getDb().prepare('SELECT status FROM conversations WHERE id = ?').bind(id).first<{ status: string }>();
      if (!current) return response({ error: '会话不存在' }, 404);
      if (current.status === 'closed') return response({ error: '请先重开会话再重新分配' }, 409);
      const status = assignedTo ? 'human' : 'requested';
      const changed = await getDb().batch([
        getDb().prepare('UPDATE conversations SET status = ?, assigned_to = ?, updated_at = ? WHERE id = ? AND status <> ?').bind(status, assignedTo, now, id, 'closed'),
        getDb().prepare("UPDATE semantic_analyses SET status = 'stale' WHERE conversation_id = ? AND status = 'valid'").bind(id),
        getDb().prepare("UPDATE reply_drafts SET status = 'stale', updated_at = ? WHERE conversation_id = ? AND status IN ('draft', 'confirmed')").bind(now, id),
        getDb().prepare('INSERT INTO audit_events (id, actor_id, event_type, entity_type, entity_id, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .bind(crypto.randomUUID(), ownerId, 'conversation_reassigned', 'conversation', id, JSON.stringify({ assigned_to: assignedTo, status }), now),
      ]);
      if (!changed[0]?.meta.changes) return response({ error: '会话状态刚刚变化，请刷新' }, 409);
      return response({ id, status, assigned_to: assignedTo });
    }

    if (action === 'lead_status') {
      const id = String(body.lead_id ?? '');
      const status = String(body.status ?? '');
      if (!LEAD_STATUSES.includes(status as typeof LEAD_STATUSES[number])) return response({ error: '线索状态不正确' }, 422);
      const result = await getDb().prepare(`UPDATE leads SET status = ?, updated_at = ? WHERE id = ? AND EXISTS (
        SELECT 1 FROM conversations c WHERE c.id = leads.conversation_id AND (c.assigned_to = '' OR c.assigned_to = ?)
      )`).bind(status, now, id, ownerId).run();
      if (!result.meta.changes) return response({ error: '线索不存在' }, 404);
      await getDb().prepare('INSERT INTO audit_events (id, actor_id, event_type, entity_type, entity_id, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), ownerId, 'lead_status_changed', 'lead', id, JSON.stringify({ status }), now).run();
      return response({ id, status });
    }

    if (action === 'add_knowledge') {
      requirePublisher(request);
      const quota = await getDb().prepare('SELECT COUNT(*) AS count FROM public_knowledge').first<{ count: number }>();
      if (Number(quota?.count ?? 0) >= 500) return response({ error: '公开知识已达到 500 条上限，请先归档或清理旧内容' }, 422);
      const record = {
        id: crypto.randomUUID(), category: String(body.category ?? 'general').trim().slice(0, 80),
        title_en: String(body.title_en ?? '').trim().slice(0, 180), title_zh: String(body.title_zh ?? '').trim().slice(0, 180),
        content_en: String(body.content_en ?? '').trim().slice(0, 5000), content_zh: String(body.content_zh ?? '').trim().slice(0, 5000),
        keywords_json: JSON.stringify(String(body.keywords ?? '').split(/[,，]/).map((item) => item.trim()).filter(Boolean).slice(0, 30)),
        status: body.publish === true ? 'published' : 'draft', updated_at: now,
      };
      if (!record.title_en || !record.title_zh || !record.content_en || !record.content_zh) return response({ error: '中英文标题和正文必须填写' }, 422);
      const prepared = await prepareKnowledge(record);
      const statements = [
        getDb().prepare(`INSERT INTO public_knowledge
          (id, category, title_en, title_zh, content_en, content_zh, keywords_json, status, version, checksum, expires_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, '', ?)`).bind(record.id, record.category, record.title_en, record.title_zh,
            record.content_en, record.content_zh, record.keywords_json, record.status, prepared.checksum, record.updated_at),
        getDb().prepare('INSERT INTO audit_events (id, actor_id, event_type, entity_type, entity_id, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(
          crypto.randomUUID(), ownerId, 'knowledge_created', 'public_knowledge', record.id, JSON.stringify({ status: record.status }), now,
        ),
      ];
      await getDb().batch(statements);
      return response({ ...record, checksum: prepared.checksum, embedding_status: 'bm25_only' }, 201);
    }

    if (action === 'knowledge_status') {
      requirePublisher(request);
      const id = String(body.knowledge_id ?? '');
      const status = String(body.status ?? '');
      if (!KNOWLEDGE_STATUSES.includes(status as typeof KNOWLEDGE_STATUSES[number])) return response({ error: '知识状态不正确' }, 422);
      const knowledge = await getDb().prepare('SELECT title_en, title_zh, content_en, content_zh, keywords_json FROM public_knowledge WHERE id = ?').bind(id)
        .first<{ title_en: string; title_zh: string; content_en: string; content_zh: string; keywords_json: string }>();
      if (!knowledge) return response({ error: '知识不存在' }, 404);
      const prepared = await prepareKnowledge(knowledge);
      const statements = [
        getDb().prepare('UPDATE public_knowledge SET status = ?, checksum = ?, updated_at = ? WHERE id = ?').bind(status, prepared.checksum, now, id),
        getDb().prepare(`INSERT INTO audit_events (id, actor_id, event_type, entity_type, entity_id, metadata_json, created_at)
          SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM public_knowledge WHERE id = ?)`).bind(
            crypto.randomUUID(), ownerId, 'knowledge_status_changed', 'public_knowledge', id, JSON.stringify({ status }), now, id,
          ),
      ];
      if (status !== 'published') statements.push(getDb().prepare('DELETE FROM knowledge_embeddings WHERE knowledge_id = ?').bind(id));
      const result = await getDb().batch(statements);
      if (!result[0]?.meta.changes) return response({ error: '知识不存在' }, 404);
      return response({ id, status, checksum: prepared.checksum, embedding_status: 'bm25_only', updated_at: now });
    }

    return response({ error: '不支持的操作' }, 400);
  } catch (error) {
    return asError(error);
  }
}
