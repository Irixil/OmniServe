import { asError, clientError, ensureSchema, getDb, requireStaff } from '../../../db';
import { readJsonBody } from '../../../lib/request-body';

export async function GET(request: Request) {
  try {
    const ownerId = requireStaff(request);
    await ensureSchema();
    const result = await getDb().prepare('SELECT id, title, category, substr(content, 1, 240) AS preview, created_at FROM documents WHERE owner_id = ? ORDER BY created_at DESC LIMIT 200').bind(ownerId).all();
    return Response.json(result.results);
  } catch (error) {
    return asError(error);
  }
}

export async function POST(request: Request) {
  try {
    const ownerId = requireStaff(request);
    await ensureSchema();
    const body = await readJsonBody<{ title?: string; category?: string; content?: string }>(request, 600 * 1024);
    const title = body.title?.trim().slice(0, 200) ?? '';
    const category = body.category?.trim().slice(0, 100) || '内部知识';
    const content = body.content?.trim() ?? '';
    if (!title || !content) throw clientError('文档标题和正文不能为空');
    if (content.length > 500_000) throw clientError('单份文档正文不能超过 50 万字');
    const quota = await getDb().prepare('SELECT COUNT(*) AS count, COALESCE(SUM(LENGTH(content)), 0) AS characters FROM documents WHERE owner_id = ?').bind(ownerId).first<{ count: number; characters: number }>();
    if (Number(quota?.count ?? 0) >= 200) throw clientError('当前账号的文档数量已达到 200 份上限');
    if (Number(quota?.characters ?? 0) + content.length > 5_000_000) throw clientError('当前账号的知识正文总量已达到 500 万字上限');
    const record = { id: crypto.randomUUID(), owner_id: ownerId, title, category, content, created_at: new Date().toISOString() };
    await getDb().prepare('INSERT INTO documents (id, owner_id, title, category, content, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(...Object.values(record)).run();
    return Response.json({ ...record, preview: content.slice(0, 240) }, { status: 201 });
  } catch (error) {
    return asError(error);
  }
}
