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
}

export const jamendoConfigured = () => !!process.env.JAMENDO_CLIENT_ID
export const jamendoLicensed = () => process.env.JAMENDO_COMMERCIAL === 'true'

export async function jamendoSearch(opts: { tags?: string; name?: string; order?: string; limit?: number }): Promise<JamendoTrack[]> {
  const cid = process.env.JAMENDO_CLIENT_ID
  if (!cid) return []
  const licensed = jamendoLicensed()
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
      return rows.map(t => ({
        id: String(t.id), title: String(t.name ?? ''), artist: String(t.artist_name ?? ''), audio: String(t.audio),
        license: licensed ? 'Jamendo (licensed)' : String(t.license_ccurl || 'Jamendo'),
        album: t.album_name ? String(t.album_name) : undefined,
        duration: t.duration ? Number(t.duration) : undefined,
        shareurl: t.shareurl ? String(t.shareurl) : undefined,
      }))
    } catch { /* retry */ }
  }
  return []
}
