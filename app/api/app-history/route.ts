// Account sync for the mini-apps' saved work (Beat Maker beats, Captions sessions, …).
//
// The apps save device-first to localStorage (lib/app-history.ts). When the user is
// signed in and online, that same entry is mirrored here so their history follows the
// account across devices. Mirrors the user_sounds/library pattern: lazy schema, rows
// scoped to the Clerk userId, upsert on POST, delete on DELETE. The payload is the
// app's own restore data (small JSON — a beat grid, a caption list), stored as JSONB.

import { auth } from '@clerk/nextjs/server'
import { sql } from '@/lib/db'

const MAX_ROWS_PER_USER = 500          // safety cap; the client also caps its local list
const MAX_DATA_BYTES = 400_000         // skip syncing pathologically large payloads

let schemaReady = false
async function ensureSchema() {
  if (schemaReady) return
  await sql`
    CREATE TABLE IF NOT EXISTS app_history (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL,
      app_slug   TEXT NOT NULL,
      title      TEXT NOT NULL,
      subtitle   TEXT,
      data       JSONB,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  await sql`CREATE INDEX IF NOT EXISTS app_history_user_slug_idx ON app_history (user_id, app_slug)`
  schemaReady = true
}

// GET /api/app-history?slug=beatmaker — list this account's saved work for one app.
export async function GET(req: Request) {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const slug = new URL(req.url).searchParams.get('slug')
  if (!slug) return Response.json({ error: 'Missing slug' }, { status: 400 })
  try {
    await ensureSchema()
    const rows = await sql`
      SELECT id, title, subtitle, data, updated_at
      FROM app_history
      WHERE user_id = ${userId} AND app_slug = ${slug}
      ORDER BY updated_at DESC
      LIMIT ${MAX_ROWS_PER_USER}
    `
    return Response.json(rows.map(r => ({
      id: r.id, title: r.title, subtitle: r.subtitle ?? undefined,
      data: r.data ?? undefined, updatedAt: r.updated_at,
    })))
  } catch {
    // Table may not exist yet in some environments — empty list beats a crash.
    return Response.json([])
  }
}

// POST /api/app-history — upsert one saved entry for this account.
export async function POST(req: Request) {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  let body: { id: string; slug: string; title: string; subtitle?: string; data?: unknown }
  try { body = await req.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }
  if (!body.id || !body.slug || !body.title) return Response.json({ error: 'Missing required fields' }, { status: 400 })

  const dataJson = body.data === undefined ? null : JSON.stringify(body.data)
  if (dataJson && dataJson.length > MAX_DATA_BYTES) {
    // Too big to sync — the client keeps it locally; tell it so it stops retrying.
    return Response.json({ error: 'Entry too large to sync', tooLarge: true }, { status: 413 })
  }
  try {
    await ensureSchema()
    // Cap new rows per user (updates to existing rows are always allowed).
    const existing = await sql`SELECT 1 FROM app_history WHERE id = ${body.id} AND user_id = ${userId} LIMIT 1`
    if (existing.length === 0) {
      const [{ n }] = await sql`SELECT COUNT(*)::int AS n FROM app_history WHERE user_id = ${userId} AND app_slug = ${body.slug}`
      if (n >= MAX_ROWS_PER_USER) {
        // Drop the oldest to make room, keeping the account list bounded.
        await sql`
          DELETE FROM app_history WHERE id IN (
            SELECT id FROM app_history WHERE user_id = ${userId} AND app_slug = ${body.slug}
            ORDER BY updated_at ASC LIMIT 1
          )
        `
      }
    }
    await sql`
      INSERT INTO app_history (id, user_id, app_slug, title, subtitle, data, updated_at)
      VALUES (${body.id}, ${userId}, ${body.slug}, ${body.title}, ${body.subtitle ?? null}, ${dataJson}::jsonb, NOW())
      ON CONFLICT (id) DO UPDATE
        SET title = EXCLUDED.title,
            subtitle = EXCLUDED.subtitle,
            data = EXCLUDED.data,
            updated_at = NOW()
        WHERE app_history.user_id = ${userId}
    `
    return Response.json({ ok: true })
  } catch {
    return Response.json({ error: 'Failed to save' }, { status: 500 })
  }
}

// DELETE /api/app-history?id=<id> — remove one entry from the account.
export async function DELETE(req: Request) {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return Response.json({ error: 'Missing id' }, { status: 400 })
  try {
    await ensureSchema()
    await sql`DELETE FROM app_history WHERE id = ${id} AND user_id = ${userId}`
    return Response.json({ ok: true })
  } catch {
    return Response.json({ error: 'Failed to delete' }, { status: 500 })
  }
}
