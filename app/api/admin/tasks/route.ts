import { isAdmin } from '@/lib/admin-auth'
import { allOpenTasks, setTaskDone } from '@/lib/user-crm'
import { clerkClient } from '@clerk/nextjs/server'

export const runtime = 'nodejs'

// GET /api/admin/tasks — every open follow-up across all users, with the
// account email resolved, for the tasks inbox.
export async function GET() {
  if (!await isAdmin()) return Response.json({ error: 'Not signed in as admin' }, { status: 401 })
  const tasks = await allOpenTasks(200)
  let emails = new Map<string, string>()
  if (tasks.length) {
    try {
      const ids = [...new Set(tasks.map(t => t.userId))]
      const cu = (await (await clerkClient()).users.getUserList({ userId: ids, limit: 200 })).data
      emails = new Map(cu.map(u => [u.id, u.emailAddresses?.[0]?.emailAddress ?? '']))
    } catch { /* Clerk down — show ids */ }
  }
  return Response.json({ tasks: tasks.map(t => ({ ...t, email: emails.get(t.userId) ?? '' })) })
}

// PATCH /api/admin/tasks — complete/reopen a task from the inbox: { id, userId, done }.
export async function PATCH(req: Request) {
  if (!await isAdmin()) return Response.json({ error: 'Not signed in as admin' }, { status: 401 })
  const { id, userId, done } = await req.json().catch(() => ({})) as { id?: number; userId?: string; done?: boolean }
  if (!Number.isFinite(Number(id)) || !userId) return Response.json({ error: 'id and userId required' }, { status: 400 })
  await setTaskDone(userId, Number(id), !!done)
  return Response.json({ ok: true })
}
