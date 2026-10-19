import { asError, clientError, ensureSchema, getDb, requireStaff } from '../../../db';
import { rankDocuments } from '../../../lib/domain';
import { readJsonBody } from '../../../lib/request-body';

export async function POST(request: Request) {
  try {
    const ownerId = requireStaff(request);
    await ensureSchema();
    const body = await readJsonBody<{ query?: string }>(request, 8 * 1024);
    const query = body.query?.trim().slice(0, 1000) ?? '';
    if (!query) throw clientError('请输入问题');
    const result = await getDb().prepare('SELECT id, title, category, substr(content, 1, 100000) AS content FROM documents WHERE owner_id = ? ORDER BY created_at DESC LIMIT 200').bind(ownerId).all<{ id: string; title: string; category: string; content: string }>();
    const matches = rankDocuments(query, result.results);
    if (!matches.length) return Response.json({ status: 'cannot_confirm', answer: '请补充与该问题相关的内部文档后再查询。', citations: [] });
    return Response.json({
      status: 'grounded',
      answer: matches[0].excerpt,
      citations: matches.map(({ id, title, category, excerpt, score }) => ({ id, title, category, excerpt, score })),
    });
  } catch (error) {
    return asError(error);
  }
}
