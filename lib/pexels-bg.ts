// Tagged Pexels background catalog. We store ONLY each video's stream link + our tags (never the
// video file) — the <video> streams straight from Pexels' CDN. A row is a few hundred bytes, so the
// whole catalog is tiny (see the admin panel). Curated in /admin/lightning-bug.
import { sql } from '@/lib/db'

export type Brightness = 'bright' | 'mid' | 'dark'
export type Speed = 'fast' | 'standard' | 'slow'

export interface PexelsBg {
  id: string            // `px-<pexelsId>`
  pexelsId: number
  title: string
  mp4: string           // Pexels CDN stream URL (we never download it)
  poster: string
  width: number
  height: number
  duration: number
  category: string
  brightness: Brightness
  speed: Speed
  tags: string[]
  author: string
  authorUrl: string
  status: 'active' | 'hidden'
  blockEdits?: string[]   // auto-editor effect ids DISABLED for this clip (curated in /admin/lightning-bug)
  addedAt?: string
}

let ready = false
async function ensure() {
  if (ready) return
  await sql`
    CREATE TABLE IF NOT EXISTS pexels_bg (
      id         TEXT PRIMARY KEY,
      pexels_id  BIGINT UNIQUE NOT NULL,
      title      TEXT NOT NULL DEFAULT '',
      mp4        TEXT NOT NULL,
      poster     TEXT NOT NULL DEFAULT '',
      width      INT NOT NULL DEFAULT 0,
      height     INT NOT NULL DEFAULT 0,
      duration   INT NOT NULL DEFAULT 0,
      category   TEXT NOT NULL DEFAULT 'Abstract',
      brightness TEXT NOT NULL DEFAULT 'mid',
      speed      TEXT NOT NULL DEFAULT 'standard',
      tags       TEXT[] NOT NULL DEFAULT '{}',
      author     TEXT NOT NULL DEFAULT '',
      author_url TEXT NOT NULL DEFAULT '',
      status     TEXT NOT NULL DEFAULT 'active',
      block_edits TEXT[] NOT NULL DEFAULT '{}',
      added_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`
  await sql`ALTER TABLE pexels_bg ADD COLUMN IF NOT EXISTS block_edits TEXT[] NOT NULL DEFAULT '{}'`   // migrate existing tables
  await sql`CREATE INDEX IF NOT EXISTS pexels_bg_status_idx ON pexels_bg (status, category)`
  ready = true
}

function toRow(r: Record<string, unknown>): PexelsBg {
  return {
    id: String(r.id), pexelsId: Number(r.pexels_id), title: String(r.title ?? ''),
    mp4: String(r.mp4), poster: String(r.poster ?? ''),
    width: Number(r.width ?? 0), height: Number(r.height ?? 0), duration: Number(r.duration ?? 0),
    category: String(r.category ?? 'Abstract'), brightness: (r.brightness as Brightness) ?? 'mid', speed: (r.speed as Speed) ?? 'standard',
    tags: (r.tags as string[] | null) ?? [], author: String(r.author ?? ''), authorUrl: String(r.author_url ?? ''),
    status: (r.status as 'active' | 'hidden') ?? 'active', blockEdits: (r.block_edits as string[] | null) ?? [],
    addedAt: r.added_at ? String(r.added_at) : undefined,
  }
}

// Insert a batch, skipping any pexels_id we already have. Returns how many were added.
export async function insertMany(rows: PexelsBg[]): Promise<number> {
  await ensure()
  let added = 0
  for (const r of rows) {
    const res = await sql`
      INSERT INTO pexels_bg (id, pexels_id, title, mp4, poster, width, height, duration, category, brightness, speed, tags, author, author_url, status)
      VALUES (${r.id}, ${r.pexelsId}, ${r.title}, ${r.mp4}, ${r.poster}, ${r.width}, ${r.height}, ${r.duration}, ${r.category}, ${r.brightness}, ${r.speed}, ${r.tags}, ${r.author}, ${r.authorUrl}, 'active')
      ON CONFLICT (pexels_id) DO NOTHING
      RETURNING id`
    if (res.length) added++
  }
  return added
}

export interface ListOpts { q?: string; category?: string; brightness?: string; speed?: string; status?: string; limit?: number; offset?: number; order?: 'recent' | 'random' }

export async function list(o: ListOpts = {}): Promise<PexelsBg[]> {
  await ensure()
  const status = o.status ?? 'active'
  const limit = Math.min(500, o.limit ?? 60)
  const offset = o.offset ?? 0
  const q = (o.q ?? '').trim().toLowerCase()
  // Search over title/category/tags. Keep it simple + index-friendly (small catalog). 'random' feeds
  // the live shuffle pool with varied clips from across the whole catalogue.
  const order = o.order === 'random' ? 'random()' : 'added_at DESC'
  const rows = await sql`
    SELECT * FROM pexels_bg
    WHERE (${status} = 'any' OR status = ${status})
      AND (${o.category ?? ''} = '' OR category = ${o.category ?? ''})
      AND (${o.brightness ?? ''} = '' OR brightness = ${o.brightness ?? ''})
      AND (${o.speed ?? ''} = '' OR speed = ${o.speed ?? ''})
      AND (${q} = '' OR lower(title) LIKE ${'%' + q + '%'} OR lower(category) LIKE ${'%' + q + '%'} OR EXISTS (SELECT 1 FROM unnest(tags) t WHERE lower(t) LIKE ${'%' + q + '%'}))
    ORDER BY ${sql.unsafe(order)}
    LIMIT ${limit} OFFSET ${offset}`
  return rows.map(toRow)
}

export async function countActive(): Promise<number> {
  await ensure()
  const [{ n }] = await sql`SELECT COUNT(*)::int AS n FROM pexels_bg WHERE status = 'active'` as { n: number }[]
  return n
}

// Per-field updates (Neon template can't do dynamic SET lists cleanly, so update explicitly).
export async function patchRow(id: string, patch: Partial<Pick<PexelsBg, 'title' | 'category' | 'brightness' | 'speed' | 'tags' | 'status' | 'blockEdits'>>): Promise<void> {
  await ensure()
  if (patch.title != null) await sql`UPDATE pexels_bg SET title = ${patch.title} WHERE id = ${id}`
  if (patch.category != null) await sql`UPDATE pexels_bg SET category = ${patch.category} WHERE id = ${id}`
  if (patch.brightness != null) await sql`UPDATE pexels_bg SET brightness = ${patch.brightness} WHERE id = ${id}`
  if (patch.speed != null) await sql`UPDATE pexels_bg SET speed = ${patch.speed} WHERE id = ${id}`
  if (patch.tags != null) await sql`UPDATE pexels_bg SET tags = ${patch.tags} WHERE id = ${id}`
  if (patch.status != null) await sql`UPDATE pexels_bg SET status = ${patch.status} WHERE id = ${id}`
  if (patch.blockEdits != null) await sql`UPDATE pexels_bg SET block_edits = ${patch.blockEdits} WHERE id = ${id}`
}

export async function remove(id: string): Promise<void> {
  await ensure()
  await sql`DELETE FROM pexels_bg WHERE id = ${id}`
}
