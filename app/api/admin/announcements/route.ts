import { isAdmin } from '@/lib/admin-auth'
import { listAnnouncements, createAnnouncement } from '@/lib/announcements'
import { logAdmin } from '@/lib/admin-audit'

export const runtime = 'nodejs'

// GET /api/admin/announcements — all announcements for the composer/list.
export async function GET() {
  if (!await isAdmin()) return Response.json({ error: 'Not signed in as admin' }, { status: 401 })
  return Response.json({ announcements: await listAnnouncements() })
}

// POST /api/admin/announcements — publish a new broadcast.
export async function POST(req: Request) {
  if (!await isAdmin()) return Response.json({ error: 'Not signed in as admin' }, { status: 401 })
  const b = await req.json().catch(() => ({}))
  if (!b.message || typeof b.message !== 'string' || !b.message.trim()) {
    return Response.json({ error: 'A message is required' }, { status: 400 })
  }
  const a = await createAnnouncement(b)
  await logAdmin('announcement.create', String(a.id), { audience: a.audience, level: a.level, active: a.active })
  return Response.json({ announcement: a })
}
