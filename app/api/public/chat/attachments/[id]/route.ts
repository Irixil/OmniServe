import { ensureSchema, getDb, getFiles } from '../../../../../../db';
import { isSafeImageType } from '../../../../../../lib/image-validation';
import { reservePendingAttachmentDeletion } from '../../../../../../lib/conversation-lifecycle';
import { asPublicError, enforcePublicRateLimit, requirePublicConversation } from '../../../../../../lib/public-conversation';

const noStoreHeaders = { 'cache-control': 'private, no-store, max-age=0' };

function notFound() {
  return new Response('Not found', { status: 404, headers: noStoreHeaders });
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await ensureSchema();
    const url = new URL(request.url);
    let conversation;
    try {
      conversation = await requirePublicConversation(url.searchParams.get('conversation_id') ?? '', request.headers.get('x-conversation-token') ?? '');
    } catch (error) {
      if (error instanceof Response && [401, 404, 410].includes(error.status)) return notFound();
      throw error;
    }
    const { id } = await params;
    await enforcePublicRateLimit(request, `image-read:${conversation.id}`, 120, 600);
    const attachment = await getDb().prepare(`SELECT file_key, mime_type FROM conversation_attachments
      WHERE id = ? AND conversation_id = ? AND expires_at > ?`).bind(id, conversation.id, new Date().toISOString())
      .first<{ file_key: string; mime_type: string }>();
    if (!attachment || !isSafeImageType(attachment.mime_type)) return notFound();
    const object = await getFiles().get(attachment.file_key);
    if (!object) return notFound();
    return new Response(object.body, { headers: {
      'content-type': attachment.mime_type,
      ...noStoreHeaders,
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
    } });
  } catch (error) {
    return asPublicError(error, 'We couldn’t load this image. Please return to the conversation and try again.');
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await ensureSchema();
    const url = new URL(request.url);
    const conversation = await requirePublicConversation(url.searchParams.get('conversation_id') ?? '', request.headers.get('x-conversation-token') ?? '');
    await enforcePublicRateLimit(request, `image-remove:${conversation.id}`, 40, 600);
    const { id } = await params;
    const now = new Date().toISOString();
    const db = getDb();
    const { row: existing, claimed } = await reservePendingAttachmentDeletion(db, id, conversation.id, now);
    if (!existing || existing.expires_at <= now) return Response.json({ error: 'This image is no longer available. Upload it again if you still need it.' }, { status: 404 });
    if (existing.message_id) return Response.json({ error: 'This image is already part of a sent message and cannot be removed.' }, { status: 409 });
    if (!claimed && existing.status !== 'deleting') return Response.json({ error: 'This image changed while you were removing it. Refresh and try again.' }, { status: 409 });
    if (!existing.file_key) return Response.json({ error: 'This image could not be removed. Please try again.' }, { status: 409 });
    try {
      await getFiles().delete(existing.file_key);
    } catch {
      console.error('pending attachment removal failed');
      return Response.json({ error: 'We couldn’t remove this image. Please try again.' }, { status: 503, headers: noStoreHeaders });
    }
    await db.prepare(`DELETE FROM conversation_attachments
      WHERE id = ? AND conversation_id = ? AND message_id = '' AND status = 'deleting'`).bind(id, conversation.id).run();
    return Response.json({ deleted: true }, { headers: noStoreHeaders });
  } catch (error) {
    return asPublicError(error, 'We couldn’t remove this image. Please try again.');
  }
}
