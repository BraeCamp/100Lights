// Account-synced sound library — the server side of the user's personal sounds.
//
// The library UI lives in IndexedDB per device (lib/sound-library.ts). Built-in
// instruments are deterministic renderSpecs (identical on every device) and
// community imports already live server-side, so neither needs syncing. What
// DOESN'T sync on its own is a user's *own* recorded/uploaded audio — that's
// what this store carries, so adding a sound on one device makes it appear in
// the same account's library on another.
//
// Mirrors the user_media pattern: the audio blob is PUT to R2 via
// /api/media/presign-upload, then registered here by metadata. Reading back is
// metadata only — the client resolves the blob through /api/media/signed-url.

import { auth } from '@clerk/nextjs/server'
import { sql } from '@/lib/db'
import { getSubscription } from '@/lib/subscription'
import { entitlements } from '@/lib/entitlements'

let schemaReady = false
async function ensureSchema() {
  if (schemaReady) return
  await sql`
    CREATE TABLE IF NOT EXISTS user_sounds (
      id           TEXT PRIMARY KEY,
      user_id      TEXT NOT NULL,
      name         TEXT NOT NULL,
      category     TEXT NOT NULL DEFAULT 'custom',
      r2_key       TEXT NOT NULL,
      duration     DOUBLE PRECISION NOT NULL DEFAULT 0,
      content_type TEXT NOT NULL DEFAULT '',
      folder       TEXT,
      parent_folder TEXT,
      tags         JSONB,
      musical_key  TEXT,
      bpm          DOUBLE PRECISION,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  await sql`CREATE INDEX IF NOT EXISTS user_sounds_user_idx ON user_sounds (user_id)`
  schemaReady = true
}

// GET /api/library — list the current user's synced sounds (metadata only)
export async function GET() {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    await ensureSchema()
    const rows = await sql`
      SELECT id, name, category, r2_key, duration, content_type,
             folder, parent_folder, tags, musical_key, bpm, created_at
      FROM user_sounds
      WHERE user_id = ${userId}
      ORDER BY created_at DESC
    `
    return Response.json(rows.map(r => ({
      id:           r.id,
      name:         r.name,
      category:     r.category,
      r2Key:        r.r2_key,
      duration:     r.duration ?? 0,
      contentType:  r.content_type ?? '',
      folder:       r.folder ?? undefined,
      parentFolder: r.parent_folder ?? undefined,
      tags:         r.tags ?? undefined,
      key:          r.musical_key ?? undefined,
      bpm:          r.bpm ?? undefined,
      createdAt:    r.created_at,
    })))
  } catch {
    // Table may not exist yet in some environments — empty list beats a crash.
    return Response.json([])
  }
}

// POST /api/library — register a sound whose blob was already PUT to R2
export async function POST(req: Request) {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  let body: {
    id: string; name: string; category?: string; r2Key: string
    duration?: number; contentType?: string
    folder?: string; parentFolder?: string; tags?: string[]; key?: string; bpm?: number
  }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.id || !body.name || !body.r2Key) {
    return Response.json({ error: 'Missing required fields' }, { status: 400 })
  }
  // The blob must live under this user's R2 namespace (same guard as user_media).
  if (!body.r2Key.startsWith(`${userId}/`)) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    await ensureSchema()
    // Sync cap (free tier). This limits how many sounds follow the account
    // across devices — it does NOT limit using sounds: they stay in the local
    // library regardless. New syncs only; updating an existing one is free.
    const cap = entitlements((await getSubscription(userId)).plan).syncedSounds
    if (Number.isFinite(cap)) {
      const [{ n }] = await sql`SELECT COUNT(*)::int AS n FROM user_sounds WHERE user_id = ${userId}`
      const existing = await sql`SELECT 1 FROM user_sounds WHERE id = ${body.id} AND user_id = ${userId} LIMIT 1`
      if (existing.length === 0 && n >= cap) {
        return Response.json({
          error: `Free accounts sync up to ${cap} sounds across devices. This sound is still saved on this computer — upgrade to Pro for unlimited synced sounds.`,
          upgrade: true,
        }, { status: 403 })
      }
    }
    await sql`
      INSERT INTO user_sounds (
        id, user_id, name, category, r2_key, duration, content_type,
        folder, parent_folder, tags, musical_key, bpm, created_at
      ) VALUES (
        ${body.id}, ${userId}, ${body.name}, ${body.category ?? 'custom'},
        ${body.r2Key}, ${body.duration ?? 0}, ${body.contentType ?? ''},
        ${body.folder ?? null}, ${body.parentFolder ?? null},
        ${body.tags ? JSON.stringify(body.tags) : null},
        ${body.key ?? null}, ${body.bpm ?? null}, NOW()
      )
      ON CONFLICT (id) DO UPDATE
        SET name = EXCLUDED.name,
            category = EXCLUDED.category,
            duration = EXCLUDED.duration,
            folder = EXCLUDED.folder,
            parent_folder = EXCLUDED.parent_folder,
            tags = EXCLUDED.tags,
            musical_key = EXCLUDED.musical_key,
            bpm = EXCLUDED.bpm
        WHERE user_sounds.user_id = ${userId}
    `
    return Response.json({ ok: true })
  } catch {
    return Response.json({ error: 'Failed to register sound' }, { status: 500 })
  }
}

// DELETE /api/library?id=<id> — drop a sound from the account (metadata only;
// the R2 object is left for storage accounting to reconcile, matching user_media).
export async function DELETE(req: Request) {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const id = new URL(req.url).searchParams.get('id')
  if (!id) return Response.json({ error: 'Missing id' }, { status: 400 })

  try {
    await ensureSchema()
    await sql`DELETE FROM user_sounds WHERE id = ${id} AND user_id = ${userId}`
    return Response.json({ ok: true })
  } catch {
    return Response.json({ error: 'Failed to delete sound' }, { status: 500 })
  }
}
