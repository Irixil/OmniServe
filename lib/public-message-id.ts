export async function derivePublicCustomerMessageId(conversationId: string, clientMessageId: string) {
  const bytes = new TextEncoder().encode(`${conversationId}:${clientMessageId}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `customer_${hex}`;
}

export async function resolveCustomerMessageReplay(
  db: D1Database, conversationId: string, messageId: string, content: string, attachmentId: string,
) {
  const message = await db.prepare(`SELECT content FROM chat_messages
    WHERE id = ? AND conversation_id = ? AND sender = 'customer'`).bind(messageId, conversationId).first<{ content: string }>();
  if (!message) return 'missing' as const;
  const attachment = await db.prepare(`SELECT id FROM conversation_attachments
    WHERE conversation_id = ? AND message_id = ? ORDER BY created_at ASC LIMIT 1`).bind(conversationId, messageId).first<{ id: string }>();
  return message.content === content && (attachment?.id ?? '') === attachmentId ? 'duplicate' as const : 'conflict' as const;
}
