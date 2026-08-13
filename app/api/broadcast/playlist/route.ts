// Resolves a station's playlist for the broadcast view, newest-source-wins:
//   1. files you dropped in public/broadcast/<slug>/  (most reliable for 24/7 — same-origin)
//   2. the station's static `tracks` (hard-coded in lib/stations.ts)
//   3. the Jamendo API (needs JAMENDO_CLIENT_ID) using the station's tags
// Returns the station's visual scene + a normalized track list. See STREAMING.md.
import { NextRequest } from 'next/server'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { getStation, type BroadcastTrack } from '@/lib/stations'
import { jamendoSearch, jamendoLicensed } from '@/lib/jamendo'

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

async function jamendoTracks(tags: string, order = 'popularity_total'): Promise<BroadcastTrack[]> {
  const rows = await jamendoSearch({ tags, order })
  const licensed = jamendoLicensed()
  return rows.map(t => ({
    title: t.title, artist: t.artist, url: t.audio, license: t.license,
    // Licensed → attribution isn't required (courtesy line, no CC link). Unlicensed → full CC credit.
    attribution: licensed ? `${t.title} — ${t.artist} · Jamendo` : `${t.title} by ${t.artist} (${t.license}) — via Jamendo`,
  }))
}

export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get('station')
  const station = getStation(slug)
  if (!station) return Response.json({ error: 'Unknown station' }, { status: 404 })

  let tracks = await localTracks(station.slug)
  let source: 'local' | 'static' | 'jamendo' | 'none' = tracks.length ? 'local' : 'none'
  if (!tracks.length && station.tracks?.length) { tracks = station.tracks; source = 'static' }
  if (!tracks.length && station.jamendo) {
    tracks = await jamendoTracks(station.jamendo.tags, station.jamendo.order)
    if (tracks.length) source = 'jamendo'
  }

  return Response.json({
    station: { slug: station.slug, title: station.title, tagline: station.tagline, scene: station.scene, shuffle: station.shuffle ?? true, showNowPlaying: station.showNowPlaying ?? true },
    source,
    tracks,
  })
}
