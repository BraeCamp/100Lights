import { auth, currentUser } from '@clerk/nextjs/server'
import { sql } from '@/lib/db'
import { isAdmin } from '@/lib/admin-auth'

export const runtime = 'nodejs'

let tableReady = false
async function ensureTable() {
  if (tableReady) return
  await sql`
    CREATE TABLE IF NOT EXISTS feedback (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id TEXT,
      email TEXT,
      message TEXT NOT NULL,
      page TEXT,
      user_agent TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  // Triage state so the inbox is workable past beta.
  await sql`ALTER TABLE feedback ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ`
  tableReady = true
}

const PAGE = 25

// POST /api/feedback — anyone signed in can send; message required
export async function POST(req: Request) {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Sign in to send feedback' }, { status: 401 })
  await ensureTable()

  let body: { message?: string; page?: string }
  try { body = await req.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const message = body.message?.trim()
  if (!message) return Response.json({ error: 'Message required' }, { status: 400 })

  const user = await currentUser()
  await sql`
    INSERT INTO feedback (user_id, email, message, page, user_agent)
    VALUES (${userId}, ${user?.emailAddresses?.[0]?.emailAddress ?? null}, ${message.slice(0, 4000)}, ${(body.page ?? '').slice(0, 200)}, ${(req.headers.get('user-agent') ?? '').slice(0, 300)})
  `
  return Response.json({ ok: true })
}

// GET /api/feedback — admin inbox, paged and filterable by triage state.
export async function GET(req: Request) {
  if (!await isAdmin()) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  await ensureTable()
  const url = new URL(req.url)
  const filter = url.searchParams.get('filter') ?? 'open' // open | resolved | all
  const page = Math.max(0, parseInt(url.searchParams.get('page') ?? '0', 10) || 0)
  const cond = filter === 'open' ? sql`resolved_at IS NULL`
    : filter === 'resolved' ? sql`resolved_at IS NOT NULL`
    : sql`TRUE`

  const rows = await sql`
    SELECT * FROM feedback WHERE ${cond}
    ORDER BY created_at DESC LIMIT ${PAGE + 1} OFFSET ${page * PAGE}
  `
  const hasMore = rows.length > PAGE
  const [counts] = await sql`
    SELECT COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE resolved_at IS NULL)::int AS open
    FROM feedback
  `
  return Response.json({
    items: rows.slice(0, PAGE), hasMore, page, filter,
    counts: { total: Number(counts?.total ?? 0), open: Number(counts?.open ?? 0) },
  })
}

// PATCH /api/feedback — { id, resolved: boolean } toggle triage state.
export async function PATCH(req: Request) {
  if (!await isAdmin()) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  await ensureTable()
  const { id, resolved } = await req.json().catch(() => ({})) as { id?: string; resolved?: boolean }
  if (!id) return Response.json({ error: 'id required' }, { status: 400 })
  const rows = resolved
    ? await sql`UPDATE feedback SET resolved_at = NOW() WHERE id = ${id} RETURNING id`
    : await sql`UPDATE feedback SET resolved_at = NULL WHERE id = ${id} RETURNING id`
  if (rows.length === 0) return Response.json({ error: 'Not found' }, { status: 404 })
  return Response.json({ ok: true })
}

// DELETE /api/feedback?id=… — remove an entry.
export async function DELETE(req: Request) {
  if (!await isAdmin()) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  await ensureTable()
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return Response.json({ error: 'id required' }, { status: 400 })
  await sql`DELETE FROM feedback WHERE id = ${id}`
  return Response.json({ ok: true })
}
