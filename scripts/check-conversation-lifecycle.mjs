import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { cleanupExpiredConversations, reservePendingAttachmentDeletion } from '../lib/conversation-lifecycle.ts';
import { derivePublicCustomerMessageId, resolveCustomerMessageReplay } from '../lib/public-message-id.ts';

const sqlite = new DatabaseSync(':memory:');
sqlite.exec(`
  CREATE TABLE conversations (id TEXT PRIMARY KEY, expires_at TEXT NOT NULL, assigned_to TEXT NOT NULL DEFAULT '');
  CREATE TABLE conversation_attachments (id TEXT PRIMARY KEY, conversation_id TEXT, message_id TEXT, file_key TEXT, status TEXT, expires_at TEXT, created_at TEXT);
  CREATE TABLE reply_drafts (conversation_id TEXT);
  CREATE TABLE semantic_analyses (conversation_id TEXT);
  CREATE TABLE conversation_notes (conversation_id TEXT);
  CREATE TABLE model_runs (conversation_id TEXT);
  CREATE TABLE leads (id TEXT PRIMARY KEY, conversation_id TEXT, updated_at TEXT);
  CREATE TABLE chat_messages (id TEXT PRIMARY KEY, conversation_id TEXT, sender TEXT, content TEXT, created_at TEXT);
  CREATE TABLE audit_events (id TEXT, actor_id TEXT, event_type TEXT, entity_type TEXT, entity_id TEXT, metadata_json TEXT, created_at TEXT);
`);

class Statement {
  constructor(database, sql, args = []) { this.database = database; this.sql = sql; this.args = args; }
  bind(...args) { return new Statement(this.database, this.sql, args); }
  async first() { return this.database.prepare(this.sql).get(...this.args) ?? null; }
  async all() { return { results: this.database.prepare(this.sql).all(...this.args) }; }
  async run() { const result = this.database.prepare(this.sql).run(...this.args); return { meta: { changes: Number(result.changes) } }; }
}

const db = {
  prepare(sql) { return new Statement(sqlite, sql); },
  async batch(statements) {
    sqlite.exec('BEGIN');
    try {
      const results = statements.map((statement) => sqlite.prepare(statement.sql).run(...statement.args));
      sqlite.exec('COMMIT');
      return results.map((result) => ({ meta: { changes: Number(result.changes) } }));
    } catch (error) {
      sqlite.exec('ROLLBACK');
      throw error;
    }
  },
};

const future = '2099-01-01T00:00:00.000Z';
sqlite.prepare('INSERT INTO conversation_attachments VALUES (?, ?, ?, ?, ?, ?, ?)')
  .run('pending', 'active', '', 'pending-file', 'uploaded', future, '2026-10-19T00:00:00.000Z');
const firstDelete = await reservePendingAttachmentDeletion(db, 'pending', 'active', '2026-10-19T00:00:00.000Z');
assert.equal(firstDelete.claimed, true);
assert.equal(firstDelete.row.status, 'deleting');
const claimRace = sqlite.prepare(`UPDATE conversation_attachments SET message_id = 'message'
  WHERE id = 'pending' AND message_id = '' AND status <> 'deleting'`).run();
assert.equal(Number(claimRace.changes), 0, 'a claimed image cannot be sent while deletion owns it');
const deleteRetry = await reservePendingAttachmentDeletion(db, 'pending', 'active', '2026-10-19T00:00:01.000Z');
assert.equal(deleteRetry.claimed, false);
assert.equal(deleteRetry.row.status, 'deleting', 'a failed delete keeps a row that can be retried');

sqlite.prepare('INSERT INTO conversation_attachments VALUES (?, ?, ?, ?, ?, ?, ?)')
  .run('sent', 'active', 'sent-message', 'sent-file', 'analyzed', future, '2026-10-19T00:00:00.000Z');
const sentDelete = await reservePendingAttachmentDeletion(db, 'sent', 'active', '2026-10-19T00:00:00.000Z');
assert.equal(sentDelete.claimed, false);
assert.equal(sentDelete.row.message_id, 'sent-message', 'sent attachments cannot be claimed for deletion');

