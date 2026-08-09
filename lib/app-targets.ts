import { sql } from '@/lib/db'

// "Sound Targets" — the owner's ground-truth store of what things are SUPPOSED
// to sound like. Each target pairs an optional reference-audio clip (in R2 under
// `targets/`) with a plain-language description + tags, so generation/detection
// can be tuned toward a real target instead of a guess. Read server-side; the
// admin AppTargetsPanel is the only writer. Distinct from the shipping catalog
// (`catalog_sounds`) — nothing here syncs to users; it's reference material.

export interface TargetRow {
  id: string
  label: string
  /** Short free-text bucket, e.g. 'instrument' | 'genre' | 'app' | 'detection'. */
  category: string
  /** "What it should sound like" — the descriptor the AI is tuned toward. */
  description: string
  /** R2 object key of the reference clip, when one was uploaded. */
  r2Key: string | null
  contentType: string
  duration: number | null
  tags: string[]
  /** Optional link back to a MINI_APPS slug this target is for. */
  appSlug: string | null
  createdAt?: string
  updatedAt?: string
}

let ready = false
async function ensure() {
  if (ready) return
  await sql`
    CREATE TABLE IF NOT EXISTS sound_targets (
      id           TEXT PRIMARY KEY,
      label        TEXT NOT NULL,
      category     TEXT NOT NULL DEFAULT 'app',
      description  TEXT NOT NULL DEFAULT '',
      r2_key       TEXT,
      content_type TEXT NOT NULL DEFAULT '',
      duration     DOUBLE PRECISION,
      tags         TEXT[] NOT NULL DEFAULT '{}',
      app_slug     TEXT,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  ready = true
}

function toRow(r: Record<string, unknown>): TargetRow {
  return {
    id: String(r.id),
    label: String(r.label),
    category: String(r.category),
    description: String(r.description ?? ''),
    r2Key: r.r2_key ? String(r.r2_key) : null,
    contentType: String(r.content_type ?? ''),
    duration: r.duration != null ? Number(r.duration) : null,
    tags: (r.tags as string[] | null) ?? [],
    appSlug: r.app_slug ? String(r.app_slug) : null,
    createdAt: r.created_at ? String(r.created_at) : undefined,
    updatedAt: r.updated_at ? String(r.updated_at) : undefined,
  }
}

/** All targets, newest first. Fails soft (returns []) so the panel never
 *  crashes when the DB is unreachable in dev — mirrors getFlags's defaults. */
export async function listTargets(): Promise<TargetRow[]> {
  try {
    await ensure()
    const rows = await sql`
      SELECT id, label, category, description, r2_key, content_type, duration, tags, app_slug, created_at, updated_at
      FROM sound_targets ORDER BY created_at DESC
    `
    return rows.map(toRow)
  } catch {
    return []
  }
}

export async function addTarget(p: {
  id: string; label: string; category?: string; description?: string
  r2Key?: string | null; contentType?: string; duration?: number | null
  tags?: string[]; appSlug?: string | null
}): Promise<void> {
  await ensure()
  await sql`
    INSERT INTO sound_targets (id, label, category, description, r2_key, content_type, duration, tags, app_slug)
    VALUES (
      ${p.id}, ${p.label}, ${p.category ?? 'app'}, ${p.description ?? ''},
      ${p.r2Key ?? null}, ${p.contentType ?? ''}, ${p.duration ?? null},
      ${p.tags && p.tags.length ? p.tags : []}, ${p.appSlug ?? null}
    )
  `
}

/** Full-metadata update of the descriptors (audio is replaced via re-upload, not
 *  edited here). label is required. */
export async function updateTarget(id: string, p: {
  label: string; category: string; description: string; tags?: string[] | null; appSlug?: string | null
}): Promise<boolean> {
  await ensure()
  const rows = await sql`
    UPDATE sound_targets SET
      label       = ${p.label},
      category    = ${p.category},
      description  = ${p.description},
      tags        = ${p.tags && p.tags.length ? p.tags : []},
      app_slug    = ${p.appSlug ?? null},
      updated_at  = NOW()
    WHERE id = ${id}
    RETURNING id
  `
  return rows.length > 0
}

/** Delete the row and return its r2_key (if any) so the caller can drop the
 *  R2 object. Returns { found } so a descriptor-only target still reports success. */
export async function deleteTarget(id: string): Promise<{ found: boolean; r2Key: string | null }> {
  await ensure()
  const rows = await sql`DELETE FROM sound_targets WHERE id = ${id} RETURNING r2_key`
  if (rows.length === 0) return { found: false, r2Key: null }
  return { found: true, r2Key: rows[0].r2_key ? String(rows[0].r2_key) : null }
}

/** Look up one target (used to presign its reference clip for playback). */
export async function getTarget(id: string): Promise<TargetRow | null> {
  await ensure()
  const rows = await sql`
    SELECT id, label, category, description, r2_key, content_type, duration, tags, app_slug, created_at, updated_at
    FROM sound_targets WHERE id = ${id}
  `
  return rows.length ? toRow(rows[0]) : null
}

/**
 * Bridge for the Node pipeline (compose.mjs / lib/music-learn.mjs), which reads
 * files/env, not Postgres. Dumps every target as plain JSON so the sound-side
 * ground truth can later be fed to the composer / ML corpus. Consumption in
 * compose/ML is a separate, later step — this only produces the export.
 */
export async function exportTargets(): Promise<{ exportedAt: string; count: number; targets: TargetRow[] }> {
  const targets = await listTargets()
  return { exportedAt: new Date().toISOString(), count: targets.length, targets }
}
