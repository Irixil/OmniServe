import { asError, ensureSchema, getDb, getFiles, requirePublisher, requireStaff } from '../../../../db';
import { readJsonBody } from '../../../../lib/request-body';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ownerId = requirePublisher(request);
    await ensureSchema();
    const { id } = await params;
    const body = await readJsonBody<Record<string, unknown>>(request, 32 * 1024);
    const current = await getDb().prepare(`SELECT rights_proof_ref, rights_expires_at, public_title_en, public_title_zh,
      public_description_en, public_description_zh FROM assets WHERE id = ?`).bind(id).first<{
        rights_proof_ref: string; rights_expires_at: string; public_title_en: string; public_title_zh: string;
        public_description_en: string; public_description_zh: string;
      }>();
    if (!current) return Response.json({ error: '未找到图片' }, { status: 404 });
    const visibility = body.visibility === 'public' ? 'public' : 'internal';
    const rightsStatus = visibility === 'public' && body.rights_status === 'approved' ? 'approved' : 'revoked';
    const rightsProofRef = String(body.rights_proof_ref ?? current.rights_proof_ref ?? '').trim().slice(0, 300);
    const rawExpiry = String(body.rights_expires_at ?? current.rights_expires_at ?? '').trim().slice(0, 40);
    const now = new Date().toISOString();
    const expiryDate = /^\d{4}-\d{2}-\d{2}$/.test(rawExpiry) ? new Date(`${rawExpiry}T23:59:59.999Z`) : new Date(rawExpiry);
    if (rawExpiry && Number.isNaN(expiryDate.getTime())) return Response.json({ error: '展示权到期时间格式不正确' }, { status: 422 });
    const rightsExpiresAt = rawExpiry ? expiryDate.toISOString() : '';
    if (visibility === 'public' && rightsExpiresAt && rightsExpiresAt <= now) return Response.json({ error: '展示权已到期，不能公开' }, { status: 422 });
    const titleEn = String(body.public_title_en ?? current.public_title_en).trim().slice(0, 180);
    const titleZh = String(body.public_title_zh ?? current.public_title_zh).trim().slice(0, 180);
    const descriptionEn = String(body.public_description_en ?? current.public_description_en).trim().slice(0, 1000);
    const descriptionZh = String(body.public_description_zh ?? current.public_description_zh).trim().slice(0, 1000);
    if (visibility === 'public' && (rightsStatus !== 'approved' || !rightsProofRef || !titleEn || !titleZh)) return Response.json({ error: '公开案例必须填写权利证明并确认展示权和中英文标题' }, { status: 422 });
    const result = await getDb().batch([
      getDb().prepare(`UPDATE assets SET visibility = ?, rights_status = ?, rights_proof_ref = ?, rights_approved_by = ?, rights_approved_at = ?, rights_expires_at = ?, public_title_en = ?, public_title_zh = ?,
        public_description_en = ?, public_description_zh = ? WHERE id = ?`).bind(
        visibility, rightsStatus, rightsProofRef, visibility === 'public' ? ownerId : '', visibility === 'public' ? now : '', rightsExpiresAt,
        titleEn, titleZh, descriptionEn, descriptionZh, id,
      ),
      getDb().prepare('INSERT INTO audit_events (id, actor_id, event_type, entity_type, entity_id, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(
        crypto.randomUUID(), ownerId, visibility === 'public' ? 'case_published' : 'case_revoked', 'asset', id,
        JSON.stringify({ visibility, rights_status: rightsStatus, rights_expires_at: rightsExpiresAt }), now,
      ),
    ]);
    if (!result[0]?.meta.changes) return Response.json({ error: '未找到图片' }, { status: 404 });
    return Response.json({
      id, visibility, rights_status: rightsStatus, rights_proof_ref: rightsProofRef, rights_expires_at: rightsExpiresAt,
      rights_approved_by: visibility === 'public' ? ownerId : '', rights_approved_at: visibility === 'public' ? now : '',
    });
  } catch (error) {
    return asError(error);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ownerId = requireStaff(request);
    await ensureSchema();
    const { id } = await params;
    const asset = await getDb().prepare('SELECT file_key, visibility FROM assets WHERE id = ? AND owner_id = ?').bind(id, ownerId).first<{ file_key: string; visibility: string }>();
    if (!asset) return new Response('未找到图片', { status: 404 });
    if (asset.visibility === 'public') requirePublisher(request);
    const now = new Date().toISOString();
    const result = await getDb().batch([
      getDb().prepare(`INSERT INTO audit_events (id, actor_id, event_type, entity_type, entity_id, metadata_json, created_at)
        SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM assets WHERE id = ? AND owner_id = ? AND visibility = ?)`).bind(
        crypto.randomUUID(), ownerId, asset.visibility === 'public' ? 'case_deleted' : 'asset_deleted', 'asset', id,
        JSON.stringify({ previous_visibility: asset.visibility }), now, id, ownerId, asset.visibility,
      ),
      getDb().prepare('DELETE FROM assets WHERE id = ? AND owner_id = ? AND visibility = ?').bind(id, ownerId, asset.visibility),
    ]);
    if (!result[1]?.meta.changes) return Response.json({ error: '图片状态刚刚发生变化，请刷新后重试' }, { status: 409 });
    await getFiles().delete(asset.file_key).catch((error) => console.error('orphaned asset cleanup failed', { id, error }));
    return Response.json({ ok: true });
  } catch (error) {
    return asError(error);
  }
}
