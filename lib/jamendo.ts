// Shared Jamendo API search (used by the broadcast playlist resolver + the admin radio panel).
// The fuzzytags endpoint is FLAKY (identical query returns tracks, then 0, then tracks), so we
// retry with cache:'no-store'. With JAMENDO_COMMERCIAL the CC terms don't bind us, so NonCommercial
// tracks are included; otherwise they're filtered out.
export interface JamendoTrack {
  id: string
  title: string
  artist: string
  audio: string       // stream URL (Jamendo CDN) — playable directly in an <audio> element
  license: string     // CC url when unlicensed, else 'Jamendo (licensed)'
  album?: string
  duration?: number
  shareurl?: string   // the track's page on jamendo.com
  tags?: string[]     // the track's own genre/mood tags (from musicinfo) — used to re-rank by vibe
}

export const jamendoConfigured = () => !!process.env.JAMENDO_CLIENT_ID
export const jamendoLicensed = () => process.env.JAMENDO_COMMERCIAL === 'true'

export async function jamendoSearch(opts: { tags?: string; name?: string; order?: string; limit?: number; commercialOnly?: boolean }): Promise<JamendoTrack[]> {
  const cid = process.env.JAMENDO_CLIENT_ID
  if (!cid) return []
  // Normally JAMENDO_COMMERCIAL lets NonCommercial tracks through (they don't bind us). But when a
  // caller asks for commercialOnly (e.g. "inspired by ___" results meant for a monetized stream),
  // exclude NC regardless so every result is safe to broadcast.
  const licensed = jamendoLicensed() && !opts.commercialOnly
  const params = new URLSearchParams({
    client_id: cid, format: 'json', limit: String(opts.limit ?? 200),
    audioformat: 'mp32', include: 'musicinfo licenses', groupby: 'artist_id',
    order: opts.order || 'popularity_total',
  })
  if (opts.name) params.set('namesearch', opts.name)
  // fuzzytags can't go through URLSearchParams (it would encode the '+' separators) — append raw.
  const ft = opts.tags ? '&fuzzytags=' + opts.tags.split('+').map(t => encodeURIComponent(t.trim())).filter(Boolean).join('+') : ''
  const url = `https://api.jamendo.com/v3.0/tracks/?${params.toString()}${ft}`
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await fetch(url, { cache: 'no-store' })
      if (!r.ok) continue
      const d = await r.json() as { results?: Record<string, unknown>[] }
      const rows = (d.results ?? []).filter(t => t.audio && (licensed || !/\/by-nc/i.test(String(t.license_ccurl || ''))))
      if (!rows.length) continue
      return rows.map(t => mapRow(t, licensed))
    } catch { /* retry */ }
  }
  return []
}

function mapRow(t: Record<string, unknown>, licensed: boolean): JamendoTrack {
  const mi = (t.musicinfo as { tags?: { genres?: string[]; instruments?: string[]; vartags?: string[] } })?.tags
  const tags = [...(mi?.genres ?? []), ...(mi?.vartags ?? []), ...(mi?.instruments ?? [])].map(x => String(x).toLowerCase())
  return {
    id: String(t.id), title: String(t.name ?? ''), artist: String(t.artist_name ?? ''), audio: String(t.audio),
    license: licensed ? 'Jamendo (licensed)' : String(t.license_ccurl || 'Jamendo'),
    album: t.album_name ? String(t.album_name) : undefined,
    duration: t.duration ? Number(t.duration) : undefined,
    shareurl: t.shareurl ? String(t.shareurl) : undefined,
    tags: tags.length ? tags : undefined,
  }
}

/** Look up ONE track by its Jamendo id (from a pasted jamendo.com/track/<id>/… link). Returns null
 *  if not found or NonCommercial when commercialOnly. */
export async function jamendoById(id: string, opts: { commercialOnly?: boolean } = {}): Promise<JamendoTrack | null> {
  const cid = process.env.JAMENDO_CLIENT_ID
  if (!cid || !/^\d+$/.test(id)) return null
  const licensed = jamendoLicensed() && !opts.commercialOnly
  const params = new URLSearchParams({ client_id: cid, format: 'json', id, audioformat: 'mp32', include: 'musicinfo licenses' })
  const url = `https://api.jamendo.com/v3.0/tracks/?${params.toString()}`
  // Jamendo's API is flaky (an identical query can return the row, then 0, then the row) — retry a few times.
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await fetch(url, { cache: 'no-store' })
      if (!r.ok) continue
      const d = await r.json() as { results?: Record<string, unknown>[] }
      const t = (d.results ?? [])[0]
      if (!t) continue
      if (!t.audio) return null
      if (!licensed && /\/by-nc/i.test(String(t.license_ccurl || ''))) return null   // NonCommercial excluded
      return mapRow(t, licensed)
    } catch { /* retry */ }
  }
  return null
}
