import { isAdmin } from '@/lib/admin-auth'
import { getAnnouncement, updateAnnouncement, deleteAnnouncement, type Announcement } from '@/lib/announcements'
import { logAdmin } from '@/lib/admin-audit'

export const runtime = 'nodejs'

// PATCH /api/admin/announcements/[id] — edit or toggle. Read-merge-write so
// every column is written unconditionally.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!await isAdmin()) return Response.json({ error: 'Not signed in as admin' }, { status: 401 })
  const { id } = await params
  const n = Number(id)
  if (!Number.isFinite(n)) return Response.json({ error: 'bad id' }, { status: 400 })
  const existing = await getAnnouncement(n)
  if (!existing) return Response.json({ error: 'not found' }, { status: 404 })
  const patch = await req.json().catch(() => ({})) as Partial<Announcement>
  const merged: Announcement = { ...existing, ...patch, id: n }
  const updated = await updateAnnouncement(n, merged)
  await logAdmin('announcement.update', String(n), { active: updated?.active })
  return Response.json({ announcement: updated })
}

// DELETE /api/admin/announcements/[id]
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!await isAdmin()) return Response.json({ error: 'Not signed in as admin' }, { status: 401 })
  const { id } = await params
  const n = Number(id)
  if (!Number.isFinite(n)) return Response.json({ error: 'bad id' }, { status: 400 })
  await deleteAnnouncement(n)
  await logAdmin('announcement.delete', String(n))
  return Response.json({ ok: true })
}