const expiredAt = '2020-01-01T00:00:00.000Z';
sqlite.prepare('INSERT INTO conversations (id, expires_at) VALUES (?, ?)').run('expired-failure', expiredAt);
sqlite.prepare('INSERT INTO conversations (id, expires_at) VALUES (?, ?)').run('expired-success', expiredAt);
sqlite.prepare('INSERT INTO conversations (id, expires_at) VALUES (?, ?)').run('expired-no-bucket', expiredAt);
sqlite.prepare('INSERT INTO conversation_attachments VALUES (?, ?, ?, ?, ?, ?, ?)')
  .run('expired-a', 'expired-failure', '', 'fail-file', 'uploaded', expiredAt, expiredAt);
sqlite.prepare('INSERT INTO conversation_attachments VALUES (?, ?, ?, ?, ?, ?, ?)')
  .run('expired-b', 'expired-success', '', 'good-file', 'uploaded', expiredAt, expiredAt);
sqlite.prepare('INSERT INTO conversation_attachments VALUES (?, ?, ?, ?, ?, ?, ?)')
  .run('expired-c', 'expired-no-bucket', '', 'no-bucket-file', 'uploaded', expiredAt, expiredAt);
let failObjectDelete = true;
const files = { async delete(key) { if (key === 'fail-file' && failObjectDelete) throw new Error('synthetic failure'); } };
const cleanupNow = '2026-10-19T12:00:00.000Z';
assert.equal(await cleanupExpiredConversations(db, undefined, cleanupNow), 0, 'without object storage, cleanup preserves attachment indexes');
assert.ok(sqlite.prepare("SELECT 1 FROM conversation_attachments WHERE id = 'expired-c'").get());
assert.equal(await cleanupExpiredConversations(db, files, cleanupNow), 2);
assert.ok(sqlite.prepare("SELECT 1 FROM conversations WHERE id = 'expired-failure'").get());
assert.ok(sqlite.prepare("SELECT 1 FROM conversation_attachments WHERE id = 'expired-a'").get());
assert.equal(sqlite.prepare("SELECT 1 FROM conversations WHERE id = 'expired-success'").get(), undefined);
assert.equal(sqlite.prepare("SELECT 1 FROM conversations WHERE id = 'expired-no-bucket'").get(), undefined);

sqlite.prepare('INSERT INTO conversations (id, expires_at, assigned_to) VALUES (?, ?, ?)').run('active', future, '');
sqlite.prepare('INSERT INTO conversations (id, expires_at, assigned_to) VALUES (?, ?, ?)').run('legacy', '', '');
sqlite.prepare('INSERT INTO conversations (id, expires_at, assigned_to) VALUES (?, ?, ?)').run('claimed', future, 'staff-b');
sqlite.prepare('INSERT INTO leads VALUES (?, ?, ?)').run('lead-expired', 'expired-failure', cleanupNow);
sqlite.prepare('INSERT INTO leads VALUES (?, ?, ?)').run('lead-active', 'active', cleanupNow);
sqlite.prepare('INSERT INTO leads VALUES (?, ?, ?)').run('lead-legacy', 'legacy', cleanupNow);
sqlite.prepare('INSERT INTO leads VALUES (?, ?, ?)').run('lead-claimed', 'claimed', cleanupNow);
const adminRoute = readFileSync(new URL('../app/api/admin/concierge/route.ts', import.meta.url), 'utf8');
assert.match(adminRoute, /FROM conversations c LEFT JOIN leads l ON l\.conversation_id = c\.id[\s\S]*?WHERE \(c\.assigned_to = '' OR c\.assigned_to = \?\) AND \(c\.expires_at = '' OR c\.expires_at > \?\)/);
assert.match(adminRoute, /FROM leads l JOIN conversations c ON c\.id = l\.conversation_id[\s\S]*?WHERE \(c\.assigned_to = '' OR c\.assigned_to = \?\) AND \(c\.expires_at = '' OR c\.expires_at > \?\)/);
assert.match(adminRoute, /FROM conversations WHERE id = \? AND \(assigned_to = '' OR assigned_to = \?\) AND \(expires_at = '' OR expires_at > \?\)/);
const queueView = sqlite.prepare(`SELECT c.id FROM conversations c
  WHERE (c.assigned_to = '' OR c.assigned_to = ?) AND (c.expires_at = '' OR c.expires_at > ?)
  ORDER BY c.id`).all('staff-a', cleanupNow).map((row) => row.id);
