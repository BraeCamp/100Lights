import { auth } from '@clerk/nextjs/server'
import { sql } from '@/lib/db'
import { ensureNotifications } from '@/lib/notifications-server'

export const runtime = 'nodejs'

// GET /api/notifications — the current user's latest notifications + unread count
export async function GET() {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    await ensureNotifications()
    const rows = await sql`
      SELECT id, type, item_id, actor_name, body, read, created_at
      FROM notifications WHERE user_id = ${userId}
      ORDER BY created_at DESC LIMIT 30
    `
    const unread = await sql`SELECT COUNT(*)::int AS n FROM notifications WHERE user_id = ${userId} AND read = FALSE`
    return Response.json({
      notifications: rows.map(r => ({
        id: r.id, type: r.type, itemId: r.item_id, actorName: r.actor_name,
        body: r.body, read: r.read, createdAt: r.created_at,
      })),
      unread: unread[0]?.n ?? 0,
    })
  } catch {
    return Response.json({ notifications: [], unread: 0 })
  }
}

// POST /api/notifications — { action: 'read', id? } — mark one, or all, read
export async function POST(req: Request) {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { action?: string; id?: string }
  try { body = await req.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }

  if (body.action !== 'read') return Response.json({ error: 'Unknown action' }, { status: 400 })
  try {
    await ensureNotifications()
    if (body.id) {
      await sql`UPDATE notifications SET read = TRUE WHERE id = ${body.id} AND user_id = ${userId}`
    } else {
      await sql`UPDATE notifications SET read = TRUE WHERE user_id = ${userId} AND read = FALSE`
    }
    return Response.json({ ok: true })
  } catch {
    return Response.json({ error: 'Failed to update' }, { status: 500 })
  }
}
