import { ensureSchema, getDb, getFiles } from '../../../../../db';
import { hasSafeImageDimensions, hasUnsafeImageMetadata, hasValidImageSignature, isSafeImageType } from '../../../../../lib/image-validation';
import { asPublicError, enforcePublicRateLimit, requirePublicConversation } from '../../../../../lib/public-conversation';
import { readFormBody } from '../../../../../lib/request-body';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

function digestHex(buffer: ArrayBuffer) {
  return crypto.subtle.digest('SHA-256', buffer).then((digest) =>
    [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join(''));
}

export async function POST(request: Request) {
  let fileKey = '';
  try {
    await ensureSchema();
    const form = await readFormBody(request, MAX_IMAGE_BYTES + 1024 * 1024);
    const conversation = await requirePublicConversation(
      String(form.get('conversation_id') ?? ''),
      request.headers.get('x-conversation-token') ?? '',
    );
    await enforcePublicRateLimit(request, `image-upload:${conversation.id}`, 20, 600);
    const count = await getDb().prepare('SELECT COUNT(*) AS count FROM conversation_attachments WHERE conversation_id = ?')
      .bind(conversation.id).first<{ count: number }>();
    if (Number(count?.count ?? 0) >= 20) return Response.json({ error: 'You can attach up to 20 images to this conversation. Continue without another image or start a new conversation.' }, { status: 422 });

    const file = form.get('file');
    if (!(file instanceof File) || !isSafeImageType(file.type)) return Response.json({ error: 'Please upload a JPG, PNG, or WebP image.' }, { status: 422 });
    if (!file.size || file.size > MAX_IMAGE_BYTES) return Response.json({ error: 'Choose a non-empty image under 10 MB and try again.' }, { status: 422 });
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    if (!hasValidImageSignature(file.type, bytes)) return Response.json({ error: 'We couldn’t read this as a JPG, PNG, or WebP image. Export a fresh copy and try again.' }, { status: 422 });
    if (!hasSafeImageDimensions(file.type, bytes)) return Response.json({ error: 'This image is too large or couldn’t be read. Resize or export it again, then upload it.' }, { status: 422 });
    if (hasUnsafeImageMetadata(file.type, bytes)) return Response.json({ error: 'For privacy, export a fresh copy without embedded image details, then upload it again.' }, { status: 422 });

    const sha256 = await digestHex(buffer);
    const existing = await getDb().prepare(`SELECT id, message_id, status, mime_type, byte_size FROM conversation_attachments
      WHERE conversation_id = ? AND sha256 = ?`).bind(conversation.id, sha256)
      .first<{ id: string; message_id: string; status: string; mime_type: string; byte_size: number }>();
    if (existing?.message_id) return Response.json({ error: 'This image is already attached to a message.' }, { status: 409 });
    if (existing?.status === 'deleting') return Response.json({ error: 'This image is being removed. Please upload it again in a moment.' }, { status: 409 });
    if (existing) return Response.json({ id: existing.id, status: existing.status, mime_type: existing.mime_type, byte_size: existing.byte_size, reused: true });

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    fileKey = `customer-attachments/${conversation.id}/${id}`;
    await getFiles().put(fileKey, bytes, { httpMetadata: { contentType: file.type } });
    const inserted = await getDb().prepare(`INSERT OR IGNORE INTO conversation_attachments
      (id, conversation_id, message_id, file_key, mime_type, byte_size, sha256, status, analysis_json, confidence, provider, model, error_code, created_at, analyzed_at, expires_at)
      VALUES (?, ?, '', ?, ?, ?, ?, 'uploaded', '{}', 0, '', '', '', ?, '', ?)`)
      .bind(id, conversation.id, fileKey, file.type, file.size, sha256, now, conversation.expires_at).run();
    if (!inserted.meta.changes) {
      await getFiles().delete(fileKey).catch(() => undefined);
      fileKey = '';
      const duplicate = await getDb().prepare(`SELECT id, status, mime_type, byte_size FROM conversation_attachments
        WHERE conversation_id = ? AND sha256 = ?`).bind(conversation.id, sha256)
        .first<{ id: string; status: string; mime_type: string; byte_size: number }>();
      if (duplicate) return Response.json({ ...duplicate, reused: true });
      throw new Error('Attachment insert conflict');
    }
    return Response.json({ id, status: 'uploaded', mime_type: file.type, byte_size: file.size, reused: false }, { status: 201 });
  } catch (error) {
    if (fileKey) await getFiles().delete(fileKey).catch(() => undefined);
    return asPublicError(error, 'We couldn’t upload this image. Please try again with a fresh copy.');
  }
}