const leadView = sqlite.prepare(`SELECT l.id FROM leads l JOIN conversations c ON c.id = l.conversation_id
  WHERE (c.assigned_to = '' OR c.assigned_to = ?) AND (c.expires_at = '' OR c.expires_at > ?)
  ORDER BY l.id`).all('staff-a', cleanupNow).map((row) => row.id);
const selectedView = (id) => sqlite.prepare(`SELECT id FROM conversations WHERE id = ?
  AND (assigned_to = '' OR assigned_to = ?) AND (expires_at = '' OR expires_at > ?)`).get(id, 'staff-a', cleanupNow);
assert.ok(sqlite.prepare("SELECT 1 FROM conversations WHERE id = 'expired-failure'").get(), 'failed cleanup leaves its expired row available for retry');
assert.ok(!queueView.includes('expired-failure') && !leadView.includes('lead-expired'));
assert.equal(selectedView('expired-failure'), undefined);
assert.ok(queueView.includes('active') && queueView.includes('legacy'));
assert.ok(leadView.includes('lead-active') && leadView.includes('lead-legacy'));
assert.equal(selectedView('active').id, 'active');
assert.equal(selectedView('legacy').id, 'legacy', 'legacy empty-expiry rows remain visible');
assert.ok(!queueView.includes('claimed') && !leadView.includes('lead-claimed'), 'expiry filtering preserves staff ownership isolation');

failObjectDelete = false;
assert.equal(await cleanupExpiredConversations(db, files, cleanupNow), 1, 'later cleanup retries and removes the remaining expired record');
assert.equal(sqlite.prepare("SELECT 1 FROM conversations WHERE id = 'expired-failure'").get(), undefined);

const clientId = '123e4567-e89b-12d3-a456-426614174000';
const savedId = await derivePublicCustomerMessageId('conversation-one', clientId);
assert.equal(await derivePublicCustomerMessageId('conversation-one', clientId), savedId, 'same conversation and client UUID produce a stable message id');
assert.notEqual(await derivePublicCustomerMessageId('conversation-two', clientId), savedId, 'the same client UUID is isolated across conversations');
sqlite.prepare('INSERT INTO chat_messages VALUES (?, ?, ?, ?, ?)')
  .run(savedId, 'conversation-one', 'customer', 'Please call me about the project.', '2026-10-19T00:00:00.000Z');
sqlite.prepare('INSERT INTO conversation_attachments VALUES (?, ?, ?, ?, ?, ?, ?)')
  .run('saved-image', 'conversation-one', savedId, 'saved-image-file', 'uploaded', future, '2026-10-19T00:00:00.000Z');
assert.equal(await resolveCustomerMessageReplay(db, 'conversation-one', savedId, 'Please call me about the project.', 'saved-image'), 'duplicate', 'a saved matching message is acknowledged');
assert.equal(await resolveCustomerMessageReplay(db, 'conversation-one', savedId, 'Please call me about another project.', 'saved-image'), 'conflict', 'changed text cannot reuse the same idempotency key');
assert.equal(await resolveCustomerMessageReplay(db, 'conversation-one', savedId, 'Please call me about the project.', ''), 'conflict', 'changed attachments cannot reuse the same idempotency key');
assert.equal(await resolveCustomerMessageReplay(db, 'conversation-one', 'not-yet-saved', 'A new request.', ''), 'missing', 'an unsaved message remains eligible for its first processing attempt');
const otherConversationId = await derivePublicCustomerMessageId('conversation-two', clientId);
assert.equal(await resolveCustomerMessageReplay(db, 'conversation-two', otherConversationId, 'Please call me about the project.', 'saved-image'), 'missing', 'a saved message in one conversation is not visible in another');

sqlite.close();
console.log('Conversation lifecycle checks passed.');
