import { auth } from '@clerk/nextjs/server'
import { sql } from '@/lib/db'
import { schemaManaged } from '@/lib/schema-guard'

// Account-synced Lightning Bug scenes (the whole visualizer setup). One row per scene per
// user; the full scene object is stored as JSONB so the client can evolve the shape freely.

let ready = false
async function ensure() {
  if (ready || schemaManaged) return
  await sql`
    CREATE TABLE IF NOT EXISTS user_scenes (
      user_id    TEXT NOT NULL,
      id         TEXT NOT NULL,
      name       TEXT NOT NULL,
      data       JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, id)
    )`
  ready = true
}

// GET /api/scenes — list the current user's scenes (newest first)
export async function GET() {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const rows = await sql`SELECT id, name, data FROM user_scenes WHERE user_id = ${userId} ORDER BY updated_at DESC`
    // The full scene lives in `data`; id/name are also columns for querying.
    return Response.json(rows.map(r => ({ ...(r.data as object), id: r.id, name: r.name })))
  } catch {
    return Response.json([])   // table may not exist yet
  }
}

// POST /api/scenes — upsert a scene (body = the whole scene object incl. id + name)
export async function POST(req: Request) {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  let body: { id?: string; name?: string }
  try { body = await req.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }
  if (!body?.id || !body?.name) return Response.json({ error: 'Missing id or name' }, { status: 400 })
  try {
    await ensure()
    await sql`
      INSERT INTO user_scenes (user_id, id, name, data, updated_at)
      VALUES (${userId}, ${body.id}, ${body.name}, ${JSON.stringify(body)}::jsonb, NOW())
      ON CONFLICT (user_id, id) DO UPDATE
        SET name = EXCLUDED.name, data = EXCLUDED.data, updated_at = NOW()`
    return Response.json({ ok: true })
  } catch {
    return Response.json({ error: 'Failed to save scene' }, { status: 500 })
  }
}

// DELETE /api/scenes?id=... — remove a scene
export async function DELETE(req: Request) {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return Response.json({ error: 'Missing id' }, { status: 400 })
  try {
    await ensure()
    await sql`DELETE FROM user_scenes WHERE user_id = ${userId} AND id = ${id}`
    return Response.json({ ok: true })
  } catch {
    return Response.json({ error: 'Failed to delete scene' }, { status: 500 })
  }
}
