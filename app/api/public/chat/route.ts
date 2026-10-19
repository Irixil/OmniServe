import { env } from 'cloudflare:workers';
import { ensureSchema, getDb, getFiles } from '../../../../db';
import {
  buildLeadSummaries, normalizePublicCaseTaxonomy, parseInquiry,
  safeJson, type InquiryState, type Locale, type PublicCase,
} from '../../../../lib/public-domain';
import { runModelControlledAgent } from '../../../../lib/controlled-agent';
import { analyzeConversation, type TranscriptMessage } from '../../../../lib/conversation-assist';
import { semanticGate, type SemanticSnapshot } from '../../../../lib/model-contracts';
import { controlledAgentTimeoutMs, publicConversationProcessingLeaseMs, routeModelComplexity, type ModelComplexity } from '../../../../lib/model-routing';
import { createRuntimeModel, createRuntimeVisionModel, ModelProviderError, type AgentModel, type ModelProviderName } from '../../../../lib/model-provider';
import { searchPublicKnowledge } from '../../../../lib/public-knowledge-search';
import { cleanupExpiredConversations } from '../../../../lib/conversation-lifecycle';
import { humanAvailabilityCopy } from '../../../../lib/service-hours';
import { readJsonBody } from '../../../../lib/request-body';
import { asPublicError, enforcePublicRateLimit, hashPublicValue, requirePublicConversation, type PublicConversationRow } from '../../../../lib/public-conversation';
import { derivePublicCustomerMessageId, resolveCustomerMessageReplay } from '../../../../lib/public-message-id';
import { analyzeImage, visionContext, visionGate, type VisionSnapshot } from '../../../../lib/vision-analysis';
import { normalizeTimeZone } from '../../../../lib/timezones';

type KnowledgeRow = {
  id: string; category: string; title_en: string; title_zh: string; content_en: string; content_zh: string;
  keywords_json: string; status: string; checksum: string; expires_at: string; updated_at: string;
};

type AttachmentRow = {
  id: string; message_id: string; file_key: string; mime_type: 'image/jpeg' | 'image/png' | 'image/webp';
  byte_size: number; status: 'uploaded' | 'analyzed' | 'failed'; analysis_json: string; confidence: number;
  provider: string; model: string; error_code: string; created_at: string; analyzed_at: string;
};

