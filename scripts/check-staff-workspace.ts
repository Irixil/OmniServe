import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildStaffWorkspaceView, staffQueueSummary } from '../lib/staff-workspace.ts';

const ownerId = 'staff-1';
const baseConversation = {
  id: 'conversation-1', status: 'human', assigned_to: ownerId, message_count: 4,
  priority: 'high', next_action: 'Review the latest reference', waiting_seconds: 120,
};
const analysis = {
  id: 'analysis-1', status: 'valid', purpose: 'staff_assist', source_message_count: 4,
  snapshot_json: JSON.stringify({ intent: 'brief_update', summaryZh: '客户补充了参考图要求', ambiguities: [] }),
  prompt_version: 'semantic-v2', created_at: '2026-09-08T00:00:00.000Z',
};
const safeDraft = {
  id: 'draft-1', analysis_id: 'analysis-1', version: 1, status: 'draft',
  english_content: 'Thank you. We will review the reference with the project team.',
  chinese_meaning: '感谢。我们会和项目团队一起查看该参考图。',
  meaning_changes_json: '[]', risks_json: '[]', cases_json: '[]',
  confirmed_by: '', confirmed_at: '', created_at: '2026-09-08T00:01:00.000Z', updated_at: '2026-09-08T00:01:00.000Z',
};

assert.deepEqual(staffQueueSummary({ status: 'requested', assigned_to: '', waiting_seconds: 90 }), {
  queue_bucket: 'waiting_reply', needs_staff_attention: true, waiting_seconds: 90,
});
assert.equal(staffQueueSummary({ status: 'human', assigned_to: ownerId }).queue_bucket, 'in_progress');
assert.equal(staffQueueSummary({ status: 'closed', assigned_to: ownerId }).queue_bucket, 'completed');

const unclaimed = buildStaffWorkspaceView({
  conversation: { ...baseConversation, status: 'requested', assigned_to: '' }, ownerId, analyses: [], drafts: [],
});
assert.equal(unclaimed.workflow.can_claim, true);
assert.equal(unclaimed.workflow.can_analyze, false);
assert.equal(unclaimed.workflow.can_send_confirmed, false);

const needsAnalysis = buildStaffWorkspaceView({ conversation: baseConversation, ownerId, analyses: [], drafts: [] });
assert.equal(needsAnalysis.workflow.requires_reanalysis, true);
assert.equal(needsAnalysis.workflow.can_save_manual_draft, false);
assert.equal(needsAnalysis.workflow.can_generate_draft, false);

const readyToDraft = buildStaffWorkspaceView({ conversation: baseConversation, ownerId, analyses: [analysis], drafts: [] });
assert.equal(readyToDraft.analysis?.snapshot.summaryZh, '客户补充了参考图要求');
assert.equal(readyToDraft.workflow.can_generate_draft, true);
assert.equal(readyToDraft.workflow.can_save_manual_draft, true);

const readyToConfirm = buildStaffWorkspaceView({ conversation: baseConversation, ownerId, analyses: [analysis], drafts: [safeDraft] });
assert.equal(readyToConfirm.draft?.chinese_meaning, '感谢。我们会和项目团队一起查看该参考图。');
assert.equal(readyToConfirm.workflow.can_confirm_draft, true);
assert.equal(readyToConfirm.workflow.can_send_confirmed, false);

const risky = buildStaffWorkspaceView({
  conversation: baseConversation, ownerId, analyses: [analysis],
  drafts: [{ ...safeDraft, risks_json: '["schedule"]' }],
});
assert.equal(risky.workflow.can_confirm_draft, false);

const confirmed = buildStaffWorkspaceView({
  conversation: baseConversation, ownerId, analyses: [analysis],
  drafts: [{ ...safeDraft, status: 'confirmed', confirmed_by: ownerId }],
});
assert.equal(confirmed.workflow.can_send_confirmed, true);

const otherOwner = buildStaffWorkspaceView({
  conversation: baseConversation, ownerId: 'staff-2', analyses: [analysis],
  drafts: [{ ...safeDraft, status: 'confirmed', confirmed_by: ownerId }],
});
assert.equal(otherOwner.workflow.can_send_confirmed, false);

const newMessage = buildStaffWorkspaceView({
  conversation: { ...baseConversation, message_count: 5 }, ownerId, analyses: [analysis],
  drafts: [{ ...safeDraft, status: 'confirmed', confirmed_by: ownerId }],
});
assert.equal(newMessage.analysis, null);
assert.equal(newMessage.draft, null);
assert.equal(newMessage.workflow.requires_reanalysis, true);
assert.equal(newMessage.workflow.can_send_confirmed, false);

const closed = buildStaffWorkspaceView({
  conversation: { ...baseConversation, status: 'closed' }, ownerId, analyses: [analysis], drafts: [safeDraft],
});
assert.equal(closed.queue.queue_bucket, 'completed');
assert.equal(closed.workflow.can_analyze, false);
assert.equal(closed.workflow.can_send_confirmed, false);

const routeSource = await readFile(new URL('../app/api/admin/concierge/route.ts', import.meta.url), 'utf8');
assert.match(routeSource, /if \(action === 'reply'\)[\s\S]{0,240}requires_confirmation: true[\s\S]{0,80}, 409\)/);
assert.match(routeSource, /if \(action === 'save_manual_draft'\)[\s\S]{0,240}validAnalysis\(conversation\)/);
assert.doesNotMatch(routeSource, /'staff_manual'/);
const manuallyReviewed = buildStaffWorkspaceView({ conversation: baseConversation, ownerId,
  analyses: [{ ...analysis, model: 'human-review' }], drafts: [safeDraft] });
assert.equal(manuallyReviewed.analysis?.manual_review, true);
assert.equal(manuallyReviewed.workflow.can_generate_draft, false);
assert.equal(manuallyReviewed.workflow.can_save_manual_draft, true);
assert.equal(manuallyReviewed.workflow.can_confirm_draft, true);
const staleManualReview = buildStaffWorkspaceView({ conversation: { ...baseConversation, message_count: 5 }, ownerId,
  analyses: [{ ...analysis, model: 'human-review' }], drafts: [safeDraft] });
assert.equal(staleManualReview.workflow.can_save_manual_draft, false);
assert.equal(staleManualReview.workflow.can_send_confirmed, false);

console.log('Staff workspace backend checks passed');
