import { asError, clientError, ensureSchema, getDb, requireStaff } from '../../../../db';
import { PROJECT_STATUSES } from '../../../../lib/domain';
import { readJsonBody } from '../../../../lib/request-body';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ownerId = requireStaff(request);
    await ensureSchema();
    const { id } = await params;
    const body = await readJsonBody<{ status?: string }>(request, 8 * 1024);
    if (!body.status || !PROJECT_STATUSES.includes(body.status)) throw clientError('项目状态不正确');
    const result = await getDb().prepare('UPDATE projects SET status = ?, updated_at = ? WHERE id = ? AND owner_id = ?')
      .bind(body.status, new Date().toISOString(), id, ownerId).run();
    if (!result.meta.changes) throw clientError('项目不存在', 404);
    return Response.json({ id, status: body.status });
  } catch (error) {
    return asError(error);
  }
}