function response(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

function requestedAttachmentId(value: unknown) {
  if (value === undefined) return '';
  if (!Array.isArray(value) || value.length > 1) throw Response.json({ error: 'Please attach one image at a time.' }, { status: 422 });
  const ids = [...new Set(value.map(String).map((id) => id.trim()).filter(Boolean))];
  if (ids.length > 1 || ids.some((id) => id.length > 100)) throw Response.json({ error: 'This image could not be attached. Please upload it again.' }, { status: 422 });
  return ids[0] ?? '';
}

async function claimAttachment(conversationId: string, attachmentId: string, messageId: string) {
  if (!attachmentId) return undefined;
  const claimed = await getDb().prepare(`UPDATE conversation_attachments SET message_id = ?
    WHERE id = ? AND conversation_id = ? AND message_id = '' AND status <> 'deleting' AND expires_at > ?
    RETURNING id, message_id, file_key, mime_type, byte_size, status, analysis_json, confidence, provider, model, error_code, created_at, analyzed_at`)
    .bind(messageId, attachmentId, conversationId, new Date().toISOString()).first<AttachmentRow>();
  if (claimed) return claimed;
  const existing = await getDb().prepare('SELECT message_id, expires_at FROM conversation_attachments WHERE id = ? AND conversation_id = ?')
    .bind(attachmentId, conversationId).first<{ message_id: string; expires_at: string }>();
  if (!existing || existing.expires_at <= new Date().toISOString()) throw Response.json({ error: 'This image is no longer available. Upload it again and retry.' }, { status: 404 });
  throw Response.json({ error: 'This image is already attached to another message.' }, { status: 409 });
}

function storedVisionSnapshot(attachment: AttachmentRow) {
  const snapshot = safeJson<VisionSnapshot | null>(attachment.analysis_json, null);
  return snapshot && typeof snapshot.confidence === 'number' && typeof snapshot.requiresHumanReview === 'boolean'
    && snapshot.fieldConfidence && typeof snapshot.fieldConfidence === 'object' && Array.isArray(snapshot.suggestedQuestions)
    ? snapshot : null;
}

async function imageClarificationAfterPersist(conversationId: string, customerMessageId: string, snapshot: VisionSnapshot, ownerAt: string) {
  const now = new Date().toISOString();
  const assistantMessageId = crypto.randomUUID();
  const answer = 'I can see the uploaded image, but some visual details are uncertain. Please briefly describe which part of the image matters and what you want us to produce or change.';
  const committed = await getDb().batch([
    getDb().prepare(`INSERT INTO chat_messages (id, conversation_id, sender, content, citations_json, cases_json, mode, created_at)
      SELECT ?, ?, 'assistant', ?, '[]', '[]', 'clarify', ? WHERE EXISTS (
        SELECT 1 FROM conversations WHERE id = ? AND status = 'processing' AND assigned_to = '' AND updated_at = ?
      )`).bind(assistantMessageId, conversationId, answer, now, conversationId, ownerAt),
    getDb().prepare("UPDATE conversations SET status = 'ai', message_count = message_count + 1, updated_at = ? WHERE id = ? AND status = 'processing' AND assigned_to = '' AND updated_at = ? AND EXISTS (SELECT 1 FROM chat_messages WHERE id = ?)")
      .bind(now, conversationId, ownerAt, assistantMessageId),
    getDb().prepare(`INSERT INTO audit_events (id, actor_id, event_type, entity_type, entity_id, metadata_json, created_at)
      SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM chat_messages WHERE id = ? AND conversation_id = ?)`)
      .bind(crypto.randomUUID(), 'vision-analyzer', 'vision_gate', 'conversation', conversationId,
        JSON.stringify({ message_id: customerMessageId, gate: 'clarify', confidence: snapshot.confidence }), now, assistantMessageId, conversationId),
  ]);
  if (!committed[1]?.meta.changes) return handoffAfterPersist(conversationId, customerMessageId, 'human_takeover_during_vision_gate', ownerAt);
  return response({
    conversation_id: conversationId, message_id: assistantMessageId, locale: 'en', mode: 'clarify', answer,
    citations: [], cases: [], missing_fields: ['The relevant image area and requested outcome'], lead_status: 'collecting',
    handoff_status: 'ai', agent_tools: [], handoff_reason: '',
  });
}

async function storeCustomerOnly(conversationId: string, messageId: string, content: string, locale: Locale, now: string) {
  const current = await getDb().prepare('SELECT inquiry_json FROM conversations WHERE id = ?').bind(conversationId).first<{ inquiry_json: string }>();
  const inquiry = parseInquiry(content, safeJson<Partial<InquiryState>>(current?.inquiry_json, {})).inquiry;
  const inserted = await getDb().prepare('INSERT OR IGNORE INTO chat_messages (id, conversation_id, sender, content, citations_json, cases_json, mode, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(messageId, conversationId, 'customer', content, '[]', '[]', 'customer', now).run();
  if (!inserted.meta.changes) {
    const status = await getDb().prepare('SELECT status FROM conversations WHERE id = ?').bind(conversationId).first<{ status: string }>();
    return { inserted: false, handoffStatus: status?.status ?? 'requested' };
  }
  await getDb().batch([
    getDb().prepare('UPDATE conversations SET locale = ?, inquiry_json = ?, message_count = message_count + 1, updated_at = ? WHERE id = ?').bind(locale, JSON.stringify(inquiry), now, conversationId),
    getDb().prepare("UPDATE semantic_analyses SET status = 'stale' WHERE conversation_id = ? AND status = 'valid'").bind(conversationId),
    getDb().prepare("UPDATE reply_drafts SET status = 'stale', updated_at = ? WHERE conversation_id = ? AND status IN ('draft', 'confirmed')").bind(now, conversationId),
  ]);
  const lead = await getDb().prepare(`SELECT id, contact_name, organization, email, country, timezone
    FROM leads WHERE conversation_id = ?`).bind(conversationId)
    .first<{ id: string; contact_name: string; organization: string; email: string; country: string; timezone: string }>();
  if (lead) {
    const summary = buildLeadSummaries(inquiry, {
      name: lead.contact_name, organization: lead.organization, email: lead.email, country: lead.country, timezone: lead.timezone,
    });
    await getDb().prepare('UPDATE leads SET summary_en = ?, summary_zh = ? WHERE id = ?')
      .bind(summary.summary_en, summary.summary_zh, lead.id).run();
  }
  const updatedConversation = await getDb().prepare('SELECT status FROM conversations WHERE id = ?').bind(conversationId).first<{ status: string }>();
  return { inserted: true, handoffStatus: updatedConversation?.status === 'processing' ? 'requested' : (updatedConversation?.status ?? 'requested') };
}

async function acceptedCustomerMessage(conversationId: string, messageId: string, locale: Locale, statusFallback: string) {
  const current = await getDb().prepare('SELECT status FROM conversations WHERE id = ?').bind(conversationId).first<{ status: string }>();
  return response({
    accepted: true, duplicate: true, refresh: true, conversation_id: conversationId, message_id: messageId,
    locale, mode: 'human', answer: '', citations: [], cases: [], missing_fields: [], lead_status: 'collecting',
    handoff_status: current?.status ?? statusFallback,
  });
}

async function rebuildInquiryFromCustomerMessages(conversationId: string) {
  const messages = await getDb().prepare("SELECT content FROM chat_messages WHERE conversation_id = ? AND sender = 'customer' ORDER BY created_at ASC, rowid ASC LIMIT 200")
    .bind(conversationId).all<{ content: string }>();
  return messages.results.reduce((inquiry, message) => parseInquiry(message.content, inquiry).inquiry, parseInquiry('').inquiry);
}

async function recordPublicModelRun(args: {
  conversationId: string; operation: string; model: string; provider: ModelProviderName; status: 'completed' | 'failed';
  inputTokens?: number; outputTokens?: number; latencyMs?: number; retryCount?: number; errorCode?: string;
}) {
  await getDb().prepare(`INSERT INTO model_runs
    (id, conversation_id, operation, provider, model, status, input_tokens, output_tokens, latency_ms, estimated_cost_micros, retry_count, error_code, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`)
    .bind(crypto.randomUUID(), args.conversationId, args.operation, args.provider, args.model, args.status, args.inputTokens ?? 0,
      args.outputTokens ?? 0, args.latencyMs ?? 0, args.retryCount ?? 0, args.errorCode ?? '', new Date().toISOString()).run();
}

async function handoffAfterPersist(conversationId: string, messageId: string, reason: string, ownerAt: string) {
  const now = new Date().toISOString();
  const assistantMessageId = crypto.randomUUID();
  const answer = reason.startsWith('vision_')
    ? `Your image needs a project specialist’s review. I’ve saved your message for follow-up. You can add a description of the details that matter while you wait. ${humanAvailabilityCopy('en')}`
    : `I’ve saved your message for a project specialist to follow up. You can continue adding details here. ${humanAvailabilityCopy('en')}`;
  const committed = await getDb().batch([
    getDb().prepare("UPDATE conversations SET status = 'requested', priority = CASE WHEN priority IN ('low', 'normal') THEN 'high' ELSE priority END, next_action = CASE WHEN next_action = '' THEN 'Review customer request and prepare a human reply' ELSE next_action END, updated_at = ? WHERE id = ? AND status = 'processing' AND assigned_to = '' AND updated_at = ?")
      .bind(now, conversationId, ownerAt),
    getDb().prepare(`INSERT INTO chat_messages (id, conversation_id, sender, content, citations_json, cases_json, mode, created_at)
      SELECT ?, ?, 'assistant', ?, '[]', '[]', 'handoff', ? WHERE EXISTS (
        SELECT 1 FROM conversations WHERE id = ? AND status = 'requested' AND assigned_to = '' AND updated_at = ?
      )`).bind(assistantMessageId, conversationId, answer, now, conversationId, now),
    getDb().prepare('UPDATE conversations SET message_count = message_count + 1 WHERE id = ? AND EXISTS (SELECT 1 FROM chat_messages WHERE id = ? AND conversation_id = ?)')
      .bind(conversationId, assistantMessageId, conversationId),
    getDb().prepare(`INSERT INTO audit_events (id, actor_id, event_type, entity_type, entity_id, metadata_json, created_at)
      SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM chat_messages WHERE id = ? AND conversation_id = ?)`)
      .bind(crypto.randomUUID(), 'controlled-agent', 'handoff_requested', 'conversation', conversationId, JSON.stringify({ message_id: messageId, reason }), now, assistantMessageId, conversationId),
  ]);
  const current = await getDb().prepare('SELECT status, assigned_to FROM conversations WHERE id = ?').bind(conversationId).first<{ status: string; assigned_to: string }>();
  const assistantPersisted = Number(committed[1]?.meta.changes ?? 0) > 0;
  return response({
    conversation_id: conversationId, message_id: assistantPersisted ? assistantMessageId : messageId, locale: 'en', mode: 'human', answer: assistantPersisted ? answer : '', citations: [], cases: [],
    missing_fields: [], lead_status: 'collecting', handoff_status: current?.status ?? 'requested', handoff_reason: '',
  });
}

function welcome(locale: Locale) {
  const availability = humanAvailabilityCopy(locale);
  return locale === 'zh'
    ? `你好。我可以介绍建筑可视化服务，并帮你查找公开视觉参考。请告诉我项目类型、所在地和需要的视觉成果。价格、档期与最终可行性需要由项目专员确认。${availability}`
    : `Hello. I can explain our architectural visualization services and find public visual references. To begin, what type of project are you working on, where is it located, and what visuals do you need? A project specialist will need to confirm pricing, availability, and feasibility. ${availability}`;
}

async function loadCases(): Promise<PublicCase[]> {
  const now = new Date().toISOString();
  const result = await getDb().prepare(`SELECT id, building_type, viewpoint, shot_scale, atmosphere,
    public_title_en, public_title_zh, public_description_en, public_description_zh, rights_expires_at
    FROM assets WHERE visibility = 'public' AND rights_status = 'approved'
    AND rights_proof_ref <> '' AND rights_approved_by <> '' AND rights_approved_at <> ''
    AND (rights_expires_at = '' OR rights_expires_at >= ?) ORDER BY created_at DESC LIMIT 50`).bind(now).all<Record<string, unknown>>();
  const uploaded = result.results.map((row) => {
    const taxonomy = normalizePublicCaseTaxonomy({
      building_type: String(row.building_type),
      viewpoint: String(row.viewpoint),
      shot_scale: String(row.shot_scale),
      atmosphere: String(row.atmosphere).split(/[,，]/).map((item) => item.trim()).filter(Boolean),
    });
    return {
      id: String(row.id),
      title_en: String(row.public_title_en || row.building_type),
      title_zh: String(row.public_title_zh || row.building_type),
      ...taxonomy,
      description_en: String(row.public_description_en || ''), description_zh: String(row.public_description_zh || ''),
      image_url: `/api/public/files/${row.id}`,
      alt_en: String(row.public_title_en || row.building_type), alt_zh: String(row.public_title_zh || row.building_type),
      disclosure: 'sample' as const, visibility: 'public' as const, rights_status: 'approved' as const,
      rights_expires_at: String(row.rights_expires_at || ''),
    };
  });
  return uploaded;
}

function caseReason(item: PublicCase, locale: Locale) {
  return locale === 'zh'
    ? `这项参考与你描述的${[item.building_type, item.viewpoint, item.shot_scale, ...item.atmosphere].join('、')}方向相符。`
    : `This reference aligns with the ${[item.building_type, item.viewpoint, item.shot_scale, ...item.atmosphere].join(', ')} direction you described.`;
}

function mapCase(item: PublicCase, locale: Locale) {
  return {
    id: item.id, title_en: item.title_en, title_zh: item.title_zh, building_type: item.building_type,
    viewpoint: item.viewpoint, shot_scale: item.shot_scale, atmosphere: item.atmosphere,
    description_en: item.description_en, description_zh: item.description_zh, image_url: item.image_url,
    alt_en: item.alt_en, alt_zh: item.alt_zh, disclosure: item.disclosure,
    title: locale === 'zh' ? item.title_zh : item.title_en,
    description: locale === 'zh' ? item.description_zh : item.description_en,
    alt: locale === 'zh' ? item.alt_zh : item.alt_en, match_reason: caseReason(item, locale),
  };
}

async function buildReply(args: {
  text: string; locale: Locale; inquiry: InquiryState; conversationId: string; semantic: SemanticSnapshot;
  model: AgentModel; modelComplexity: ModelComplexity; maxModelTurns: number; deadlineMs: number;
}) {
  const reply = await runModelControlledAgent({
    text: args.text, locale: args.locale, previousInquiry: args.inquiry, semantic: args.semantic,
    model: args.model, maxModelTurns: args.maxModelTurns, deadlineMs: args.deadlineMs,
    searchKnowledge: async (query = args.text) => {
      const now = new Date().toISOString();
      const result = await getDb().prepare(`SELECT k.* FROM public_knowledge k
        WHERE k.status = 'published' AND (k.expires_at = '' OR k.expires_at > ?) ORDER BY k.updated_at DESC LIMIT 200`).bind(now).all<KnowledgeRow>();
      return searchPublicKnowledge(query, args.locale, result.results.map((item) => ({
        ...item,
        keywords: safeJson<string[]>(item.keywords_json, []),
      })));
    },
    searchCases: loadCases,
  });
  for (const run of reply.modelRuns) {
    await recordPublicModelRun({
      conversationId: args.conversationId, operation: `public_agent_turn_${args.modelComplexity}`, model: args.model.model, provider: run.provider, status: run.status,
      inputTokens: run.inputTokens, outputTokens: run.outputTokens, latencyMs: run.latencyMs, errorCode: run.errorCode,
    });
  }
  return { ...reply, cases: reply.cases.map((item) => mapCase(item, args.locale)) };
}

export async function GET(request: Request) {
  try {
    await ensureSchema();
    await cleanupExpiredConversations(getDb(), getFiles()).catch((error) => console.error('conversation cleanup failed', { error: error instanceof Error ? error.name : 'unknown' }));
    const url = new URL(request.url);
    const conversation = await requirePublicConversation(url.searchParams.get('conversation_id') ?? '', request.headers.get('x-conversation-token') ?? '');
    await enforcePublicRateLimit(request, `read:${conversation.id}`, 100, 600);
    let currentConversation = conversation;
    const staleBefore = new Date(Date.now() - publicConversationProcessingLeaseMs).toISOString();
    if (conversation.status === 'processing' && !conversation.assigned_to && conversation.updated_at < staleBefore) {
      const pendingMessage = await getDb().prepare(`SELECT id FROM chat_messages WHERE conversation_id = ? AND sender = 'customer' AND created_at >= ?
        ORDER BY created_at DESC, rowid DESC LIMIT 1`).bind(conversation.id, conversation.updated_at).first<{ id: string }>();
      if (pendingMessage) {
        await handoffAfterPersist(conversation.id, pendingMessage.id, 'processing_lease_expired', conversation.updated_at);
      } else {
        const now = new Date().toISOString();
        await getDb().prepare("UPDATE conversations SET status = 'ai', updated_at = ? WHERE id = ? AND status = 'processing' AND assigned_to = '' AND updated_at = ?")
          .bind(now, conversation.id, conversation.updated_at).run();
      }
      currentConversation = await getDb().prepare('SELECT * FROM conversations WHERE id = ?').bind(conversation.id).first<PublicConversationRow>() ?? conversation;
    }
    const [messages, attachments, lead, activeCases] = await Promise.all([
      getDb().prepare('SELECT id, sender, content, citations_json, cases_json, mode, created_at FROM chat_messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT 200').bind(conversation.id).all<Record<string, unknown>>(),
      getDb().prepare('SELECT id, message_id, mime_type, byte_size, status, created_at FROM conversation_attachments WHERE conversation_id = ? AND expires_at > ? ORDER BY created_at ASC LIMIT 20')
        .bind(conversation.id, new Date().toISOString()).all<Record<string, unknown>>(),
      getDb().prepare('SELECT id, status, created_at FROM leads WHERE conversation_id = ?').bind(conversation.id).first(),
      loadCases(),
    ]);
    const activeCaseIds = new Set(activeCases.map((item) => item.id));
    const publicAttachments = attachments.results.map((item) => ({
      id: String(item.id), message_id: String(item.message_id), mime_type: String(item.mime_type),
      byte_size: Number(item.byte_size), status: String(item.status), created_at: String(item.created_at),
      content_url: `/api/public/chat/attachments/${item.id}?conversation_id=${conversation.id}`,
    }));
    return response({
      conversation: {
        id: currentConversation.id, locale: currentConversation.locale, status: currentConversation.status,
        inquiry: safeJson(currentConversation.inquiry_json, {}), client_timezone: currentConversation.client_timezone,
        client_timezone_source: currentConversation.client_timezone_source,
      },
      messages: messages.results.map((item) => ({
        ...item,
        citations: safeJson(String(item.citations_json), []),
        cases: safeJson<Array<{ id?: string }>>(String(item.cases_json), []).filter((entry) => activeCaseIds.has(String(entry.id))),
        attachments: publicAttachments.filter((attachment) => attachment.message_id === String(item.id)),
      })),
      pending_attachments: publicAttachments.filter((attachment) => !attachment.message_id),
      lead: lead ?? null,
    });
  } catch (error) {
    return asPublicError(error, 'We couldn’t load this conversation. Please refresh and try again.');
  }
}

export async function POST(request: Request) {
  let claimedAttachment: AttachmentRow | undefined;
  try {
    await ensureSchema();
    await cleanupExpiredConversations(getDb(), getFiles()).catch((error) => console.error('conversation cleanup failed', { error: error instanceof Error ? error.name : 'unknown' }));
    const body = await readJsonBody<Record<string, unknown>>(request, 32 * 1024);
    const action = String(body.action ?? '');
    if (action === 'start') {
      await enforcePublicRateLimit(request, 'start', 10, 600);
      const locale: Locale = 'en';
      const id = crypto.randomUUID();
      const token = `${crypto.randomUUID()}${crypto.randomUUID()}`;
      const now = new Date().toISOString();
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      const message = welcome(locale);
      const clientTimezone = normalizeTimeZone(body.client_timezone);
      await getDb().batch([
        getDb().prepare(`INSERT INTO conversations
          (id, access_token_hash, locale, status, assigned_to, inquiry_json, message_count, created_at, updated_at, expires_at, client_timezone, client_timezone_source)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .bind(id, await hashPublicValue(token), locale, 'ai', '', '{}', 1, now, now, expiresAt, clientTimezone, clientTimezone ? 'browser' : ''),
        getDb().prepare('INSERT INTO chat_messages (id, conversation_id, sender, content, citations_json, cases_json, mode, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), id, 'assistant', message, '[]', '[]', 'clarify', now),
      ]);
      return response({ conversation_id: id, token, locale, status: 'ai', message: { sender: 'assistant', content: message, mode: 'clarify', citations: [], cases: [] } }, 201);
    }

    const conversation = await requirePublicConversation(String(body.conversation_id ?? ''), String(body.token ?? ''));
    if (action === 'close') {
      await enforcePublicRateLimit(request, 'close', 20, 600);
      await getDb().prepare("UPDATE conversations SET status = 'closed', access_token_hash = ?, updated_at = ? WHERE id = ?").bind(await hashPublicValue(crypto.randomUUID()), new Date().toISOString(), conversation.id).run();
      return response({ closed: true });
    }
    if (action === 'message') {
      const attachmentId = requestedAttachmentId(body.attachment_ids);
      const submittedText = String(body.message ?? '').trim();
      if (!submittedText && !attachmentId) return response({ error: 'Please add a message or image.' }, 422);
      const text = submittedText || 'Image attached.';
      if (text.length > 3000) return response({ error: 'Your message is too long. Please shorten it and try again.' }, 422);
      const locale: Locale = 'en';
      const now = new Date().toISOString();
      const staleBefore = new Date(Date.now() - publicConversationProcessingLeaseMs).toISOString();
      const hasClientMessageId = Object.hasOwn(body, 'client_message_id');
      const clientMessageId = String(body.client_message_id ?? '');
      if (hasClientMessageId && !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(clientMessageId)) {
        return response({ error: 'This message could not be confirmed. Please refresh and try again.' }, 422);
      }
      const customerMessageId = hasClientMessageId
        ? await derivePublicCustomerMessageId(conversation.id, clientMessageId)
        : crypto.randomUUID();
      if (hasClientMessageId) {
        await enforcePublicRateLimit(request, 'message-replay', 120, 600);
        const replay = await resolveCustomerMessageReplay(getDb(), conversation.id, customerMessageId, text, attachmentId);
        if (replay === 'conflict') return response({ error: 'This message changed while it was being sent. Please send the updated message again.' }, 409);
        if (replay === 'duplicate') return acceptedCustomerMessage(conversation.id, customerMessageId, locale, conversation.status);
      }
      const staleProcessing = conversation.status === 'processing' && !conversation.assigned_to && conversation.updated_at < staleBefore;
      if (conversation.status === 'processing' && !staleProcessing && !conversation.assigned_to) {
        return response({ error: 'Your previous message is still being handled. Please wait a moment, then try again.' }, 409);
      }
      if ((conversation.status !== 'ai' && !staleProcessing) || conversation.assigned_to) {
        if (Number(conversation.message_count) >= 80) return response({ error: 'This conversation has reached its message limit. Start a new conversation to continue.', retry_after: 3600 }, 429);
        await enforcePublicRateLimit(request, 'human-message', 120, 600);
        claimedAttachment = await claimAttachment(conversation.id, attachmentId, customerMessageId);
        const stored = await storeCustomerOnly(conversation.id, customerMessageId, text, locale, now);
        if (!stored.inserted) {
          const replay = await resolveCustomerMessageReplay(getDb(), conversation.id, customerMessageId, text, attachmentId);
          if (replay === 'duplicate') return acceptedCustomerMessage(conversation.id, customerMessageId, locale, stored.handoffStatus);
          return response({ error: 'This message changed while it was being sent. Please send it again.' }, 409);
        }
        return response({ conversation_id: conversation.id, message_id: customerMessageId, locale, mode: 'human', answer: '', citations: [], cases: [], missing_fields: [], lead_status: 'collecting', handoff_status: stored.handoffStatus });
      }
      await enforcePublicRateLimit(request, 'ai-message', 60, 600);
      const acquired = await getDb().prepare(`UPDATE conversations SET status = 'processing', updated_at = ?
        WHERE id = ? AND assigned_to = '' AND (status = 'ai' OR (status = 'processing' AND updated_at < ?))
        RETURNING inquiry_json, message_count`).bind(now, conversation.id, staleBefore).first<{ inquiry_json: string; message_count: number }>();
      if (!acquired) {
        const current = await getDb().prepare('SELECT status, assigned_to FROM conversations WHERE id = ?').bind(conversation.id).first<{ status: string; assigned_to: string }>();
        if (current?.status === 'processing' && !current.assigned_to) {
          return response({ error: 'Your previous message is still being handled. Please wait a moment, then try again.' }, 409);
        }
        claimedAttachment = await claimAttachment(conversation.id, attachmentId, customerMessageId);
        const stored = await storeCustomerOnly(conversation.id, customerMessageId, text, locale, now);
        if (!stored.inserted) {
          const replay = await resolveCustomerMessageReplay(getDb(), conversation.id, customerMessageId, text, attachmentId);
          if (replay === 'duplicate') return acceptedCustomerMessage(conversation.id, customerMessageId, locale, stored.handoffStatus);
          return response({ error: 'This message changed while it was being sent. Please send it again.' }, 409);
        }
        return response({ conversation_id: conversation.id, message_id: customerMessageId, locale, mode: 'human', answer: '', citations: [], cases: [], missing_fields: [], lead_status: 'collecting', handoff_status: stored.handoffStatus });
      }
      if (Number(acquired.message_count) >= 80) {
        await getDb().prepare("UPDATE conversations SET status = 'ai' WHERE id = ? AND status = 'processing' AND assigned_to = '' AND updated_at = ?").bind(conversation.id, now).run();
        return response({ error: 'This conversation has reached its message limit. Start a new conversation to continue.', retry_after: 3600 }, 429);
      }
      try {
        claimedAttachment = await claimAttachment(conversation.id, attachmentId, customerMessageId);
      } catch (error) {
        await getDb().prepare("UPDATE conversations SET status = 'ai' WHERE id = ? AND status = 'processing' AND assigned_to = '' AND updated_at = ?")
          .bind(conversation.id, now).run();
        throw error;
      }
      const stored = await getDb().batch([
        getDb().prepare(`INSERT INTO chat_messages (id, conversation_id, sender, content, citations_json, cases_json, mode, created_at)
          SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM conversations WHERE id = ? AND status = 'processing' AND assigned_to = '' AND updated_at = ?)`)
          .bind(customerMessageId, conversation.id, 'customer', text, '[]', '[]', 'customer', now, conversation.id, now),
        getDb().prepare('UPDATE conversations SET locale = ?, message_count = message_count + 1, updated_at = ? WHERE id = ? AND status = \'processing\' AND assigned_to = \'\' AND updated_at = ? AND EXISTS (SELECT 1 FROM chat_messages WHERE id = ? AND conversation_id = ?)')
          .bind(locale, now, conversation.id, now, customerMessageId, conversation.id),
        getDb().prepare("UPDATE semantic_analyses SET status = 'stale' WHERE conversation_id = ? AND status = 'valid' AND EXISTS (SELECT 1 FROM chat_messages WHERE id = ? AND conversation_id = ?)").bind(conversation.id, customerMessageId, conversation.id),
        getDb().prepare("UPDATE reply_drafts SET status = 'stale', updated_at = ? WHERE conversation_id = ? AND status IN ('draft', 'confirmed') AND EXISTS (SELECT 1 FROM chat_messages WHERE id = ? AND conversation_id = ?)").bind(now, conversation.id, customerMessageId, conversation.id),
      ]);
      if (!stored[0]?.meta.changes || !stored[1]?.meta.changes) throw Response.json({ error: 'This conversation changed while you were sending. Refresh and try again.' }, { status: 409 });
      let visionSnapshot: VisionSnapshot | undefined;
      if (claimedAttachment) {
        visionSnapshot = claimedAttachment.status === 'analyzed' ? storedVisionSnapshot(claimedAttachment) ?? undefined : undefined;
        if (!visionSnapshot && claimedAttachment.status !== 'failed') {
          const visionModel = createRuntimeVisionModel(env);
          try {
            const object = await getFiles().get(claimedAttachment.file_key);
            if (!object) throw new ModelProviderError('invalid_response', { detail: 'image_missing' });
            const analyzedImage = await analyzeImage({
              bytes: new Uint8Array(await object.arrayBuffer()), mimeType: claimedAttachment.mime_type,
              customerText: submittedText, model: visionModel,
            });
            visionSnapshot = analyzedImage.value;
            await recordPublicModelRun({
              conversationId: conversation.id, operation: 'public_vision_analysis', model: analyzedImage.model, provider: analyzedImage.provider, status: 'completed',
              inputTokens: analyzedImage.usage.inputTokens, outputTokens: analyzedImage.usage.outputTokens,
              latencyMs: analyzedImage.latencyMs, retryCount: analyzedImage.retryCount,
            });
            await getDb().prepare(`UPDATE conversation_attachments SET status = 'analyzed', analysis_json = ?, confidence = ?,
              provider = ?, model = ?, error_code = '', analyzed_at = ? WHERE id = ? AND message_id = ?`)
              .bind(JSON.stringify(visionSnapshot), Math.round(visionSnapshot.confidence * 100), analyzedImage.provider,
                analyzedImage.model, new Date().toISOString(), claimedAttachment.id, customerMessageId).run();
          } catch (error) {
            const code = error instanceof ModelProviderError ? error.code : 'invalid_response';
            await recordPublicModelRun({ conversationId: conversation.id, operation: 'public_vision_analysis', model: visionModel.model, provider: visionModel.provider ?? 'deepseek', status: 'failed', errorCode: code });
            await getDb().prepare("UPDATE conversation_attachments SET status = 'failed', error_code = ?, provider = 'deepseek', model = ?, analyzed_at = ? WHERE id = ? AND message_id = ?")
              .bind(code, visionModel.model, new Date().toISOString(), claimedAttachment.id, customerMessageId).run();
            return handoffAfterPersist(conversation.id, customerMessageId, `vision_${code}`, now);
          }
        }
        if (!visionSnapshot) return handoffAfterPersist(conversation.id, customerMessageId, `vision_${claimedAttachment.error_code || 'unavailable'}`, now);
        const imageGate = visionGate(visionSnapshot);
        if (imageGate === 'handoff') return handoffAfterPersist(conversation.id, customerMessageId, 'vision_human_review', now);
        if (imageGate === 'clarify') return imageClarificationAfterPersist(conversation.id, customerMessageId, visionSnapshot, now);
      }
      const currentInquiry = safeJson<InquiryState>(acquired.inquiry_json, {} as InquiryState);
      const [transcriptResult, transcriptAttachments] = await Promise.all([
        getDb().prepare("SELECT id, sender, content, created_at FROM chat_messages WHERE conversation_id = ? AND sender IN ('customer', 'assistant', 'human') ORDER BY created_at ASC LIMIT 200")
          .bind(conversation.id).all<{ id: string; sender: TranscriptMessage['sender']; content: string; created_at: string }>(),
        getDb().prepare("SELECT message_id, analysis_json FROM conversation_attachments WHERE conversation_id = ? AND status = 'analyzed' AND message_id <> '' ORDER BY created_at ASC LIMIT 20")
          .bind(conversation.id).all<{ message_id: string; analysis_json: string }>(),
      ]);
      const imageContexts = new Map<string, string[]>();
      for (const attachment of transcriptAttachments.results) {
        const snapshot = safeJson<VisionSnapshot | null>(attachment.analysis_json, null);
        if (snapshot) imageContexts.set(attachment.message_id, [...(imageContexts.get(attachment.message_id) ?? []), visionContext(snapshot)]);
      }
      const transcript = transcriptResult.results.map((item) => ({
        id: item.id, sender: item.sender,
        content: [item.content, ...(imageContexts.get(item.id) ?? [])].join('\n\n'),
        createdAt: item.created_at,
      }));
      const semanticModel = createRuntimeModel(env, 'simple');
      let semantic: SemanticSnapshot;
      let semanticResult;
      try {
        semanticResult = await analyzeConversation(transcript, semanticModel);
        semantic = semanticResult.value;
        await recordPublicModelRun({
          conversationId: conversation.id, operation: 'public_semantic_analysis', model: semanticResult.model, provider: semanticResult.provider, status: 'completed',
          inputTokens: semanticResult.usage.inputTokens, outputTokens: semanticResult.usage.outputTokens,
          latencyMs: semanticResult.latencyMs, retryCount: semanticResult.retryCount,
        });
      } catch (error) {
        const code = error instanceof Error && 'code' in error ? String((error as { code: unknown }).code) : 'invalid_response';
        await recordPublicModelRun({ conversationId: conversation.id, operation: 'public_semantic_analysis', model: semanticModel.model, provider: semanticModel.provider ?? 'deepseek', status: 'failed', errorCode: code });
        return handoffAfterPersist(conversation.id, customerMessageId, `semantic_${code}`, now);
      }
      const analysisId = crypto.randomUUID();
      const analysisCommit = await getDb().batch([
        getDb().prepare(`UPDATE semantic_analyses SET status = 'stale' WHERE conversation_id = ? AND purpose = 'public_turn' AND status = 'valid'
          AND EXISTS (SELECT 1 FROM conversations WHERE id = ? AND status = 'processing' AND assigned_to = '' AND updated_at = ?)`).bind(conversation.id, conversation.id, now),
        getDb().prepare(`INSERT INTO semantic_analyses
          (id, conversation_id, source_message_id, source_message_count, purpose, status, snapshot_json, provider, model, prompt_version, latency_ms, created_by, created_at)
          SELECT ?, ?, ?, ?, 'public_turn', 'valid', ?, ?, ?, 'semantic-v1', ?, 'controlled-agent', ? WHERE EXISTS (
            SELECT 1 FROM conversations WHERE id = ? AND status = 'processing' AND assigned_to = '' AND message_count = ? AND updated_at = ?
          )`).bind(analysisId, conversation.id, customerMessageId, Number(acquired.message_count) + 1, JSON.stringify(semantic),
            semanticResult.provider, semanticResult.model, semanticResult.latencyMs, now, conversation.id, Number(acquired.message_count) + 1, now),
      ]);
      if (!analysisCommit[1]?.meta.changes) return handoffAfterPersist(conversation.id, customerMessageId, 'conversation_changed_during_analysis', now);

      const modelRoute = routeModelComplexity(semantic);
      await getDb().prepare('INSERT INTO audit_events (id, actor_id, event_type, entity_type, entity_id, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(crypto.randomUUID(), 'model-router', 'model_complexity_routed', 'conversation', conversation.id,
          JSON.stringify({ analysis_id: analysisId, mode: modelRoute.mode, reasons: modelRoute.reasons }), now).run();
      const gate = semantic.language === 'en' ? semanticGate(semantic) : 'clarify';
      if (gate !== 'agent') {
        const assistantMessageId = crypto.randomUUID();
        const answer = semantic.language !== 'en'
          ? 'I can assist in English for now. Please resend your question in English, or let me know if you’d like a project specialist to follow up.'
          : gate === 'handoff'
            ? `A project specialist will need to review your request before I can confirm it. I’ve saved your message for follow-up. ${humanAvailabilityCopy('en')}`
            : `Could you clarify ${semantic.ambiguities[0] || semantic.conflicts[0] || semantic.missingFacts[0] || 'what you need for the project'} so I can understand your request correctly?`;
        const nextStatus = gate === 'handoff' ? 'requested' : 'ai';
        const committed = await getDb().batch([
          getDb().prepare(`INSERT INTO chat_messages (id, conversation_id, sender, content, citations_json, cases_json, mode, created_at)
            SELECT ?, ?, 'assistant', ?, '[]', '[]', ?, ? WHERE EXISTS (
              SELECT 1 FROM conversations WHERE id = ? AND status = 'processing' AND assigned_to = '' AND updated_at = ?
            )`).bind(assistantMessageId, conversation.id, answer, gate === 'handoff' ? 'handoff' : 'clarify', now, conversation.id, now),
          getDb().prepare("UPDATE conversations SET status = ?, priority = CASE WHEN ? = 'requested' AND priority IN ('low', 'normal') THEN 'high' ELSE priority END, next_action = CASE WHEN ? = 'requested' AND next_action = '' THEN 'Review customer request and prepare a human reply' ELSE next_action END, message_count = message_count + 1, updated_at = ? WHERE id = ? AND status = 'processing' AND assigned_to = '' AND updated_at = ? AND EXISTS (SELECT 1 FROM chat_messages WHERE id = ?)")
            .bind(nextStatus, nextStatus, nextStatus, now, conversation.id, now, assistantMessageId),
          getDb().prepare(`INSERT INTO audit_events (id, actor_id, event_type, entity_type, entity_id, metadata_json, created_at)
            SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM chat_messages WHERE id = ? AND conversation_id = ?)`)
            .bind(crypto.randomUUID(), 'controlled-agent', 'semantic_gate', 'conversation', conversation.id, JSON.stringify({ analysis_id: analysisId, gate, risks: semantic.risks }), now, assistantMessageId, conversation.id),
        ]);
        if (!committed[1]?.meta.changes) return handoffAfterPersist(conversation.id, customerMessageId, 'human_takeover_during_gate', now);
        return response({
          conversation_id: conversation.id, message_id: assistantMessageId, locale, mode: gate === 'handoff' ? 'handoff' : 'clarify', answer,
          citations: [], cases: [], missing_fields: semantic.missingFacts, conflicts: semantic.conflicts, inquiry: currentInquiry,
          lead_status: 'collecting', handoff_status: nextStatus, agent_tools: [], handoff_reason: '',
        });
      }
      let reply: Awaited<ReturnType<typeof buildReply>>;
      try {
        const agentModel = createRuntimeModel(env, modelRoute.mode);
        reply = await buildReply({
          text: visionSnapshot ? `${text}\n\n${visionContext(visionSnapshot)}` : text,
          locale, inquiry: currentInquiry, conversationId: conversation.id, semantic,
          model: agentModel, modelComplexity: modelRoute.mode,
          maxModelTurns: Math.max(1, 3 - semanticResult.retryCount), deadlineMs: Date.now() + controlledAgentTimeoutMs(agentModel.provider ?? 'deepseek'),
        });
      } catch {
        const failedAt = new Date().toISOString();
        await getDb().prepare('INSERT INTO audit_events (id, actor_id, event_type, entity_type, entity_id, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .bind(crypto.randomUUID(), 'controlled-agent', 'agent_failed_safe', 'conversation', conversation.id, JSON.stringify({ message_id: customerMessageId }), failedAt).run();
        return handoffAfterPersist(conversation.id, customerMessageId, 'agent_failed_safe', now);
      }
      const assistantMessageId = crypto.randomUUID();
      const nextStatus = reply.requestHuman ? 'requested' : 'ai';
      const statements = [
        getDb().prepare(`INSERT INTO chat_messages (id, conversation_id, sender, content, citations_json, cases_json, mode, created_at)
          SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (
            SELECT 1 FROM conversations WHERE id = ? AND status = 'processing' AND assigned_to = '' AND updated_at = ?
          )`).bind(assistantMessageId, conversation.id, 'assistant', reply.answer, JSON.stringify(reply.citations), JSON.stringify(reply.cases), reply.mode, now, conversation.id, now),
        getDb().prepare("UPDATE conversations SET locale = ?, status = ?, priority = CASE WHEN ? = 'requested' AND priority IN ('low', 'normal') THEN 'high' ELSE priority END, next_action = CASE WHEN ? = 'requested' AND next_action = '' THEN 'Review customer request and prepare a human reply' ELSE next_action END, inquiry_json = ?, message_count = message_count + 1, updated_at = ? WHERE id = ? AND status = 'processing' AND assigned_to = '' AND updated_at = ?").bind(locale, nextStatus, nextStatus, nextStatus, JSON.stringify(reply.inquiry), now, conversation.id, now),
        getDb().prepare(`INSERT INTO audit_events (id, actor_id, event_type, entity_type, entity_id, metadata_json, created_at)
          SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM chat_messages WHERE id = ?)` ).bind(
          crypto.randomUUID(), 'controlled-agent', 'agent_turn', 'conversation', conversation.id,
          JSON.stringify({ message_id: assistantMessageId, tools: reply.agentTrace, risk_type: reply.riskType, mode: reply.mode }), now, assistantMessageId,
        ),
      ];
      if (reply.requestHuman) {
        statements.push(getDb().prepare(`INSERT INTO audit_events (id, actor_id, event_type, entity_type, entity_id, metadata_json, created_at)
          SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM chat_messages WHERE id = ?)` ).bind(
          crypto.randomUUID(), 'controlled-agent', 'handoff_requested', 'conversation', conversation.id,
          JSON.stringify({
            message_id: assistantMessageId, risk_type: reply.riskType, reason: reply.handoffReason,
            requested_at: now, context_snapshot: reply.inquiry,
          }), now, assistantMessageId,
        ));
      }
      let commit;
      try {
        commit = await getDb().batch(statements);
      } catch (error) {
        await getDb().prepare("UPDATE conversations SET status = ?, priority = CASE WHEN ? = 'requested' AND priority IN ('low', 'normal') THEN 'high' ELSE priority END, next_action = CASE WHEN ? = 'requested' AND next_action = '' THEN 'Review customer request and prepare a human reply' ELSE next_action END WHERE id = ? AND status = 'processing' AND assigned_to = '' AND updated_at = ?").bind(nextStatus, nextStatus, nextStatus, conversation.id, now).run();
        throw error;
      }
      const aiCommitted = Number(commit[1]?.meta.changes ?? 0) > 0;
      if (!aiCommitted) {
        const current = await getDb().prepare('SELECT status FROM conversations WHERE id = ?').bind(conversation.id).first<{ status: string }>();
        return response({ conversation_id: conversation.id, message_id: customerMessageId, locale, mode: 'human', answer: '', citations: [], cases: [], missing_fields: [], lead_status: 'collecting', handoff_status: current?.status ?? 'requested' });
      }
      return response({
        conversation_id: conversation.id, message_id: assistantMessageId, locale, mode: reply.mode, answer: reply.answer,
        citations: reply.citations, cases: reply.cases, missing_fields: reply.missing, conflicts: reply.conflicts,
        inquiry: reply.inquiry, lead_status: 'collecting', handoff_status: nextStatus,
        agent_tools: reply.agentTrace.map((item) => item.tool), handoff_reason: '',
      });
    }

    if (action === 'submit_lead') {
      const contact = {
        name: String(body.name ?? '').trim().slice(0, 100), organization: String(body.organization ?? '').trim().slice(0, 160),
        email: String(body.email ?? '').trim().toLowerCase().slice(0, 254), country: String(body.country ?? '').trim().slice(0, 100),
        timezone: String(body.timezone ?? '').trim().slice(0, 100),
      };
      const clientTimezone = normalizeTimeZone(contact.timezone);
      if (contact.timezone && !clientTimezone) return response({ error: 'Please choose a valid time zone.' }, 422);
      contact.timezone = clientTimezone;
      if (body.consent !== true) return response({ error: 'Please give consent before requesting an email follow-up.' }, 422);
      if (!contact.name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email)) return response({ error: 'Please enter your name and a valid email address.' }, 422);
      const idempotencyKey = `${conversation.id}:${contact.email}`;
      const existing = await getDb().prepare('SELECT id, status FROM leads WHERE conversation_id = ?').bind(conversation.id).first();
      if (existing) {
        if (clientTimezone) {
          const now = new Date().toISOString();
          await getDb().batch([
            getDb().prepare('UPDATE leads SET timezone = ?, updated_at = ? WHERE conversation_id = ?').bind(clientTimezone, now, conversation.id),
            getDb().prepare("UPDATE conversations SET client_timezone = ?, client_timezone_source = 'customer' WHERE id = ?").bind(clientTimezone, conversation.id),
          ]);
        }
        return response({ ...existing, handoff_status: conversation.status });
      }
      const inquiry = await rebuildInquiryFromCustomerMessages(conversation.id);
      const summaries = buildLeadSummaries(inquiry, contact);
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      await getDb().batch([
        getDb().prepare(`INSERT INTO leads (id, conversation_id, idempotency_key, contact_name, organization, email, country, timezone, consent_at, status, summary_en, summary_zh, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, conversation.id, idempotencyKey, contact.name, contact.organization, contact.email, contact.country, contact.timezone, now, 'new', summaries.summary_en, summaries.summary_zh, now, now),
        getDb().prepare(`UPDATE conversations SET inquiry_json = ?,
          status = CASE WHEN assigned_to <> '' OR status = 'human' THEN 'human' ELSE 'requested' END,
          client_timezone = CASE WHEN ? <> '' THEN ? ELSE client_timezone END,
          client_timezone_source = CASE WHEN ? <> '' THEN 'customer' ELSE client_timezone_source END,
          updated_at = ? WHERE id = ?`)
          .bind(JSON.stringify(inquiry), clientTimezone, clientTimezone, clientTimezone, now, conversation.id),
        getDb().prepare('INSERT INTO audit_events (id, actor_id, event_type, entity_type, entity_id, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), 'public-visitor', 'lead_submitted', 'lead', id, JSON.stringify({ conversation_id: conversation.id }), now),
      ]);
      const handoff = await getDb().prepare('SELECT status FROM conversations WHERE id = ?').bind(conversation.id).first<{ status: string }>();
      return response({ id, status: 'new', handoff_status: handoff?.status ?? 'requested' }, 201);
    }

    return response({ error: 'Please refresh the conversation and try again.' }, 400);
  } catch (error) {
    if (claimedAttachment) {
      try {
        const stored = await getDb().prepare('SELECT id FROM chat_messages WHERE id = ?').bind(claimedAttachment.message_id).first();
        if (!stored) await getDb().prepare("UPDATE conversation_attachments SET message_id = '' WHERE id = ? AND message_id = ?")
          .bind(claimedAttachment.id, claimedAttachment.message_id).run();
      } catch {
        // Preserve the original error; the attachment expires with the conversation.
      }
    }
    return asPublicError(error, 'We couldn’t send your message. Please refresh and try again.');
  }
}
