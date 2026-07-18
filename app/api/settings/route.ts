import { auth } from '@clerk/nextjs/server'
import { sql } from '@/lib/db'

export const runtime = 'nodejs'

// Per-user app settings stored as a single JSONB blob (currently: workshop
// theme; room for more preferences later). Table is ensured lazily so no
// manual migration step is needed on fresh installs.
let ready = false
async function ensureTable() {
  if (ready) return
  await sql`
    CREATE TABLE IF NOT EXISTS user_settings (
      user_id    TEXT        PRIMARY KEY,
      data       JSONB       NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  ready = true
}

export async function GET() {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  await ensureTable()
  const rows = await sql`SELECT data FROM user_settings WHERE user_id = ${userId} LIMIT 1`
  const data = (rows[0]?.data ?? {}) as Record<string, unknown>
  return Response.json({ theme: data.theme ?? null })
}

export async function PUT(req: Request) {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return Response.json({ error: 'Invalid body' }, { status: 400 })
  }
  // Only known keys are merged in — theme for now.
  const patch: Record<string, unknown> = {}
  if ('theme' in body) patch.theme = (body as { theme: unknown }).theme

  await ensureTable()
  await sql`
    INSERT INTO user_settings (user_id, data, updated_at)
    VALUES (${userId}, ${JSON.stringify(patch) as unknown as object}, NOW())
    ON CONFLICT (user_id) DO UPDATE
      SET data = user_settings.data || ${JSON.stringify(patch) as unknown as object},
          updated_at = NOW()
  `
  return Response.json({ ok: true })
}
