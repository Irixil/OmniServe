import { ensureSchema, getDb, getFiles } from '../../../../../db';
import { isSafeImageType } from '../../../../../lib/image-validation';
import { asPublicError } from '../../../../../lib/public-conversation';

const noStoreHeaders = { 'cache-control': 'private, no-store, max-age=0' };

function notFound() {
  return new Response('Not found', { status: 404, headers: noStoreHeaders });
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await ensureSchema();
    const { id } = await params;
    const now = new Date().toISOString();
    const asset = await getDb().prepare("SELECT file_key, mime_type FROM assets WHERE id = ? AND visibility = 'public' AND rights_status = 'approved' AND rights_proof_ref <> '' AND rights_approved_by <> '' AND rights_approved_at <> '' AND (rights_expires_at = '' OR rights_expires_at >= ?)").bind(id, now).first<{ file_key: string; mime_type: string }>();
    if (!asset || !isSafeImageType(asset.mime_type)) return notFound();
    const object = await getFiles().get(asset.file_key);
    if (!object) return notFound();
    return new Response(object.body, { headers: {
      'content-type': asset.mime_type,
      ...noStoreHeaders,
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
    } });
  } catch (error) {
    return asPublicError(error, 'We couldn’t load this image. Please return to the conversation and try again.');
  }
}
