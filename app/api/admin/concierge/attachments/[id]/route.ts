import { asError, ensureSchema, getDb, getFiles, requireStaff } from '../../../../../../db';
import { isSafeImageType } from '../../../../../../lib/image-validation';

const noStoreHeaders = { 'cache-control': 'private, no-store, max-age=0' };

function notFound() {
  return new Response('未找到图片', { status: 404, headers: noStoreHeaders });
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ownerId = requireStaff(request);
    await ensureSchema();
    const { id } = await params;
    const attachment = await getDb().prepare(`SELECT a.file_key, a.mime_type FROM conversation_attachments a
      JOIN conversations c ON c.id = a.conversation_id
      WHERE a.id = ? AND c.assigned_to = ? AND c.status IN ('human', 'closed') AND (c.expires_at = '' OR c.expires_at > ?)`)
      .bind(id, ownerId, new Date().toISOString()).first<{ file_key: string; mime_type: string }>();
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
    return asError(error);
  }
}
