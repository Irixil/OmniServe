import { asError, clientError, ensureSchema, getDb, getFiles, requirePublisher, requireStaff } from '../../../db';
import { ASSET_KINDS, PROJECT_PHASES } from '../../../lib/domain';
import { hasUnsafeImageMetadata, hasValidImageSignature, isSafeImageType } from '../../../lib/image-validation';
import { readFormBody } from '../../../lib/request-body';

const fields = ['project_id', 'asset_kind', 'phase', 'building_type', 'viewpoint', 'shot_scale', 'atmosphere'] as const;

export async function GET(request: Request) {
  try {
    const ownerId = requireStaff(request);
    await ensureSchema();
    const url = new URL(request.url);
    const companyScope = url.searchParams.get('scope') === 'company';
    if (companyScope) requirePublisher(request);
    const clauses = companyScope ? [] : ['a.owner_id = ?'];
    const values: string[] = companyScope ? [] : [ownerId];
    for (const field of fields) {
      const value = url.searchParams.get(field)?.trim();
      if (!value) continue;
      clauses.push(field === 'atmosphere' ? `a.${field} LIKE ?` : `a.${field} = ?`);
      values.push(field === 'atmosphere' ? `%${value}%` : value);
    }
    const query = url.searchParams.get('q')?.trim();
    if (query) {
      clauses.push('(a.file_name LIKE ? OR a.description LIKE ? OR a.style LIKE ? OR a.environment LIKE ?)');
      values.push(...Array(4).fill(`%${query}%`));
    }
    const result = await getDb().prepare(`SELECT a.*, p.project_code, p.name AS project_name
      FROM assets a LEFT JOIN projects p ON p.id = a.project_id AND p.owner_id = a.owner_id
      WHERE ${clauses.length ? clauses.join(' AND ') : '1 = 1'} ORDER BY a.created_at DESC LIMIT 100`).bind(...values).all();
    return Response.json(result.results.map((row) => ({ ...row, image_url: `/api/files/${row.id}${companyScope ? '?scope=company' : ''}` })));
  } catch (error) {
    return asError(error);
  }
}

export async function POST(request: Request) {
  let fileKey = '';
  try {
    const ownerId = requireStaff(request);
    await ensureSchema();
    const quota = await getDb().prepare('SELECT COUNT(*) AS count FROM assets WHERE owner_id = ?').bind(ownerId).first<{ count: number }>();
    if (Number(quota?.count ?? 0) >= 500) throw clientError('当前账号的图片数量已达到 500 张上限，请先清理不再需要的素材');
    const form = await readFormBody(request, 11 * 1024 * 1024);
    const file = form.get('file');
    if (!(file instanceof File) || !isSafeImageType(file.type)) throw clientError('仅支持 JPEG、PNG 或 WebP 图片');
    if (file.size > 10 * 1024 * 1024) throw clientError('单张图片不能超过 10MB');
    const fileBytes = new Uint8Array(await file.arrayBuffer());
    if (!hasValidImageSignature(file.type, fileBytes)) throw clientError('图片文件内容与格式不一致');
    if (hasUnsafeImageMetadata(file.type, fileBytes)) throw clientError('图片含有 EXIF、XMP、IPTC 或注释信息，请导出不含元数据的版本后再上传');
    const required = ['building_type', 'viewpoint', 'shot_scale', 'atmosphere'] as const;
    const values = Object.fromEntries(required.map((field) => [field, String(form.get(field) ?? '').trim().slice(0, 100)]));
    if (required.some((field) => !values[field])) throw clientError('建筑类型、视角、景别和氛围必须填写');
    const projectId = String(form.get('project_id') ?? '').trim().slice(0, 100);
    if (projectId) {
      const project = await getDb().prepare('SELECT id FROM projects WHERE id = ? AND owner_id = ?').bind(projectId, ownerId).first();
      if (!project) throw clientError('所选项目不存在');
    }
    const assetKind = String(form.get('asset_kind') ?? '效果图').trim();
    const phase = String(form.get('phase') ?? '方案').trim();
    if (!ASSET_KINDS.includes(assetKind) || !PROJECT_PHASES.includes(phase)) throw clientError('素材类型或项目阶段不正确');
    const id = crypto.randomUUID();
    const visibility = 'internal';
    const rightsStatus = 'pending';
    const rightsProofRef = String(form.get('rights_proof_ref') ?? '').trim().slice(0, 300);
    const rightsExpiresAt = String(form.get('rights_expires_at') ?? '').trim().slice(0, 40);
    const publicTitleEn = String(form.get('public_title_en') ?? '').trim().slice(0, 180);
    const publicTitleZh = String(form.get('public_title_zh') ?? '').trim().slice(0, 180);
    const now = new Date().toISOString();
    const expiryDate = /^\d{4}-\d{2}-\d{2}$/.test(rightsExpiresAt) ? new Date(`${rightsExpiresAt}T23:59:59.999Z`) : new Date(rightsExpiresAt);
    if (rightsExpiresAt && Number.isNaN(expiryDate.getTime())) throw clientError('展示权到期时间格式不正确');
    const extension = file.name.split('.').pop()?.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) || 'bin';
    fileKey = `${ownerId}/${id}.${extension}`;
    await getFiles().put(fileKey, fileBytes, { httpMetadata: { contentType: file.type } });
    const record = {
      id,
      owner_id: ownerId,
      file_key: fileKey,
      file_name: file.name.slice(0, 200),
      mime_type: file.type,
      project_id: projectId,
      asset_kind: assetKind,
      phase,
      building_type: values.building_type,
      viewpoint: values.viewpoint,
      shot_scale: values.shot_scale,
      atmosphere: values.atmosphere,
      style: String(form.get('style') ?? '').trim().slice(0, 100),
      environment: String(form.get('environment') ?? '').trim().slice(0, 100),
      description: String(form.get('description') ?? '').trim().slice(0, 1000),
      visibility,
      rights_status: rightsStatus,
      rights_proof_ref: rightsProofRef,
      rights_approved_by: '',
      rights_approved_at: '',
      rights_expires_at: rightsExpiresAt ? expiryDate.toISOString() : '',
      public_title_en: publicTitleEn,
      public_title_zh: publicTitleZh,
      public_description_en: String(form.get('public_description_en') ?? '').trim().slice(0, 1000),
      public_description_zh: String(form.get('public_description_zh') ?? '').trim().slice(0, 1000),
      created_at: now,
    };
    await getDb().prepare(`INSERT INTO assets
      (id, owner_id, file_key, file_name, mime_type, project_id, asset_kind, phase, building_type, viewpoint, shot_scale, atmosphere, style, environment, description, visibility, rights_status, rights_proof_ref, rights_approved_by, rights_approved_at, rights_expires_at, public_title_en, public_title_zh, public_description_en, public_description_zh, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(...Object.values(record)).run();
    return Response.json({ ...record, image_url: `/api/files/${id}` }, { status: 201 });
  } catch (error) {
    if (fileKey) await getFiles().delete(fileKey).catch(() => undefined);
    return asError(error);
  }
}
