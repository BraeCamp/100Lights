import { isAdmin } from '@/lib/admin-auth'
import { addNoteEntry, deleteNoteEntry } from '@/lib/user-crm'
import { logAdmin } from '@/lib/admin-audit'
import { currentUser } from '@clerk/nextjs/server'

export const runtime = 'nodejs'

// POST /api/admin/users/[userId]/notes — append a dated note entry to the log.
export async function POST(req: Request, { params }: { params: Promise<{ userId: string }> }) {
  if (!await isAdmin()) return new Response('Unauthorized', { status: 401 })
  const { userId } = await params
  if (!userId) return Response.json({ error: 'userId required' }, { status: 400 })
  const { body } = await req.json().catch(() => ({})) as { body?: string }
  if (!body || !body.trim()) return Response.json({ error: 'A note is required' }, { status: 400 })
  const author = (await currentUser().catch(() => null))?.emailAddresses?.[0]?.emailAddress ?? 'admin'
  const entry = await addNoteEntry(userId, body.trim(), author)
  await logAdmin('user.note.add', userId, {})
  return Response.json({ entry })
}

// DELETE /api/admin/users/[userId]/notes?entryId=123 — remove a log entry.
export async function DELETE(req: Request, { params }: { params: Promise<{ userId: string }> }) {
  if (!await isAdmin()) return new Response('Unauthorized', { status: 401 })
  const { userId } = await params
  if (!userId) return Response.json({ error: 'userId required' }, { status: 400 })
  const id = Number(new URL(req.url).searchParams.get('entryId'))
  if (!Number.isFinite(id)) return Response.json({ error: 'entryId required' }, { status: 400 })
  await deleteNoteEntry(userId, id)
  return Response.json({ ok: true })
}
