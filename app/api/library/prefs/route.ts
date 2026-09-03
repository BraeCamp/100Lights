import { auth } from '@clerk/nextjs/server'
import { sql } from '@/lib/db'

export const runtime = 'nodejs'

/**
 * The part of a library that is personal rather than audible.
 *
 * Brae: "Let's make own samples, saves, and tags live on the account."
 *
 * ⚠️ A SEPARATE TABLE BECAUSE user_sounds CANNOT HOLD THESE. That table requires
 * an r2_key — it is the register of audio this account uploaded — and the two
 * things missing from other machines have no audio of their own:
 *
 *   a personal tag on a CATALOG sound, where the audio belongs to everybody and
 *   the tag belongs to one person;
 *
 *   a KEPT community sound, which was never a copy in the first place. It is a
 *   reference that streams from the item's own URL, which is what makes keeping
 *   one nearly free — and also why nothing was ever uploaded for it, and why it
 *   stayed on the machine where it was kept.
 *
 * So this stores what a person did, keyed to the sound, and lets the audio go on
 * living wherever it already lives.
 */

let ready: Promise<void> | null = null
function ensure(): Promise<void> {
  ready ??= (async () => {
    await sql`
      CREATE TABLE IF NOT EXISTS user_sound_prefs (
        user_id    TEXT NOT NULL,
        sound_id   TEXT NOT NULL,
        user_tags  JSONB NOT NULL DEFAULT '[]'::jsonb,
        -- Enough to rebuild a kept sound's stub on another machine. Null for a
        -- sound that already syncs on its own (an upload) or that everybody has
        -- anyway (the catalog) — those only need their tags carrying.
        saved      JSONB,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (user_id, sound_id)
      )`
    await sql`CREATE INDEX IF NOT EXISTS user_sound_prefs_user_idx ON user_sound_prefs (user_id)`
  })()
  return ready
}

export async function GET() {
  const { userId } = await auth()
  if (!userId) return Response.json({ prefs: [] })
  try {
    await ensure()
    const rows = await sql`
      SELECT sound_id, user_tags, saved FROM user_sound_prefs
      WHERE user_id = ${userId} LIMIT 5000`
    return Response.json({
      prefs: rows.map(r => ({
        id: String(r.sound_id),
        userTags: Array.isArray(r.user_tags) ? r.user_tags : [],
        saved: r.saved ?? null,
      })),
    })
  } catch (e) {
    // ⚠️ An empty answer, never an error. The library works perfectly well on
    // one machine; this is what makes it follow you, and a database having a
    // bad morning must not stop somebody using their own sounds.
    console.error('[library/prefs] read failed', e)
    return Response.json({ prefs: [] })
  }
}

export async function PUT(req: Request) {
  const { userId } = await auth()
  if (!userId) return Response.json({ ok: false }, { status: 401 })
  let body: { id?: unknown; userTags?: unknown; saved?: unknown }
  try { body = await req.json() } catch { return Response.json({ ok: false }, { status: 400 }) }

  const id = String(body.id ?? '').trim()
  if (!id || id.length > 200) return Response.json({ ok: false }, { status: 400 })
  const tags = Array.isArray(body.userTags)
    ? body.userTags.filter(t => typeof t === 'string' && t.trim() && t.length <= 60).slice(0, 40)
    : []
  const saved = body.saved && typeof body.saved === 'object' ? body.saved : null

  try {
    await ensure()
    // ⚠️ `saved` is only overwritten when one is GIVEN. A tag edit must not
    // erase the reference that is the only record of a kept sound existing.
    await sql`
      INSERT INTO user_sound_prefs (user_id, sound_id, user_tags, saved, updated_at)
      VALUES (${userId}, ${id}, ${JSON.stringify(tags)}::jsonb, ${saved ? JSON.stringify(saved) : null}::jsonb, NOW())
      ON CONFLICT (user_id, sound_id) DO UPDATE
        SET user_tags = EXCLUDED.user_tags,
            saved = COALESCE(EXCLUDED.saved, user_sound_prefs.saved),
            updated_at = NOW()`
    return Response.json({ ok: true })
  } catch (e) {
    console.error('[library/prefs] write failed', e)
    return Response.json({ ok: false }, { status: 500 })
  }
}

export async function DELETE(req: Request) {
  const { userId } = await auth()
  if (!userId) return Response.json({ ok: false }, { status: 401 })
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return Response.json({ ok: false }, { status: 400 })
  try {
    await ensure()
    await sql`DELETE FROM user_sound_prefs WHERE user_id = ${userId} AND sound_id = ${id}`
    return Response.json({ ok: true })
  } catch {
    return Response.json({ ok: false }, { status: 500 })
  }
}
