import { isAdmin } from '@/lib/admin-auth'
import { deleteSegment } from '@/lib/saved-segments'
import { logAdmin } from '@/lib/admin-audit'

export const runtime = 'nodejs'

// DELETE /api/admin/segments/[id]
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!await isAdmin()) return Response.json({ error: 'Not signed in as admin' }, { status: 401 })
  const { id } = await params
  const n = Number(id)
  if (!Number.isFinite(n)) return Response.json({ error: 'bad id' }, { status: 400 })
  await deleteSegment(n)
  await logAdmin('segment.delete', String(n))
  return Response.json({ ok: true })
}
