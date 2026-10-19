import { asError, ensureSchema, getDb, getFiles, requirePublisher, requireStaff } from '../../../../db';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ownerId = requireStaff(request);
    await ensureSchema();
    const { id } = await params;
    const companyScope = new URL(request.url).searchParams.get('scope') === 'company';
    if (companyScope) requirePublisher(request);
    const asset = await getDb().prepare(`SELECT file_key, mime_type FROM assets WHERE id = ? ${companyScope ? '' : 'AND owner_id = ?'}`)
      .bind(...(companyScope ? [id] : [id, ownerId])).first<{ file_key: string; mime_type: string }>();
    if (!asset) return new Response('未找到图片', { status: 404 });
    const object = await getFiles().get(asset.file_key);
    if (!object) return new Response('文件不存在', { status: 404 });
    return new Response(object.body, { headers: {
      'content-type': asset.mime_type,
      'cache-control': 'private, no-store, max-age=0',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
    } });
  } catch (error) {
    return asError(error);
  }
}
