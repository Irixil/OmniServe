import { asError, ensureSchema, getDb, requireStaff } from '../../../../db';

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ownerId = requireStaff(request);
    await ensureSchema();
    const { id } = await params;
    await getDb().prepare('DELETE FROM documents WHERE id = ? AND owner_id = ?').bind(id, ownerId).run();
    return Response.json({ ok: true });
  } catch (error) {
    return asError(error);
  }
}
