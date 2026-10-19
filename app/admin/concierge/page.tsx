'use client';

import Image from 'next/image';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { formatTimeZoneDateTime, getTimeZoneDifferenceMinutes, normalizeTimeZone } from '../../../lib/timezones';
import { TIME_ZONE_LABELS } from '../../../lib/timezone-options';

type QueueBucket = 'waiting_reply' | 'in_progress' | 'completed';
type QueueView = 'all' | QueueBucket;
type Conversation = {
  id: string; locale: string; status: string; assigned_to: string; inquiry_json: string; message_count: number;
  priority?: string; next_action?: string; queue_bucket: QueueBucket; needs_staff_attention: boolean; waiting_seconds: number;
  updated_at: string; lead_id?: string; contact_name?: string; organization?: string; email?: string; lead_status?: string; last_message?: string;
  client_timezone?: string; client_timezone_source?: string;
};
type Lead = { id: string; conversation_id: string; contact_name: string; organization: string; email: string; country: string; timezone: string; status: string; summary_en: string; summary_zh: string; updated_at: string };
type Knowledge = { id: string; category: string; title_en: string; title_zh: string; content_en: string; content_zh: string; status: string; updated_at: string };
type Message = { id: string; sender: string; content: string; citations_json: string; cases_json: string; mode: string; created_at: string };
type AuditEvent = { id: string; event_type: string; metadata_json: string; created_at: string };
type Attachment = {
  id: string; message_id: string; mime_type: string; byte_size: number; status: string; analysis: Record<string, unknown>;
  confidence: number; provider: string; model: string; error_code: string; created_at: string; analyzed_at: string; content_url: string;
};
type Note = { id: string; author_id: string; content: string; created_at: string };
type SemanticSnapshot = {
  language?: string; intent?: string; intentConfidence?: number; intent_confidence?: number; confirmedFacts?: string[]; confirmed_facts?: string[];
  missingFacts?: string[]; missing_facts?: string[]; entities?: Record<string, string | string[]>; ambiguities?: string[]; conflicts?: string[];
  tone?: string; risks?: string[]; humanRequested?: boolean; human_requested?: boolean; caseRequested?: boolean; case_requested?: boolean;
  summaryEn?: string; summary_en?: string; summaryZh?: string; summary_zh?: string;
};
type StaffAnalysis = { id: string; purpose: string; snapshot: SemanticSnapshot; source_message_count: number; prompt_version: string; manual_review?: boolean; created_at: string };
type StaffDraft = {
  id: string; analysis_id: string; version: number; english_content: string; chinese_meaning: string; meaning_changes: string[];
  risks: string[]; cases: Array<{ id?: string; title_en?: string }>; status: string; confirmed_by: string; confirmed_at: string; created_at: string; updated_at: string;
};
type Workflow = {
  claimed_by_current_staff: boolean; requires_reanalysis: boolean; can_claim: boolean; can_analyze: boolean; can_review_manually: boolean; can_generate_draft: boolean;
  can_save_manual_draft: boolean; can_revise_draft: boolean; can_confirm_draft: boolean; can_send_confirmed: boolean;
};
type StaffAssist = {
  contract_version: string;
  queue: { queue_bucket: QueueBucket; needs_staff_attention: boolean; waiting_seconds: number; priority: string; next_action: string; assigned_to: string };
  analysis: StaffAnalysis | null; draft: StaffDraft | null; workflow: Workflow;
};
type SelectedConversation = {
  conversation: Conversation; messages: Message[]; attachments: Attachment[]; events: AuditEvent[]; notes: Note[]; staff_assist: StaffAssist;
};
type ApprovedCase = { id: string; title_en: string; title_zh: string; image_url: string };
type StaffMember = { id: string; label: string };
type Payload = { contract_version: string; conversations: Conversation[]; leads: Lead[]; knowledge: Knowledge[]; approved_cases?: ApprovedCase[]; capabilities?: { can_reassign: boolean }; staff_members?: StaffMember[]; selected: SelectedConversation | null };
type ViewKey = 'conversations' | 'leads' | 'knowledge';
type Notice = { tone: 'success' | 'error'; message: string } | null;

