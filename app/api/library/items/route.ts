// Account-synced NON-audio library items — the user's own presets, drum kits,
// and drum patterns. Companion to /api/library (which syncs audio samples).
// These are small pure-JSON objects, so they're stored inline as jsonb; no R2.
//
// The client stores are localStorage (lib/midi-presets.ts, lib/drum-presets.ts);
// lib/user-library-sync.ts pushes a user's own (non-builtIn) items here on add
// and pulls missing ones on sign-in, so a preset/kit/pattern made on one device
// shows up in the same account on another.

import { auth } from '@clerk/nextjs/server'
import { sql } from '@/lib/db'

const TYPES = ['preset', 'kit', 'pattern'] as const

let schemaReady = false
async function ensureSchema() {
  if (schemaReady) return
  // PK is (user_id, id): ids can be deterministic across users (community imports
  // use `community-<itemId>`), so they're only unique WITHIN an account.
  await sql`
    CREATE TABLE IF NOT EXISTS user_library_items (
      id         TEXT NOT NULL,
      user_id    TEXT NOT NULL,
      type       TEXT NOT NULL,
      name       TEXT NOT NULL DEFAULT '',
      data       JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, id)
    )
  `
  // Migrate an earlier single-column PK (dev tables created before the composite
  // key) so the same community item can be installed by more than one account.
  try {
    const cols = await sql`SELECT COUNT(*)::int AS n FROM information_schema.key_column_usage WHERE constraint_name = 'user_library_items_pkey'`
    if ((cols[0]?.n ?? 0) === 1) {
      await sql`ALTER TABLE user_library_items DROP CONSTRAINT user_library_items_pkey`
      await sql`ALTER TABLE user_library_items ADD PRIMARY KEY (user_id, id)`
    }
  } catch { /* already composite, or a concurrent migration won the race */ }
  await sql`CREATE INDEX IF NOT EXISTS user_library_items_user_idx ON user_library_items (user_id, type)`
  schemaReady = true
}

// GET /api/library/items — all of the current user's synced preset/kit/pattern items
export async function GET() {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    await ensureSchema()
    const rows = await sql`
      SELECT id, type, name, data FROM user_library_items
      WHERE user_id = ${userId} ORDER BY updated_at DESC
    `
    return Response.json({ items: rows.map(r => ({ id: r.id, type: r.type, name: r.name, data: r.data })) })
  } catch {
    return Response.json({ items: [] })
  }
}

// POST /api/library/items — upsert one item {type, id, name, data}
export async function POST(req: Request) {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { type?: string; id?: string; name?: string; data?: unknown }
  try { body = await req.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }

  if (!body.id || !body.type || !(TYPES as readonly string[]).includes(body.type) || body.data == null) {
    return Response.json({ error: 'type (preset|kit|pattern), id and data are required' }, { status: 400 })
  }
  const dataJson = JSON.stringify(body.data)
  if (dataJson.length > 200_000) return Response.json({ error: 'data too large' }, { status: 413 })

  try {
    await ensureSchema()
    await sql`
      INSERT INTO user_library_items (id, user_id, type, name, data, updated_at)
      VALUES (${body.id}, ${userId}, ${body.type}, ${(body.name ?? '').slice(0, 200)}, ${dataJson}::jsonb, NOW())
      ON CONFLICT (user_id, id) DO UPDATE
        SET name = EXCLUDED.name, data = EXCLUDED.data, updated_at = NOW()
    `
    return Response.json({ ok: true })
  } catch {
    return Response.json({ error: 'Failed to save item' }, { status: 500 })
  }
}

// DELETE /api/library/items?id=... — drop one item
export async function DELETE(req: Request) {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return Response.json({ error: 'Missing id' }, { status: 400 })
  try {
    await ensureSchema()
    await sql`DELETE FROM user_library_items WHERE id = ${id} AND user_id = ${userId}`
    return Response.json({ ok: true })
  } catch {
    return Response.json({ error: 'Failed to delete item' }, { status: 500 })
  }
}
