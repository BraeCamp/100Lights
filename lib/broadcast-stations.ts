// DB-backed broadcast stations — the editable store behind the /admin/lightning-bug/radio control
// panel. Each station's full config (scene + audio source + playlist + flags) lives as one JSON row,
// so edits take effect on the live stream with no redeploy. The code-defined STATIONS in lib/stations
// remain the SEED + fallback: on first use the table is seeded from them, and if the DB is ever
// unreachable the playlist route falls back to the code list. Server-only (imports @/lib/db).
import { sql } from '@/lib/db'
import { STATIONS, type Station } from '@/lib/stations'

export interface StationRow extends Station {
  enabled: boolean
  sort: number
  updatedAt?: string
}

let ready = false
async function ensure() {
  if (ready) return
  await sql`
    CREATE TABLE IF NOT EXISTS broadcast_stations (
      slug       TEXT PRIMARY KEY,
      config     JSONB NOT NULL,        -- { title, tagline, scene, tracks?, jamendo?, shuffle?, showNowPlaying? }
      enabled    BOOLEAN NOT NULL DEFAULT TRUE,
      sort       INT NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`
  // Seed from the code-defined stations whenever the table is empty (first run, or after it was
  // cleared) so the panel always opens with at least the current code lineup.
  const [{ n }] = await sql`SELECT COUNT(*)::int AS n FROM broadcast_stations` as { n: number }[]
  if (n === 0) {
    for (let i = 0; i < STATIONS.length; i++) {
      const s = STATIONS[i]
      await sql`INSERT INTO broadcast_stations (slug, config, enabled, sort)
                VALUES (${s.slug}, ${JSON.stringify(stripSlug(s))}, TRUE, ${i})
                ON CONFLICT (slug) DO NOTHING`
    }
  }
  ready = true
}

// The slug is the row key; keep it out of the JSON blob to avoid two sources of truth.
function stripSlug(s: Station): Omit<Station, 'slug'> {
  const { slug: _slug, ...rest } = s
  return rest
}

function toRow(r: Record<string, unknown>): StationRow {
  const cfg = (typeof r.config === 'string' ? JSON.parse(r.config) : r.config) as Omit<Station, 'slug'>
  return { slug: String(r.slug), ...cfg, enabled: r.enabled !== false, sort: Number(r.sort ?? 0), updatedAt: r.updated_at ? String(r.updated_at) : undefined }
}

/** All stations (admin view — includes disabled), ordered. Falls back to code STATIONS on DB error. */
export async function listStationRows(): Promise<StationRow[]> {
  try {
    await ensure()
    const rows = await sql`SELECT * FROM broadcast_stations ORDER BY sort, slug`
    return rows.map(toRow)
  } catch {
    return STATIONS.map((s, i) => ({ ...s, enabled: true, sort: i }))
  }
}

/** Enabled stations only (public launcher / playlist). */
export async function listEnabledStations(): Promise<StationRow[]> {
  return (await listStationRows()).filter(s => s.enabled)
}

/** One station by slug (enabled or not). Falls back to the code definition. */
export async function getStationDb(slug?: string | null): Promise<StationRow | undefined> {
  if (!slug) return undefined
  try {
    await ensure()
    const rows = await sql`SELECT * FROM broadcast_stations WHERE slug = ${slug}`
    if (rows.length) return toRow(rows[0])
  } catch { /* fall through to code */ }
  const code = STATIONS.find(s => s.slug === slug)
  return code ? { ...code, enabled: true, sort: 0 } : undefined
}

/** Create or overwrite a station. Validates the slug; stores the rest as JSON. */
export async function upsertStation(row: StationRow): Promise<void> {
  await ensure()
  const slug = row.slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '')
  if (!slug) throw new Error('invalid slug')
  const { enabled, sort } = row
  await sql`
    INSERT INTO broadcast_stations (slug, config, enabled, sort, updated_at)
    VALUES (${slug}, ${JSON.stringify(stripSlug({ ...row, slug }))}, ${enabled}, ${sort}, NOW())
    ON CONFLICT (slug) DO UPDATE SET config = EXCLUDED.config, enabled = EXCLUDED.enabled, sort = EXCLUDED.sort, updated_at = NOW()`
}

export async function setStationEnabled(slug: string, enabled: boolean): Promise<void> {
  await ensure()
  await sql`UPDATE broadcast_stations SET enabled = ${enabled}, updated_at = NOW() WHERE slug = ${slug}`
}

export async function deleteStation(slug: string): Promise<void> {
  await ensure()
  await sql`DELETE FROM broadcast_stations WHERE slug = ${slug}`
}

const codeSort = (slug: string) => { const i = STATIONS.findIndex(s => s.slug === slug); return i < 0 ? 999 : i }
async function writeDefault(s: Station) {
  await sql`
    INSERT INTO broadcast_stations (slug, config, enabled, sort, updated_at)
    VALUES (${s.slug}, ${JSON.stringify(stripSlug(s))}, TRUE, ${codeSort(s.slug)}, NOW())
    ON CONFLICT (slug) DO UPDATE SET config = EXCLUDED.config, enabled = TRUE, sort = EXCLUDED.sort, updated_at = NOW()`
}

/** Reset the WHOLE store to the code-defined stations (lib/stations): drop everything, re-insert the
 *  defaults. Discards all panel edits + any custom/test stations. Runs its own writes, so it works
 *  even on a warm process (unlike the empty-table auto-seed, which only fires on a cold start). */
export async function resetToDefaults(): Promise<void> {
  await ensure()
  await sql`DELETE FROM broadcast_stations`
  for (const s of STATIONS) await writeDefault(s)
}

/** Reset ONE station to its code default (only if it exists in lib/stations). */
export async function resetStation(slug: string): Promise<boolean> {
  await ensure()
  const s = STATIONS.find(x => x.slug === slug)
  if (!s) return false
  await writeDefault(s)
  return true
}
