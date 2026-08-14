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
  edited?: boolean       // true = customized in the panel (Save); such rows STOP following code edits
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
      edited     BOOLEAN NOT NULL DEFAULT FALSE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`
  await sql`ALTER TABLE broadcast_stations ADD COLUMN IF NOT EXISTS edited BOOLEAN NOT NULL DEFAULT FALSE`
  // Sync from the code-defined stations on every cold start so code edits to lib/stations PROPAGATE:
  //   • a station not in the DB yet  → inserted
  //   • a station the panel hasn't customized (edited=false) → its CONFIG is refreshed from code
  //     (enabled + sort are preserved — those are operational choices, not code content)
  //   • a station Saved in the panel (edited=true) → left alone; your customization wins
  // So: newest lib/stations always shows up for un-customized stations; "Reset" re-follows code.
  for (let i = 0; i < STATIONS.length; i++) {
    const s = STATIONS[i]
    await sql`INSERT INTO broadcast_stations (slug, config, enabled, sort, edited)
              VALUES (${s.slug}, ${JSON.stringify(stripSlug(s))}, TRUE, ${i}, FALSE)
              ON CONFLICT (slug) DO UPDATE SET config = EXCLUDED.config, updated_at = NOW()
              WHERE broadcast_stations.edited = FALSE`
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
  return { slug: String(r.slug), ...cfg, enabled: r.enabled !== false, sort: Number(r.sort ?? 0), edited: r.edited === true, updatedAt: r.updated_at ? String(r.updated_at) : undefined }
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
  // A panel Save marks the row `edited` so the code-sync stops overwriting it (your version wins).
  await sql`
    INSERT INTO broadcast_stations (slug, config, enabled, sort, edited, updated_at)
    VALUES (${slug}, ${JSON.stringify(stripSlug({ ...row, slug }))}, ${enabled}, ${sort}, TRUE, NOW())
    ON CONFLICT (slug) DO UPDATE SET config = EXCLUDED.config, enabled = EXCLUDED.enabled, sort = EXCLUDED.sort, edited = TRUE, updated_at = NOW()`
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
  // Reset restores code config AND clears `edited`, so the station follows code edits again.
  await sql`
    INSERT INTO broadcast_stations (slug, config, enabled, sort, edited, updated_at)
    VALUES (${s.slug}, ${JSON.stringify(stripSlug(s))}, TRUE, ${codeSort(s.slug)}, FALSE, NOW())
    ON CONFLICT (slug) DO UPDATE SET config = EXCLUDED.config, enabled = TRUE, sort = EXCLUDED.sort, edited = FALSE, updated_at = NOW()`
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
