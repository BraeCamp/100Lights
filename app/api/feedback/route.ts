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
  tableReady = true
}

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

// GET /api/feedback — admin reads the inbox
export async function GET() {
  if (!await isAdmin()) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  await ensureTable()
  const rows = await sql`SELECT * FROM feedback ORDER BY created_at DESC LIMIT 200`
  return Response.json({ items: rows })
}
