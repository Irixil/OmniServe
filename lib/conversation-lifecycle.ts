export async function reservePendingAttachmentDeletion(db: D1Database, id: string, conversationId: string, now: string) {
  const claimed = await db.prepare(`UPDATE conversation_attachments SET status = 'deleting'
    WHERE id = ? AND conversation_id = ? AND message_id = '' AND status <> 'deleting' AND expires_at > ?
    RETURNING file_key, message_id, status, expires_at`).bind(id, conversationId, now)
    .first<{ file_key: string; message_id: string; status: string; expires_at: string }>();
  if (claimed) return { row: claimed, claimed: true };
  const row = await db.prepare(`SELECT file_key, message_id, status, expires_at FROM conversation_attachments
    WHERE id = ? AND conversation_id = ?`).bind(id, conversationId)
    .first<{ file_key: string; message_id: string; status: string; expires_at: string }>();
  return { row, claimed: false };
}

export async function cleanupExpiredConversations(db: D1Database, files?: R2Bucket, now = new Date().toISOString()) {
  const expired = await db.prepare('SELECT id FROM conversations WHERE expires_at <> ? AND expires_at <= ? ORDER BY expires_at ASC LIMIT 20')
    .bind('', now).all<{ id: string }>();
  if (!expired.results.length) return 0;
  let deletedCount = 0;
  for (const { id } of expired.results) {
    const attachments = await db.prepare('SELECT file_key FROM conversation_attachments WHERE conversation_id = ?').bind(id).all<{ file_key: string }>();
    if (attachments.results.length && !files) continue;
    if (files && attachments.results.length) {
      const deletions = await Promise.allSettled(attachments.results.map((item) => files.delete(item.file_key)));
      const failed = deletions.filter((item) => item.status === 'rejected').length;
      if (failed) {
        console.error('expired conversation attachment cleanup incomplete', { failed });
        continue;
      }
    }
    await db.batch([
      db.prepare('DELETE FROM reply_drafts WHERE conversation_id = ?').bind(id),
      db.prepare('DELETE FROM semantic_analyses WHERE conversation_id = ?').bind(id),
      db.prepare('DELETE FROM conversation_notes WHERE conversation_id = ?').bind(id),
      db.prepare('DELETE FROM model_runs WHERE conversation_id = ?').bind(id),
      db.prepare('DELETE FROM leads WHERE conversation_id = ?').bind(id),
      db.prepare('DELETE FROM conversation_attachments WHERE conversation_id = ?').bind(id),
      db.prepare('DELETE FROM chat_messages WHERE conversation_id = ?').bind(id),
      db.prepare("DELETE FROM audit_events WHERE entity_type = 'conversation' AND entity_id = ?").bind(id),
      db.prepare('DELETE FROM conversations WHERE id = ? AND expires_at <= ?').bind(id, now),
    ]);
    deletedCount += 1;
  }
  if (deletedCount) {
    await db.prepare('INSERT INTO audit_events (id, actor_id, event_type, entity_type, entity_id, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), 'system', 'expired_conversations_deleted', 'cleanup', now.slice(0, 10), JSON.stringify({ count: deletedCount }), now).run();
  }
  return deletedCount;
}
