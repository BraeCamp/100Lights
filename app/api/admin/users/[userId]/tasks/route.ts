import { isAdmin } from '@/lib/admin-auth'
import { addTask, setTaskDone, deleteTask } from '@/lib/user-crm'
import { currentUser } from '@clerk/nextjs/server'

export const runtime = 'nodejs'

// POST /api/admin/users/[userId]/tasks — add a follow-up (optional due date).
export async function POST(req: Request, { params }: { params: Promise<{ userId: string }> }) {
  if (!await isAdmin()) return new Response('Unauthorized', { status: 401 })
  const { userId } = await params
  if (!userId) return Response.json({ error: 'userId required' }, { status: 400 })
  const { body, dueAt } = await req.json().catch(() => ({})) as { body?: string; dueAt?: string }
  if (!body?.trim()) return Response.json({ error: 'A task is required' }, { status: 400 })
  const author = (await currentUser().catch(() => null))?.emailAddresses?.[0]?.emailAddress ?? 'admin'
  const task = await addTask(userId, body.trim(), dueAt?.trim() || null, author)
  return Response.json({ task })
}

// PATCH /api/admin/users/[userId]/tasks — toggle done: { id, done }.
export async function PATCH(req: Request, { params }: { params: Promise<{ userId: string }> }) {
  if (!await isAdmin()) return new Response('Unauthorized', { status: 401 })
  const { userId } = await params
  if (!userId) return Response.json({ error: 'userId required' }, { status: 400 })
  const { id, done } = await req.json().catch(() => ({})) as { id?: number; done?: boolean }
  if (!Number.isFinite(Number(id))) return Response.json({ error: 'id required' }, { status: 400 })
  await setTaskDone(userId, Number(id), !!done)
  return Response.json({ ok: true })
}

// DELETE /api/admin/users/[userId]/tasks?taskId=123
export async function DELETE(req: Request, { params }: { params: Promise<{ userId: string }> }) {
  if (!await isAdmin()) return new Response('Unauthorized', { status: 401 })
  const { userId } = await params
  if (!userId) return Response.json({ error: 'userId required' }, { status: 400 })
  const id = Number(new URL(req.url).searchParams.get('taskId'))
  if (!Number.isFinite(id)) return Response.json({ error: 'taskId required' }, { status: 400 })
  await deleteTask(userId, id)
  return Response.json({ ok: true })
}
