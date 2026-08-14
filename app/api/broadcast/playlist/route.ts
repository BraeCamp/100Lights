// Resolves a station's playlist for the broadcast view, newest-source-wins:
//   1. files you dropped in public/broadcast/<slug>/  (most reliable for 24/7 — same-origin)
//   2. the station's static `tracks` (hard-coded in lib/stations.ts)
//   3. the Jamendo API (needs JAMENDO_CLIENT_ID) using the station's tags
// Returns the station's visual scene + a normalized track list. See STREAMING.md.
import { NextRequest } from 'next/server'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { type BroadcastTrack, type Station } from '@/lib/stations'
import { getStationDb } from '@/lib/broadcast-stations'
import { jamendoSearch, jamendoLicensed } from '@/lib/jamendo'
import { tagsToFamily, type Family } from '@/lib/genre-map'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Station's default genre (for local/static tracks with no tags) — from its Jamendo tags, then slug.
const SLUG_GENRE: Record<string, Family> = { cinematic: 'Orchestral', 'dnd-tavern': 'Lofi / Chill', 'dnd-dungeon': 'Ambient', 'study-lofi': 'Lofi / Chill', 'deep-focus': 'Ambient' }
const stationGenre = (s: Station): Family | undefined =>
  tagsToFamily(s.jamendo?.tags?.split('+')) ?? SLUG_GENRE[s.slug]

const AUDIO_EXT = /\.(mp3|m4a|aac|ogg|oga|wav|flac|opus)$/i
const titleFromFile = (f: string) => f.replace(AUDIO_EXT, '').replace(/[_-]+/g, ' ').replace(/\b\d+\.\s*/, '').trim()

async function localTracks(slug: string): Promise<BroadcastTrack[]> {
  try {
    const dir = join(process.cwd(), 'public', 'broadcast', slug)
    const files = (await readdir(dir)).filter(f => AUDIO_EXT.test(f)).sort()
    return files.map(f => ({ title: titleFromFile(f), url: `/broadcast/${slug}/${encodeURIComponent(f)}`, license: 'local (you supplied)' }))
  } catch { return [] }   // folder doesn't exist yet
}

async function jamendoTracks(tags: string, order = 'popularity_total', fallbackGenre?: Family): Promise<BroadcastTrack[]> {
  const rows = await jamendoSearch({ tags, order })
  const licensed = jamendoLicensed()
  return rows.map(t => ({
    title: t.title, artist: t.artist, url: t.audio, license: t.license,
    // Licensed → attribution isn't required (courtesy line, no CC link). Unlicensed → full CC credit.
    attribution: licensed ? `${t.title} — ${t.artist} · Jamendo` : `${t.title} by ${t.artist} (${t.license}) — via Jamendo`,
    genre: tagsToFamily(t.tags) ?? fallbackGenre,   // per-track genre from its own tags → visual prior
  }))
}

export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get('station')
  const station = await getStationDb(slug)   // DB-backed (editable in the radio admin), falls back to code
  if (!station) return Response.json({ error: 'Unknown station' }, { status: 404 })

  const def = stationGenre(station)
  let tracks = await localTracks(station.slug)
  let source: 'local' | 'static' | 'jamendo' | 'none' = tracks.length ? 'local' : 'none'
  if (!tracks.length && station.tracks?.length) { tracks = station.tracks; source = 'static' }
  if (!tracks.length && station.jamendo) {
    tracks = await jamendoTracks(station.jamendo.tags, station.jamendo.order, def)
    if (tracks.length) source = 'jamendo'
  }
  // Ensure every track has a genre (local/static have no tags) → the client uses it as the prior.
  tracks = tracks.map(t => (t.genre ? t : { ...t, genre: def }))

  return Response.json({
    station: { slug: station.slug, title: station.title, tagline: station.tagline, scene: station.scene, fullScene: station.fullScene, shuffle: station.shuffle ?? true, showNowPlaying: station.showNowPlaying ?? true },
    source,
    tracks,
  })
}
