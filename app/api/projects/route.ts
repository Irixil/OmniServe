import { asError, clientError, ensureSchema, getDb, requireStaff } from '../../../db';
import { PROJECT_STATUSES } from '../../../lib/domain';
import { readJsonBody } from '../../../lib/request-body';

export async function GET(request: Request) {
  try {
    const ownerId = requireStaff(request);
    await ensureSchema();
    const url = new URL(request.url);
    const status = url.searchParams.get('status')?.trim();
    const query = url.searchParams.get('q')?.trim();
    const clauses = ['p.owner_id = ?'];
    const values: string[] = [ownerId];
    if (status) { clauses.push('p.status = ?'); values.push(status); }
    if (query) {
      clauses.push('(p.project_code LIKE ? OR p.name LIKE ? OR p.client_name LIKE ? OR p.city LIKE ?)');
      values.push(...Array(4).fill(`%${query}%`));
    }
    const result = await getDb().prepare(`SELECT p.*,
      (SELECT COUNT(*) FROM assets a WHERE a.owner_id = p.owner_id AND a.project_id = p.id) AS asset_count,
      (SELECT COUNT(*) FROM requirements r WHERE r.owner_id = p.owner_id AND r.project_id = p.id) AS requirement_count
      FROM projects p WHERE ${clauses.join(' AND ')} ORDER BY p.updated_at DESC LIMIT 200`).bind(...values).all();
    return Response.json(result.results);
  } catch (error) {
    return asError(error);
  }
}

export async function POST(request: Request) {
  try {
    const ownerId = requireStaff(request);
    await ensureSchema();
    const body = await readJsonBody<Record<string, string>>(request, 32 * 1024);
    const quota = await getDb().prepare('SELECT COUNT(*) AS count FROM projects WHERE owner_id = ?').bind(ownerId).first<{ count: number }>();
    if (Number(quota?.count ?? 0) >= 500) throw clientError('当前账号的项目数量已达到 500 个上限');
    const projectCode = body.project_code?.trim().slice(0, 60) ?? '';
    const name = body.name?.trim().slice(0, 200) ?? '';
    if (!projectCode || !name) throw clientError('项目编号和项目名称必须填写');
    const duplicate = await getDb().prepare('SELECT id FROM projects WHERE owner_id = ? AND project_code = ?').bind(ownerId, projectCode).first();
    if (duplicate) throw clientError('该项目编号已存在');
    const now = new Date().toISOString();
    const record = {
      id: crypto.randomUUID(), owner_id: ownerId, project_code: projectCode, name,
      client_name: body.client_name?.trim().slice(0, 200) ?? '', city: body.city?.trim().slice(0, 100) ?? '',
      building_type: body.building_type?.trim().slice(0, 100) ?? '',
      status: PROJECT_STATUSES.includes(body.status) ? body.status : PROJECT_STATUSES[0],
      contact_name: body.contact_name?.trim().slice(0, 100) ?? '', notes: body.notes?.trim().slice(0, 1000) ?? '',
      created_at: now, updated_at: now,
    };
    await getDb().prepare(`INSERT INTO projects
      (id, owner_id, project_code, name, client_name, city, building_type, status, contact_name, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(...Object.values(record)).run();
    return Response.json({ ...record, asset_count: 0, requirement_count: 0 }, { status: 201 });
  } catch (error) {
    return asError(error);
  }
}
