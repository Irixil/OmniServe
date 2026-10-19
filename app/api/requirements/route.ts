import { asError, clientError, ensureSchema, getDb, requireStaff } from '../../../db';
import { parseRequirement } from '../../../lib/domain';
import { readJsonBody } from '../../../lib/request-body';

export async function GET(request: Request) {
  try {
    const ownerId = requireStaff(request);
    await ensureSchema();
    const result = await getDb().prepare(`SELECT r.*, p.project_code, p.name AS project_name
      FROM requirements r LEFT JOIN projects p ON p.id = r.project_id AND p.owner_id = r.owner_id
      WHERE r.owner_id = ? ORDER BY r.created_at DESC LIMIT 100`).bind(ownerId).all();
    return Response.json(result.results.map((row) => ({ ...row, parsed: JSON.parse(String(row.parsed_json)), selected_asset_ids: JSON.parse(String(row.selected_asset_ids)) })));
  } catch (error) {
    return asError(error);
  }
}

export async function POST(request: Request) {
  try {
    const ownerId = requireStaff(request);
    await ensureSchema();
    const body = await readJsonBody<{ project_id?: string; original_text?: string; selected_asset_ids?: string[] }>(request, 32 * 1024);
    const quota = await getDb().prepare('SELECT COUNT(*) AS count FROM requirements WHERE owner_id = ?').bind(ownerId).first<{ count: number }>();
    if (Number(quota?.count ?? 0) >= 1000) throw clientError('当前账号的需求记录已达到 1000 条上限');
    const originalText = body.original_text?.trim().slice(0, 5000) ?? '';
    if (!originalText) throw clientError('客户需求不能为空');
    const projectId = body.project_id?.trim() ?? '';
    if (projectId) {
      const project = await getDb().prepare('SELECT id FROM projects WHERE id = ? AND owner_id = ?').bind(projectId, ownerId).first();
      if (!project) throw clientError('所选项目不存在');
    }
    const requestedAssetIds = [...new Set((body.selected_asset_ids ?? []).filter((id): id is string => typeof id === 'string').slice(0, 50))];
    let selectedAssetIds: string[] = [];
    if (requestedAssetIds.length) {
      const placeholders = requestedAssetIds.map(() => '?').join(',');
      const result = await getDb().prepare(`SELECT id FROM assets WHERE owner_id = ? AND id IN (${placeholders})`).bind(ownerId, ...requestedAssetIds).all<{ id: string }>();
      selectedAssetIds = result.results.map((asset) => asset.id);
    }
    const parsed = parseRequirement(originalText);
    const record = {
      id: crypto.randomUUID(),
      owner_id: ownerId,
      project_id: projectId,
      original_text: originalText,
      parsed_json: JSON.stringify(parsed),
      selected_asset_ids: JSON.stringify(selectedAssetIds),
      created_at: new Date().toISOString(),
    };
    await getDb().prepare('INSERT INTO requirements (id, owner_id, project_id, original_text, parsed_json, selected_asset_ids, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(...Object.values(record)).run();
    return Response.json({ ...record, parsed, selected_asset_ids: selectedAssetIds }, { status: 201 });
  } catch (error) {
    return asError(error);
  }
}
