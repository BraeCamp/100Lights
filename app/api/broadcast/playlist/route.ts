// Resolves a station's playlist for the broadcast view, newest-source-wins:
//   1. files you dropped in public/broadcast/<slug>/  (most reliable for 24/7 — same-origin)
//   2. the station's static `tracks` (hard-coded in lib/stations.ts)
//   3. the Jamendo API (needs JAMENDO_CLIENT_ID) using the station's tags
// Returns the station's visual scene + a normalized track list. See STREAMING.md.
import { NextRequest } from 'next/server'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { getStation, type BroadcastTrack } from '@/lib/stations'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const AUDIO_EXT = /\.(mp3|m4a|aac|ogg|oga|wav|flac|opus)$/i
const titleFromFile = (f: string) => f.replace(AUDIO_EXT, '').replace(/[_-]+/g, ' ').replace(/\b\d+\.\s*/, '').trim()

async function localTracks(slug: string): Promise<BroadcastTrack[]> {
  try {
    const dir = join(process.cwd(), 'public', 'broadcast', slug)
    const files = (await readdir(dir)).filter(f => AUDIO_EXT.test(f)).sort()
    return files.map(f => ({ title: titleFromFile(f), url: `/broadcast/${slug}/${encodeURIComponent(f)}`, license: 'local (you supplied)' }))
  } catch { return [] }   // folder doesn't exist yet
}

async function jamendoTracks(tags: string, order = 'popularity_total', limit = 40): Promise<BroadcastTrack[]> {
  const cid = process.env.JAMENDO_CLIENT_ID
  if (!cid) return []
  // fuzzytags uses '+' to separate tags — DON'T url-encode it (that turns '+' into %2B → 0 results).
  // Encode each tag's spaces, keep the '+' separators.
  const ft = tags.split('+').map(t => encodeURIComponent(t.trim())).filter(Boolean).join('+')
  // Fetch Jamendo's max (200) so plenty survive the NonCommercial filter below; `limit` then caps
  // the returned playlist.
  const url = `https://api.jamendo.com/v3.0/tracks/?client_id=${cid}&format=json&limit=200` +
    `&fuzzytags=${ft}&order=${order}&audioformat=mp32&include=licenses&groupby=artist_id`
  try {
    const r = await fetch(url, { next: { revalidate: 1800 } })
    if (!r.ok) return []
    const data = await r.json() as { results?: { name: string; artist_name: string; audio: string; license_ccurl?: string }[] }
    // Without a licence, drop NonCommercial (by-nc*) tracks — not usable on a monetized stream.
    // Once you hold Jamendo's commercial RADIO licence (on the same account as this client_id), set
    // JAMENDO_COMMERCIAL=true and the full catalogue (incl. NC) is cleared for you.
    const licensed = process.env.JAMENDO_COMMERCIAL === 'true'
    return (data.results ?? []).filter(t => t.audio && (licensed || !/\/by-nc/i.test(t.license_ccurl || ''))).map(t => ({
      title: t.name,
      artist: t.artist_name,
      url: t.audio,
      license: t.license_ccurl || 'Jamendo',
      attribution: `${t.name} by ${t.artist_name}${t.license_ccurl ? ` (${t.license_ccurl})` : ''} — via Jamendo`,
    }))
  } catch { return [] }
}

export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get('station')
  const station = getStation(slug)
  if (!station) return Response.json({ error: 'Unknown station' }, { status: 404 })

  let tracks = await localTracks(station.slug)
  let source: 'local' | 'static' | 'jamendo' | 'none' = tracks.length ? 'local' : 'none'
  if (!tracks.length && station.tracks?.length) { tracks = station.tracks; source = 'static' }
  if (!tracks.length && station.jamendo) {
    tracks = await jamendoTracks(station.jamendo.tags, station.jamendo.order, station.jamendo.limit)
    if (tracks.length) source = 'jamendo'
  }

  return Response.json({
    station: { slug: station.slug, title: station.title, tagline: station.tagline, scene: station.scene, shuffle: station.shuffle ?? true, showNowPlaying: station.showNowPlaying ?? true },
    source,
    tracks,
  })
}