const CONTRACT_VERSION = 'staff-workspace-v1';
const EMPTY: Payload = { contract_version: CONTRACT_VERSION, conversations: [], leads: [], knowledge: [], selected: null };
const EMPTY_WORKFLOW: Workflow = {
  claimed_by_current_staff: false, requires_reanalysis: false, can_claim: false, can_analyze: false, can_review_manually: false, can_generate_draft: false,
  can_save_manual_draft: false, can_revise_draft: false, can_confirm_draft: false, can_send_confirmed: false,
};
const leadLabels: Record<string, string> = { new: '新线索', reviewing: '评估中', contacted: '已联系', qualified: '有效线索', closed: '已关闭' };
const queueLabels: Record<QueueBucket, string> = { waiting_reply: '等待回复', in_progress: '处理中', completed: '已完成' };
const priorityLabels: Record<string, string> = { low: '低', normal: '普通', high: '高', urgent: '紧急' };
const intentLabels: Record<string, string> = {
  service_question: '服务咨询', case_search: '案例查找', brief_update: '补充需求', human_request: '要求人工', commercial_question: '商务问题', unknown: '待判断',
};
const riskLabels: Record<string, string> = {
  human: '客户要求人工', pricing: '报价或预算', guarantee: '交付或质量承诺', confidentiality: '保密协议',
  contract: '合同条款', copyright: '版权与授权', privacy: '隐私与数据处理', legal: '当地法规或合规', local_regulation: '当地法规或合规',
  complaint: '投诉或争议', schedule: '档期确认', no_evidence: '资料依据不足', prompt_injection: '异常指令风险',
};
const handlingLabels: Record<string, string> = {
  search_approved_knowledge: '查询已发布信息', search_authorized_cases: '查找获准展示的案例',
  save_brief_draft: '整理客户需求', request_human: '转交团队跟进',
};

function json<T>(value: string, fallback: T): T {
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const result = await fetch(url, options);
  const body = await result.json().catch(() => ({})) as { error?: string };
  if (!result.ok) throw new Error(body.error || '操作失败');
  return body as T;
}

async function payload(url: string) {
  const next = await api<Payload>(url);
  if (next.contract_version !== CONTRACT_VERSION || (next.selected && next.selected.staff_assist.contract_version !== CONTRACT_VERSION)) {
    throw new Error('工作台需要更新。请刷新页面后重试；如果问题仍然存在，请联系项目负责人。');
  }
  return next;
}

function shortDate(value: string) {
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

function browserTimeZone() {
  try { return normalizeTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone); } catch { return ''; }
}

function timeZoneLabel(timeZone: string) {
  return TIME_ZONE_LABELS.get(timeZone) || timeZone;
}

function timeDifferenceLabel(minutes: number) {
  if (minutes === 0) return '与你当前时间相同（时差 0 小时）';
  const absolute = Math.abs(minutes);
  const hours = Math.floor(absolute / 60);
  const remaining = absolute % 60;
  const amount = `${hours ? `${hours} 小时` : ''}${remaining ? `${remaining} 分钟` : ''}`;
  return `比你${minutes > 0 ? '快' : '慢'} ${amount}`;
}

function customerTimeContext(customerValue: unknown, staffTimeZone: string, now: Date | null) {
  const customerTimeZone = normalizeTimeZone(customerValue);
  if (!customerTimeZone || !now) return '客户时区待确认';
  const customerTime = formatTimeZoneDateTime(customerTimeZone, now, 'zh-CN');
  if (!customerTime) return '客户时区待确认';
  const staffTime = staffTimeZone ? formatTimeZoneDateTime(staffTimeZone, now, 'zh-CN') : '';
  const difference = getTimeZoneDifferenceMinutes(customerTimeZone, staffTimeZone, now);
  const relative = difference === null ? '员工本地时区待确认' : timeDifferenceLabel(difference);
  return `客户当地 ${customerTime}（${timeZoneLabel(customerTimeZone)}） · ${relative}${staffTime ? ` · 员工本地基准 ${staffTime}（${timeZoneLabel(staffTimeZone)}）` : ''}`;
}

function waitingTime(seconds: number) {
  if (seconds < 60) return '刚刚更新';
  if (seconds < 3600) return `等待 ${Math.floor(seconds / 60)} 分钟`;
  if (seconds < 86400) return `等待 ${Math.floor(seconds / 3600)} 小时`;
  return `等待 ${Math.floor(seconds / 86400)} 天`;
}

function isExampleEmail(value?: string) {
  return Boolean(value && /@(example\.com|example\.org|example\.net)$/i.test(value));
}

function snapshotArray(snapshot: SemanticSnapshot | undefined, camel: keyof SemanticSnapshot, snake: keyof SemanticSnapshot) {
  const value = snapshot?.[camel] ?? snapshot?.[snake];
  return Array.isArray(value) ? value.map(String) : [];
}

function StaffAttachmentPreview({ attachment }: { attachment: Attachment }) {
  const [source, setSource] = useState('');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let objectUrl = '';
    let active = true;
    fetch(attachment.content_url)
      .then((response) => { if (!response.ok) throw new Error('Image unavailable'); return response.blob(); })
      .then((blob) => { const next = URL.createObjectURL(blob); if (active) { objectUrl = next; setSource(next); } else URL.revokeObjectURL(next); })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [attachment.content_url]);
  return source ? <Image alt="客户上传的项目图片" height={320} src={source} unoptimized width={480} /> : <span>{failed ? '图片暂时无法加载' : '正在加载受保护的图片…'}</span>;
}

