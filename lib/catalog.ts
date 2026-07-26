import { sql } from '@/lib/db'

// The OFFICIAL sound catalog — global, admin-curated, ships to every user's
// library (distinct from per-user synced sounds in `user_sounds`). Audio blobs
// live in R2 under `catalog/`, served publicly via /api/catalog/audio. The
// client pulls this on library init and materialises each entry locally, so the
// editor's play path is unchanged.

export interface CatalogRow {
  id: string
  name: string
  category: string
  r2Key: string
  duration: number
  contentType: string
  folder?: string
  parentFolder?: string
  tags?: string[]
  key?: string
  bpm?: number
  createdAt?: string
}

let ready = false
async function ensure() {
  if (ready) return
  await sql`
    CREATE TABLE IF NOT EXISTS catalog_sounds (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      category      TEXT NOT NULL DEFAULT 'custom',
      r2_key        TEXT NOT NULL,
      duration      DOUBLE PRECISION NOT NULL DEFAULT 0,
      content_type  TEXT NOT NULL DEFAULT '',
      folder        TEXT,
      parent_folder TEXT DEFAULT '100Lights Catalog',
      tags          JSONB,
      musical_key   TEXT,
      bpm           DOUBLE PRECISION,
      sort          INTEGER NOT NULL DEFAULT 0,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  ready = true
}

function toRow(r: Record<string, unknown>): CatalogRow {
  return {
    id: String(r.id),
    name: String(r.name),
    category: String(r.category),
    r2Key: String(r.r2_key),
    duration: Number(r.duration ?? 0),
    contentType: String(r.content_type ?? ''),
    folder: r.folder ? String(r.folder) : undefined,
    parentFolder: r.parent_folder ? String(r.parent_folder) : undefined,
    tags: (r.tags as string[] | null) ?? undefined,
    key: r.musical_key ? String(r.musical_key) : undefined,
    bpm: r.bpm != null ? Number(r.bpm) : undefined,
    createdAt: r.created_at ? String(r.created_at) : undefined,
  }
}

export async function listCatalog(): Promise<CatalogRow[]> {
  await ensure()
  const rows = await sql`
    SELECT id, name, category, r2_key, duration, content_type, folder, parent_folder, tags, musical_key, bpm, created_at
    FROM catalog_sounds ORDER BY sort ASC, created_at ASC
  `
  return rows.map(toRow)
}

export async function addCatalog(p: {
  id: string; name: string; category?: string; r2Key: string
  duration?: number; contentType?: string; folder?: string; parentFolder?: string
  tags?: string[]; key?: string; bpm?: number
}): Promise<void> {
  await ensure()
  await sql`
    INSERT INTO catalog_sounds (id, name, category, r2_key, duration, content_type, folder, parent_folder, tags, musical_key, bpm)
    VALUES (${p.id}, ${p.name}, ${p.category ?? 'custom'}, ${p.r2Key}, ${p.duration ?? 0}, ${p.contentType ?? ''},
            ${p.folder ?? null}, ${p.parentFolder ?? '100Lights Catalog'},
            ${p.tags ? JSON.stringify(p.tags) : null}, ${p.key ?? null}, ${p.bpm ?? null})
  `
}

// Full-metadata update — the admin edit form sends every field, so we just set
// them (avoids conditional-fragment SQL). category/name are required.
export async function updateCatalog(id: string, p: {
  name: string; category: string; folder?: string | null; tags?: string[] | null; key?: string | null; bpm?: number | null
}): Promise<boolean> {
  await ensure()
  const rows = await sql`
    UPDATE catalog_sounds SET
      name        = ${p.name},
      category    = ${p.category},
      folder      = ${p.folder ?? null},
      tags        = ${p.tags && p.tags.length ? JSON.stringify(p.tags) : null},
      musical_key = ${p.key ?? null},
      bpm         = ${p.bpm ?? null},
      updated_at  = NOW()
    WHERE id = ${id}
    RETURNING id
  `
  return rows.length > 0
}

/** Delete the row and return its r2_key so the caller can drop the R2 object. */
export async function deleteCatalog(id: string): Promise<string | null> {
  await ensure()
  const rows = await sql`DELETE FROM catalog_sounds WHERE id = ${id} RETURNING r2_key`
  return rows.length ? String(rows[0].r2_key) : null
}
