import { auth } from '@clerk/nextjs/server'
import { sql } from '@/lib/db'

// Account-synced Apollo presets. localStorage (apollo_presets_v1) stays the
// fast/offline source of truth on each device; this table makes saved patches
// follow the account across devices and browsers. Rows are tiny JSON patches.

let ready = false
async function ensureSchema() {
  if (ready) return
  await sql`
    CREATE TABLE IF NOT EXISTS apollo_presets (
      user_id    TEXT NOT NULL,
      name       TEXT NOT NULL,
      json       TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, name)
    )
  `
  ready = true
}

function uid(req: Request, clerkId: string | null): string | null {
  if (clerkId) return clerkId
  // dev-only test collaborator (mirrors the community routes)
  return process.env.DEV_OPEN === '1' && process.env.NODE_ENV !== 'production'
    ? (req.headers.get('x-test-user') && `test-${req.headers.get('x-test-user')}`)
    : null
}

export async function GET(req: Request) {
  const { userId: clerkId } = await auth()
  const userId = uid(req, clerkId)
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  await ensureSchema()
  const rows = await sql`SELECT name, json, updated_at FROM apollo_presets WHERE user_id = ${userId} ORDER BY updated_at DESC LIMIT 500`
  return Response.json(rows.map(r => ({ name: r.name, json: r.json, updatedAt: r.updated_at })))
}

// POST { presets: [{ name, json }] } — bulk upsert (the client pushes its merged set)
export async function POST(req: Request) {
  const { userId: clerkId } = await auth()
  const userId = uid(req, clerkId)
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  let body: { presets?: { name?: string; json?: string }[] }
  try { body = await req.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const presets = (body.presets ?? []).filter(p => p?.name && typeof p.json === 'string' && p.json.length < 200_000).slice(0, 500)
  await ensureSchema()
  for (const p of presets) {
    await sql`
      INSERT INTO apollo_presets (user_id, name, json, updated_at)
      VALUES (${userId}, ${String(p.name).slice(0, 120)}, ${p.json as string}, NOW())
      ON CONFLICT (user_id, name) DO UPDATE SET json = EXCLUDED.json, updated_at = NOW()
    `
  }
  return Response.json({ ok: true, count: presets.length })
}

// DELETE { name }
export async function DELETE(req: Request) {
  const { userId: clerkId } = await auth()
  const userId = uid(req, clerkId)
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  let body: { name?: string }
  try { body = await req.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }
  if (!body.name) return Response.json({ error: 'name required' }, { status: 400 })
  await ensureSchema()
  await sql`DELETE FROM apollo_presets WHERE user_id = ${userId} AND name = ${body.name}`
  return Response.json({ ok: true })
}