export default function ConciergeAdmin() {
  const [data, setData] = useState<Payload>(EMPTY);
  const [clockNow, setClockNow] = useState<Date | null>(null);
  const staffTimeZone = typeof window === 'undefined' ? '' : browserTimeZone();
  const [view, setView] = useState<ViewKey>('conversations');
  const [queueView, setQueueView] = useState<QueueView>('all');
  const [selectedId, setSelectedId] = useState('');
  const [notice, setNotice] = useState<Notice>(null);
  const [busyAction, setBusyAction] = useState('');
  const [draftEdits, setDraftEdits] = useState({ key: '', english: '', chinese: '' });
  const [queueEdits, setQueueEdits] = useState({ key: '', priority: '', nextAction: '' });
  const [caseEdits, setCaseEdits] = useState<{ key: string; ids: string[] }>({ key: '', ids: [] });
  const [reassignEdits, setReassignEdits] = useState({ key: '', assignedTo: '' });
  const selected = data.selected;
  const assist = selected?.staff_assist;
  const workflow = assist?.workflow ?? EMPTY_WORKFLOW;
  const currentDraft = assist?.draft;
  const draftKey = `${selectedId}:${currentDraft?.id ?? assist?.analysis?.id ?? 'none'}`;
  const draftEnglish = draftEdits.key === draftKey ? draftEdits.english : currentDraft?.english_content ?? '';
  const draftChinese = draftEdits.key === draftKey ? draftEdits.chinese : currentDraft?.chinese_meaning ?? '';
  const selectedCaseIds = caseEdits.key === draftKey ? caseEdits.ids : currentDraft?.cases.map((item) => String(item.id ?? '')).filter(Boolean) ?? [];
  const currentDraftCaseIds = currentDraft?.cases.map((item) => String(item.id ?? '')).filter(Boolean) ?? [];
  const caseSelectionChanged = selectedCaseIds.length !== currentDraftCaseIds.length || currentDraftCaseIds.some((id) => !selectedCaseIds.includes(id));
  const queueKey = selectedId;
  const queuePriority = queueEdits.key === queueKey ? queueEdits.priority : assist?.queue.priority ?? 'normal';
  const queueNextAction = queueEdits.key === queueKey ? queueEdits.nextAction : assist?.queue.next_action ?? '';
  const queueConversation = data.conversations.find((item) => item.id === selectedId);
  const activeConversation = selected?.conversation ? { ...queueConversation, ...selected.conversation } : queueConversation;
  const activeLead = data.leads.find((item) => item.conversation_id === selectedId);
  const conversationTimeZone = normalizeTimeZone(activeConversation?.client_timezone);
  const leadTimeZone = normalizeTimeZone(activeLead?.timezone);
  const customerTimeZone = conversationTimeZone || leadTimeZone;
  const timeZoneSource = conversationTimeZone
    ? activeConversation?.client_timezone_source === 'browser' ? '浏览器设置建议' : activeConversation?.client_timezone_source === 'customer' ? '客户已选择' : '来源待确认'
    : leadTimeZone ? '客户已选择（线索记录）' : '来源待确认';
  const reassignTarget = reassignEdits.key === selectedId ? reassignEdits.assignedTo : activeConversation?.assigned_to ?? '';
  const unsavedEdits = Boolean(currentDraft && (draftEnglish !== currentDraft.english_content || draftChinese !== currentDraft.chinese_meaning || caseSelectionChanged));
  const busy = Boolean(busyAction);
  const inquiryFields = Object.entries(json<Record<string, string | string[]>>(activeConversation?.inquiry_json || '{}', {}))
    .filter(([, value]) => Array.isArray(value) ? value.length : value);
  const handoffEvent = selected?.events.find((item) => item.event_type === 'handoff_requested');
  const handoffMeta = json<{ risk_type?: string; reason?: string; requested_at?: string }>(handoffEvent?.metadata_json || '', {});
  const agentEvent = selected?.events.find((item) => item.event_type === 'agent_turn');
  const agentMeta = json<{ tools?: Array<{ tool: string; status: string }> }>(agentEvent?.metadata_json || '', {});
  const queueCounts = useMemo(() => data.conversations.reduce<Record<QueueView, number>>((counts, item) => {
    counts.all += 1; counts[item.queue_bucket] += 1; return counts;
  }, { all: 0, waiting_reply: 0, in_progress: 0, completed: 0 }), [data.conversations]);
  const filteredConversations = useMemo(() => queueView === 'all' ? data.conversations : data.conversations.filter((item) => item.queue_bucket === queueView), [data.conversations, queueView]);

  useEffect(() => {
    const initial = window.setTimeout(() => setClockNow(new Date()), 0);
    const timer = window.setInterval(() => setClockNow(new Date()), 60_000);
    return () => { window.clearTimeout(initial); window.clearInterval(timer); };
  }, []);
  const snapshot = assist?.analysis?.snapshot;
  const confirmedFacts = snapshotArray(snapshot, 'confirmedFacts', 'confirmed_facts');
  const missingFacts = snapshotArray(snapshot, 'missingFacts', 'missing_facts');
  const summaryZh = String(snapshot?.summaryZh ?? snapshot?.summary_zh ?? '');
  const summaryEn = String(snapshot?.summaryEn ?? snapshot?.summary_en ?? '');
  const confidence = Number(snapshot?.intentConfidence ?? snapshot?.intent_confidence ?? 0);
  const currentStep = !workflow.claimed_by_current_staff ? 1 : workflow.requires_reanalysis ? 2 : !currentDraft ? 3 : currentDraft.status === 'draft' ? 4 : 5;

  useEffect(() => {
    let active = true;
    payload('/api/admin/concierge')
      .then(async (next) => {
        if (!active) return;
        const firstId = next.conversations[0]?.id ?? '';
        setData(next); setSelectedId(firstId);
        if (!firstId) return;
        const selectedPayload = await payload(`/api/admin/concierge?conversation_id=${encodeURIComponent(firstId)}`);
        if (active) setData(selectedPayload);
      })
      .catch((error) => { if (active) setNotice({ tone: 'error', message: error instanceof Error ? error.message : '加载失败' }); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (view !== 'conversations' || !selectedId || busy) return;
    const timer = window.setInterval(() => {
      payload(`/api/admin/concierge?conversation_id=${encodeURIComponent(selectedId)}`)
        .then(setData)
        .catch((error) => setNotice({ tone: 'error', message: error instanceof Error ? error.message : '刷新失败' }));
    }, 12000);
    return () => window.clearInterval(timer);
  }, [view, selectedId, busy]);

  async function load(conversationId = selectedId) {
    const suffix = conversationId ? `?conversation_id=${encodeURIComponent(conversationId)}` : '';
    const next = await payload(`/api/admin/concierge${suffix}`);
    setData(next);
    if (!conversationId && next.conversations[0]) setSelectedId(next.conversations[0].id);
  }

  function selectConversation(id: string) {
    setSelectedId(id); setNotice(null);
    payload(`/api/admin/concierge?conversation_id=${encodeURIComponent(id)}`)
      .then(setData)
      .catch((error) => setNotice({ tone: 'error', message: error instanceof Error ? error.message : '加载失败' }));
  }

  async function run(actionName: string, work: () => Promise<void>, success: string) {
    setBusyAction(actionName); setNotice(null);
    try { await work(); setNotice({ tone: 'success', message: success }); }
    catch (error) { setNotice({ tone: 'error', message: error instanceof Error ? error.message : '操作失败' }); }
    finally { setBusyAction(''); }
  }

  async function action(body: Record<string, unknown>) {
    return api('/api/admin/concierge', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  }

  function perform(actionName: string, body: Record<string, unknown>, success: string) {
    if (!selectedId) return;
    run(actionName, async () => { await action({ ...body, action: actionName, conversation_id: selectedId }); await load(selectedId); }, success);
  }

  function claim() { perform('claim', {}, '已接管当前会话，下一步请分析完整语境'); }
  function analyze() { perform('analyze', {}, '语境分析已更新，可以生成或填写双语草稿'); }
  function reviewManually() { perform('acknowledge_context', { reviewed: true, source_message_count: selected?.conversation.message_count }, '已记录对最新完整对话的人工核对，可填写双语草稿'); }
  function generateDraft() { perform('draft_reply', { case_ids: selectedCaseIds }, '双语草稿已生成，请核对英文与中文含义'); }
  function reviseDraft() { perform('revise_reply', { english_content: draftEnglish, chinese_meaning: draftChinese, case_ids: selectedCaseIds }, '已根据修改生成新版本，请再次核对'); }
  function confirmDraft() { if (currentDraft) perform('confirm_reply', { draft_id: currentDraft.id }, '草稿已由你确认，发送前仍会再次检查状态'); }
  function sendDraft() { if (currentDraft) perform('send_confirmed_reply', { draft_id: currentDraft.id }, '英文回复已发送给客户'); }

  function saveManualDraft() {
    if (!draftEnglish.trim() || !draftChinese.trim()) {
      setNotice({ tone: 'error', message: '人工草稿必须同时填写英文回复和中文核对含义' }); return;
    }
    perform('save_manual_draft', {
      english_content: draftEnglish, chinese_meaning: draftChinese, case_ids: selectedCaseIds,
    }, '人工双语草稿已保存，请核对后确认');
  }

  function saveQueue() {
    perform('update_queue', { priority: queuePriority, next_action: queueNextAction }, '优先级和下一步已更新');
  }

  function completeConversation() { perform('complete', {}, '会话已完成'); }
  function reopenConversation() { perform('reopen', {}, '会话已重开，可继续处理'); }
  function reassignConversation() {
    const member = data.staff_members?.find((item) => item.id === reassignTarget);
    perform('reassign', { assigned_to: reassignTarget }, reassignTarget ? `会话已分配给${member?.label || '所选员工'}` : '会话已退回待接管队列');
  }

  function addNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const content = String(new FormData(form).get('content') ?? '').trim();
    if (!content) return;
    run('add_note', async () => { await action({ action: 'add_note', conversation_id: selectedId, content }); form.reset(); await load(selectedId); }, '内部备注已保存，不会发送给客户');
  }

  function changeLead(id: string, status: string) {
    run('lead_status', async () => { await action({ action: 'lead_status', lead_id: id, status }); await load(); }, '线索状态已更新');
  }

  function addKnowledge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form).entries());
    run('add_knowledge', async () => { await action({ action: 'add_knowledge', ...values, publish: values.publish === 'on' }); form.reset(); await load(); }, '公开知识已保存');
  }

  function changeKnowledge(id: string, status: string) {
    run('knowledge_status', async () => { await action({ action: 'knowledge_status', knowledge_id: id, status }); await load(); }, '知识状态已更新');
  }

  return <main className="concierge-admin-shell" translate="no">
    <aside className="concierge-admin-nav">
      <a className="admin-brand" href="/admin" translate="no"><span>OS</span><div><strong>OmniServe</strong><small translate="yes">公司项目负责人及员工</small></div></a>
      <nav aria-label="海外客服后台">
        <button className={view === 'conversations' ? 'active' : ''} onClick={() => setView('conversations')} type="button"><span>对</span>客户会话<b>{data.conversations.length}</b></button>
        <button className={view === 'leads' ? 'active' : ''} onClick={() => setView('leads')} type="button"><span>客</span>客户线索<b>{data.leads.length}</b></button>
        <button className={view === 'knowledge' ? 'active' : ''} onClick={() => setView('knowledge')} type="button"><span>知</span>公开知识<b>{data.knowledge.length}</b></button>
      </nav>
      <a className="admin-case-link" href="/admin/cases"><span>图</span><div><strong>公开案例发布</strong><small>展示权与双语内容审核</small></div></a>
      <div className="admin-boundary"><strong>公开边界</strong><p>首批服务迪拜、法国、英国和美国，仅使用英语。海外访客只能读取已发布知识和确认具有展示权的案例；人工团队每天北京时间 10:00—22:00 值班。</p><a href="/" target="_blank">查看公开客服</a></div>
    </aside>

    <section className="concierge-admin-main">
      <header className="concierge-admin-head"><div><h1>{view === 'conversations' ? '员工回复工作台' : view === 'leads' ? '客户线索' : '公开知识'}</h1><p>{view === 'conversations' ? '核对对话分析和双语含义，人工确认后只向客户发送英文。' : view === 'leads' ? '依据客户授权管理后续联系状态。' : '只有发布人审核并发布的内容会参与公开客服回答。'}</p></div><span className="private-marker">仅公司员工 · Private</span></header>
      {notice && <div className={`admin-notice ${notice.tone}`} role={notice.tone === 'error' ? 'alert' : 'status'}><span>{notice.message}</span><button onClick={() => setNotice(null)} type="button">关闭</button></div>}

      {view === 'conversations' && <div className="conversation-admin-grid">
        <div className="conversation-index">
          <div className="index-heading"><strong>会话队列</strong><span>{data.conversations.length} 条</span></div>
          <div className="queue-filters" role="group" aria-label="筛选会话状态">{(['all', 'waiting_reply', 'in_progress', 'completed'] as QueueView[]).map((bucket) => <button aria-pressed={queueView === bucket} key={bucket} onClick={() => setQueueView(bucket)} type="button"><span>{bucket === 'all' ? '全部' : queueLabels[bucket]}</span><b>{queueCounts[bucket]}</b></button>)}</div>
          <div className="queue-records">{filteredConversations.map((item) => <button className={`${selectedId === item.id ? 'active' : ''} ${item.needs_staff_attention ? 'attention' : ''}`} key={item.id} onClick={() => selectConversation(item.id)} type="button"><div><b>{item.contact_name || '匿名访客'}</b>{isExampleEmail(item.email) && <em className="example-data-badge">示例数据</em>}</div><span><i className={`queue-dot ${item.queue_bucket}`} />{queueLabels[item.queue_bucket]} · {priorityLabels[item.priority || 'normal'] || '普通'}</span><p>{item.last_message || '会话刚刚建立'}</p><small>{waitingTime(item.waiting_seconds)} · {shortDate(item.updated_at)}</small></button>)}{!filteredConversations.length && <div className="admin-empty">这个队列目前没有会话。</div>}</div>
        </div>

        <section className="admin-thread">
          {selected ? <><div className="thread-heading"><div><span>客户咨询</span><strong>{activeConversation?.contact_name || '匿名访客'}{activeConversation?.organization ? ` · ${activeConversation.organization}` : ''}{isExampleEmail(activeConversation?.email) && <em className="example-data-badge">示例数据</em>}</strong><div className="customer-time-context"><span>时区与当地时间</span><p>{customerTimeContext(customerTimeZone, staffTimeZone, clockNow)}</p><small>时区来源：{timeZoneSource}</small></div></div><div className="thread-owner">{activeConversation?.status === 'closed' ? <button disabled={busy} onClick={reopenConversation} type="button">{busyAction === 'reopen' ? '正在重开…' : '重开会话'}</button> : workflow.claimed_by_current_staff ? <><span>已由我接管</span><button disabled={busy} onClick={completeConversation} type="button">{busyAction === 'complete' ? '正在完成…' : '完成会话'}</button></> : <button disabled={busy || !workflow.can_claim} onClick={claim} type="button">{busyAction === 'claim' ? '正在接管…' : '接管会话'}</button>}</div></div>
            <div className="admin-messages">{selected.messages.map((item) => { const messageAttachments = selected.attachments.filter((attachment) => attachment.message_id === item.id); return <article className={item.sender} key={item.id}><span>{item.sender === 'customer' ? '客户' : item.sender === 'human' ? '人工客服' : '自动客服'} · {shortDate(item.created_at)}</span><p>{item.content}</p>{messageAttachments.map((attachment) => <figure key={attachment.id}><StaffAttachmentPreview attachment={attachment} /><figcaption>{attachment.status === 'analyzed' ? `图片已分析 · 可信度 ${Math.round(attachment.confidence * 100)}%` : attachment.status === 'failed' ? '图片分析失败，保留供员工查看' : '图片等待分析'}</figcaption></figure>)}</article>; })}</div>
            <div className="thread-footnote"><span>内部工作区</span><p>备注、中文含义和分析结果不会发送给客户。</p></div></> : <div className="thread-placeholder">选择一条会话查看完整上下文并开始处理。</div>}
        </section>

        <aside className="admin-context staff-assist-panel">
          {selected && assist ? <>
            <div className="assist-heading"><div><strong>回复流程</strong><span>{queueLabels[assist.queue.queue_bucket]} · {waitingTime(assist.queue.waiting_seconds)}</span></div><em className={`priority ${assist.queue.priority}`}>{priorityLabels[assist.queue.priority] || '普通'}优先级</em></div>
            <ol className="workflow-steps" aria-label="当前处理步骤">{['接管', '对话分析', '双语回复', '人工确认', '发送英文'].map((label, index) => { const step = index + 1; return <li className={step < currentStep ? 'done' : step === currentStep ? 'current' : ''} key={label} aria-current={step === currentStep ? 'step' : undefined}><span>{step}</span><b>{label}</b></li>; })}</ol>

            {data.capabilities?.can_reassign && activeConversation?.status !== 'closed' && <section className="queue-edit assist-section"><header><div><h2>重新分配</h2><p>选择同事接手，或退回待接管队列</p></div></header><div className="queue-edit-fields reassign-fields"><label>接手人<select disabled={busy} onChange={(event) => setReassignEdits({ key: selectedId, assignedTo: event.target.value })} value={reassignTarget}><option value="">退回待接管队列</option>{data.staff_members?.map((member) => <option key={member.id} value={member.id}>{member.label}</option>)}</select></label><button disabled={busy || reassignTarget === (activeConversation?.assigned_to ?? '')} onClick={reassignConversation} type="button">{busyAction === 'reassign' ? '处理中…' : '确认重新分配'}</button></div>{!data.staff_members?.length && <p className="reassign-help">尚未配置其他员工；你仍可将会话退回待接管队列。</p>}</section>}

            {workflow.claimed_by_current_staff && <section className="queue-edit assist-section"><header><div><h2>跟进安排</h2><p>记录紧急程度与下一步动作</p></div></header><div className="queue-edit-fields"><label>优先级<select disabled={busy} onChange={(event) => setQueueEdits({ key: queueKey, priority: event.target.value, nextAction: queueNextAction })} value={queuePriority}>{Object.entries(priorityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>下一步<textarea disabled={busy} maxLength={500} onChange={(event) => setQueueEdits({ key: queueKey, priority: queuePriority, nextAction: event.target.value })} placeholder="例如：等待客户确认视角数量" value={queueNextAction} /></label><button disabled={busy || (queuePriority === assist.queue.priority && queueNextAction === assist.queue.next_action)} onClick={saveQueue} type="button">{busyAction === 'update_queue' ? '保存中…' : '保存跟进安排'}</button></div></section>}

            <section className="assist-section analysis-section">
              <header><div><h2>对话分析</h2><p>{assist.analysis ? `已分析 ${assist.analysis.source_message_count} 条消息` : '整理客户需求、已知信息和待确认事项'}</p></div><button disabled={busy || !workflow.can_analyze} onClick={analyze} type="button">{busyAction === 'analyze' ? '分析中…' : assist.analysis ? '重新分析' : '分析对话'}</button></header>
              {workflow.can_review_manually && <button disabled={busy} onClick={reviewManually} type="button">我已阅读完整对话，采用人工核对</button>}
              {assist.analysis?.manual_review && <p role="status">当前为人工复核。请自行填写并核对双语内容；需要 AI 草稿时，先重新分析语境。</p>}
            {workflow.requires_reanalysis && <div className="reanalysis-warning"><strong>需要更新分析</strong><span>有新消息尚未纳入分析，现有草稿不能发送。</span></div>}
              {assist.analysis ? <div className="analysis-result"><div className="analysis-summary"><span>{intentLabels[String(snapshot?.intent)] || '待判断'} · 置信度 {Math.round(confidence * 100)}%</span><p>{summaryZh || '暂无中文摘要'}</p>{summaryEn && <small>{summaryEn}</small>}</div><div className="fact-columns"><div><strong>已确认</strong>{confirmedFacts.length ? <ul>{confirmedFacts.map((item) => <li key={item}>{item}</li>)}</ul> : <p>暂无</p>}</div><div><strong>仍需确认</strong>{missingFacts.length ? <ul>{missingFacts.map((item) => <li key={item}>{item}</li>)}</ul> : <p>没有必要追问项</p>}</div></div>{Boolean(snapshot?.risks?.length || snapshot?.ambiguities?.length || snapshot?.conflicts?.length) && <div className="analysis-alerts">{snapshot?.risks?.map((item) => <span key={item}>{riskLabels[item] || item}</span>)}{snapshot?.ambiguities?.map((item) => <span key={item}>待澄清：{item}</span>)}{snapshot?.conflicts?.map((item) => <span key={item}>信息不一致：{item}</span>)}</div>}</div> : <p className="assist-empty">接管后可整理客户需求、已知信息和待确认事项。如果自动分析不可用，可阅读完整对话并确认人工核对，再填写双语回复。</p>}
            </section>

            <section className="assist-section draft-section">
              <header><div><h2>双语草稿</h2><p>{currentDraft ? `版本 ${currentDraft.version} · ${currentDraft.status === 'confirmed' ? '已确认' : '待核对'}` : '英文发客户，中文供员工核对'}</p></div><button disabled={busy || !workflow.can_generate_draft} onClick={generateDraft} type="button">{busyAction === 'draft_reply' ? '生成中…' : currentDraft ? '重新生成' : 'AI 生成'}</button></header>
              <label className="draft-field"><span>发送给客户的英文</span><textarea disabled={busy || !workflow.can_save_manual_draft} maxLength={3000} onChange={(event) => setDraftEdits({ key: draftKey, english: event.target.value, chinese: draftChinese })} placeholder="Write the exact English reply the customer will receive." value={draftEnglish} /></label>
              <label className="draft-field"><span>员工核对用中文含义</span><textarea disabled={busy || !workflow.can_save_manual_draft} maxLength={3000} onChange={(event) => setDraftEdits({ key: draftKey, english: draftEnglish, chinese: event.target.value })} placeholder="准确说明英文回复的中文含义，供确认前核对。" value={draftChinese} /></label>
              {currentDraft?.meaning_changes.length ? <div className="meaning-changes"><strong>本版含义变化</strong><ul>{currentDraft.meaning_changes.map((item) => <li key={item}>{item}</li>)}</ul></div> : null}
              {currentDraft?.risks.length ? <div className="draft-risks" role="alert"><strong>当前草稿不能确认</strong>{currentDraft.risks.map((item) => <p key={item}>{riskLabels[item] || item}</p>)}</div> : null}
              <fieldset className="approved-case-picker" disabled={busy || (!workflow.can_save_manual_draft && !workflow.can_generate_draft)}><legend>可附带的获准案例</legend><p>仅列出公开且展示权仍有效的案例；选中的案例会随草稿一并发送。</p>{data.approved_cases?.length ? data.approved_cases.map((item) => <label key={item.id}><input checked={selectedCaseIds.includes(item.id)} onChange={(event) => setCaseEdits({ key: draftKey, ids: event.target.checked ? [...selectedCaseIds, item.id] : selectedCaseIds.filter((id) => id !== item.id) })} type="checkbox" /><span>{item.title_en || item.title_zh}</span></label>) : <small>当前没有符合展示条件的案例。</small>}</fieldset>
              <div className="draft-actions"><button disabled={busy || !workflow.can_save_manual_draft || !draftEnglish.trim() || !draftChinese.trim()} onClick={saveManualDraft} type="button">{busyAction === 'save_manual_draft' ? '保存中…' : currentDraft ? '保存人工新版本' : '保存人工草稿'}</button><button disabled={busy || !workflow.can_revise_draft || (!draftEnglish.trim() && !draftChinese.trim())} onClick={reviseDraft} type="button">{busyAction === 'revise_reply' ? '修订中…' : 'AI 按修改修订'}</button></div>
              {unsavedEdits && <p role="status">文字或案例选择有修改尚未保存。请先保存人工新版本或生成/修订草稿，再核对确认；当前修改不能直接发送。</p>}
              <div className="approval-actions"><button disabled={busy || !workflow.can_confirm_draft || unsavedEdits} onClick={confirmDraft} type="button">{busyAction === 'confirm_reply' ? '确认中…' : currentDraft?.status === 'confirmed' ? '已确认' : '确认中英文一致'}</button><button className="send" disabled={busy || !workflow.can_send_confirmed || unsavedEdits} onClick={sendDraft} type="button">{busyAction === 'send_confirmed_reply' ? '发送中…' : '发送英文回复'}</button></div>
              <p className="approval-note">系统不会自动发送。只有当前最新草稿、无风险句并由你确认后，发送按钮才会启用。</p>
            </section>

            <details className="staff-context-details" open><summary>项目摘要与内部记录</summary><div className="staff-context-body"><strong>当前咨询摘要</strong>{inquiryFields.length ? <dl className="admin-brief-fields">{inquiryFields.map(([field, value]) => <div key={field}><dt>{field.replaceAll('_', ' ')}</dt><dd>{Array.isArray(value) ? value.join('、') : value}</dd></div>)}</dl> : <p className="admin-context-empty">尚无已确认字段</p>}{handoffEvent && <div className="handoff-reason"><span>转交原因</span><strong>{riskLabels[handoffMeta.risk_type || ''] || '需要项目专员判断'}</strong>{handoffMeta.reason && <p>{handoffMeta.reason}</p>}<small>{shortDate(handoffMeta.requested_at || handoffEvent.created_at)}</small></div>}{agentMeta.tools?.length ? <div className="agent-trace"><span>系统处理记录</span>{agentMeta.tools.map((item, index) => <div key={`${item.tool}-${index}`}><b>{handlingLabels[item.tool] || '其他处理'}</b><small>{item.status === 'ok' ? '完成' : item.status === 'empty' ? '没有找到相关信息' : '未完成'}</small></div>)}</div> : null}{activeConversation?.email && <div className="contact-block"><span>经授权联系人</span><a href={`mailto:${activeConversation.email}`}>{activeConversation.email}</a></div>}<div className="internal-notes reminders"><strong>内部备注</strong>{selected.notes.map((note) => <article key={note.id}><p>{note.content}</p><span>{shortDate(note.created_at)}</span></article>)}{!selected.notes.length && <p>暂时没有内部备注。</p>}<form onSubmit={addNote}><label className="sr-only" htmlFor="internal-note">添加内部备注</label><textarea disabled={busy || !workflow.claimed_by_current_staff} id="internal-note" maxLength={3000} name="content" placeholder="只供公司员工查看，不会发送给客户。" /><button disabled={busy || !workflow.claimed_by_current_staff} type="submit">添加备注</button></form></div></div></details>
          </> : <p className="assist-empty">选择一条会话查看工作流程。</p>}
        </aside>
      </div>}

      {view === 'leads' && <div className="lead-list">{data.leads.map((lead) => { const leadLocalZone = normalizeTimeZone(lead.timezone); return <article key={lead.id}><div className="lead-identity"><span>{shortDate(lead.updated_at)} {isExampleEmail(lead.email) && <em className="example-data-badge">示例数据</em>}</span><h2>{lead.contact_name}</h2><p>{lead.organization || '公司待确认'} · {lead.country || '地区待确认'} · {leadLocalZone ? timeZoneLabel(leadLocalZone) : '时区待确认'}</p><small className="lead-time-context">{customerTimeContext(leadLocalZone, staffTimeZone, clockNow)} · 时区来源：客户已选择</small><a href={`mailto:${lead.email}`}>{lead.email}</a></div><div className="lead-summary"><strong>中文摘要</strong><p>{lead.summary_zh}</p><strong>English summary</strong><p>{lead.summary_en}</p></div><label>跟进状态<select value={lead.status} onChange={(event) => changeLead(lead.id, event.target.value)}>{Object.entries(leadLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></article>; })}{!data.leads.length && <div className="admin-empty">客户完成联系授权后，线索会显示在这里。</div>}</div>}

      {view === 'knowledge' && <div className="knowledge-admin-grid"><form className="knowledge-editor" onSubmit={addKnowledge}><h2>添加公开知识</h2><div className="knowledge-form-grid"><label>类别<input name="category" placeholder="services" required /></label><label>英文标题<input name="title_en" required /></label><label>中文标题<input name="title_zh" required /></label><label className="wide">英文正文<textarea name="content_en" required /></label><label className="wide">中文正文<textarea name="content_zh" required /></label><label className="wide">检索关键词<input name="keywords" placeholder="用逗号分隔中英文关键词" /></label><label className="publish-check"><input name="publish" type="checkbox" />保存后立即发布</label></div><button disabled={busy} type="submit">保存知识</button></form><div className="knowledge-records">{data.knowledge.map((item) => <article key={item.id}><div><span>{item.category} · {item.status}</span><h3>{item.title_zh}</h3><strong>{item.title_en}</strong><p>{item.content_zh}</p></div><select value={item.status} onChange={(event) => changeKnowledge(item.id, event.target.value)}><option value="draft">草稿</option><option value="published">已发布</option><option value="archived">已归档</option></select></article>)}</div></div>}
    </section>
  </main>;
}
