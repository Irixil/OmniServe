type Row = Record<string, unknown>;

export const STAFF_WORKSPACE_CONTRACT_VERSION = 'staff-workspace-v1';

function text(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function json<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string') return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

export function staffQueueSummary(conversation: Row) {
  const status = text(conversation.status);
  const assignedTo = text(conversation.assigned_to);
  const bucket = status === 'closed' ? 'completed'
    : assignedTo || status === 'human' ? 'in_progress'
      : 'waiting_reply';
  return {
    queue_bucket: bucket,
    needs_staff_attention: status === 'requested',
    waiting_seconds: Math.max(0, number(conversation.waiting_seconds)),
  } as const;
}

export function buildStaffWorkspaceView(args: {
  conversation: Row;
  ownerId: string;
  analyses: Row[];
  drafts: Row[];
}) {
  const status = text(args.conversation.status);
  const assignedTo = text(args.conversation.assigned_to);
  const messageCount = number(args.conversation.message_count);
  const claimedByCurrentStaff = status === 'human' && assignedTo === args.ownerId;
  const latestAnalysis = args.analyses[0];
  const analysisCurrent = Boolean(
    latestAnalysis
    && text(latestAnalysis.status) === 'valid'
    && number(latestAnalysis.source_message_count) === messageCount,
  );
  const latestDraft = args.drafts[0];
  const manualReview = text(latestAnalysis?.model) === 'human-review';
  const draftCurrent = Boolean(
    latestDraft
    && analysisCurrent
    && text(latestDraft.analysis_id) === text(latestAnalysis?.id)
    && !['stale', 'sent'].includes(text(latestDraft.status)),
  );
  const risks = draftCurrent ? json<string[]>(latestDraft?.risks_json, []) : [];
  const draftStatus = draftCurrent ? text(latestDraft?.status) : '';

  return {
    contract_version: STAFF_WORKSPACE_CONTRACT_VERSION,
    queue: {
      ...staffQueueSummary(args.conversation),
      priority: text(args.conversation.priority) || 'normal',
      next_action: text(args.conversation.next_action),
      assigned_to: assignedTo,
    },
    analysis: analysisCurrent && latestAnalysis ? {
      id: text(latestAnalysis.id),
      purpose: text(latestAnalysis.purpose),
      snapshot: json<Row>(latestAnalysis.snapshot_json, {}),
      source_message_count: number(latestAnalysis.source_message_count),
      prompt_version: text(latestAnalysis.prompt_version),
      manual_review: manualReview,
      created_at: text(latestAnalysis.created_at),
    } : null,
    draft: draftCurrent && latestDraft ? {
      id: text(latestDraft.id),
      analysis_id: text(latestDraft.analysis_id),
      version: number(latestDraft.version),
      english_content: text(latestDraft.english_content),
      chinese_meaning: text(latestDraft.chinese_meaning),
      meaning_changes: json<string[]>(latestDraft.meaning_changes_json, []),
      risks,
      cases: json<Row[]>(latestDraft.cases_json, []),
      status: draftStatus,
      confirmed_by: text(latestDraft.confirmed_by),
      confirmed_at: text(latestDraft.confirmed_at),
      created_at: text(latestDraft.created_at),
      updated_at: text(latestDraft.updated_at),
    } : null,
    workflow: {
      claimed_by_current_staff: claimedByCurrentStaff,
      requires_reanalysis: claimedByCurrentStaff && !analysisCurrent,
      can_claim: !assignedTo && status !== 'closed',
      can_analyze: claimedByCurrentStaff && messageCount > 0,
      can_review_manually: claimedByCurrentStaff && messageCount > 0,
      can_generate_draft: claimedByCurrentStaff && analysisCurrent && !manualReview,
      can_save_manual_draft: claimedByCurrentStaff && analysisCurrent,
      can_revise_draft: claimedByCurrentStaff && draftCurrent && draftStatus === 'draft',
      can_confirm_draft: claimedByCurrentStaff && draftCurrent && draftStatus === 'draft' && risks.length === 0,
      can_send_confirmed: claimedByCurrentStaff && draftCurrent && draftStatus === 'confirmed'
        && text(latestDraft?.confirmed_by) === args.ownerId && risks.length === 0,
    },
  };
}
