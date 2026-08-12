// Passive song identification for Lightning Bug ("what's playing"). The client records a short
// audio clip and POSTs it here; we fingerprint it with AudD (Shazam-like — Shazam itself has no
// usable web API). Genre comes from AudD (Apple genreNames); tempo (BPM) ground-truth comes from
// Deezer's free API — Spotify deprecated its audio-features endpoint for new apps in late 2024, so
// we don't rely on it. Degrades gracefully with no AUDD_API_TOKEN.
import { NextRequest } from 'next/server'

export const runtime = 'nodejs'
export const maxDuration = 30

// Deezer track BPM (free, no auth). Coverage is partial — many tracks report bpm 0 (unknown).
async function deezerTempo(title: string, artist: string): Promise<number | null> {
  try {
    const q = encodeURIComponent(`${title} ${artist}`.trim())
    const s = await fetch(`https://api.deezer.com/search?q=${q}&limit=1`)
    if (!s.ok) return null
    const sd = await s.json() as { data?: { id: number }[] }
    const id = sd.data?.[0]?.id; if (!id) return null
    const t = await fetch(`https://api.deezer.com/track/${id}`)
    if (!t.ok) return null
    const td = await t.json() as { bpm?: number }
    return td.bpm && td.bpm > 0 ? Math.round(td.bpm) : null
  } catch { return null }
}

export async function POST(req: NextRequest) {
  const token = process.env.AUDD_API_TOKEN
  if (!token) return Response.json({ error: 'not_configured' })   // toggle shows the setup hint
  let file: File | null = null
  try { file = (await req.formData()).get('audio') as File | null } catch { /* bad form */ }
  if (!file) return Response.json({ error: 'no_audio' }, { status: 400 })

  const body = new FormData()
  body.append('api_token', token)
  body.append('return', 'apple_music,spotify,deezer')
  body.append('file', file, 'clip.webm')
  let d: { status?: string; result?: Record<string, unknown> }
  try {
    const r = await fetch('https://api.audd.io/', { method: 'POST', body })
    d = await r.json()
  } catch { return Response.json({ error: 'recognizer_unreachable' }, { status: 502 }) }

  if (d.status !== 'success' || !d.result) return Response.json({ match: null })
  const res = d.result as Record<string, any>
  const apple = res.apple_music as { genreNames?: string[]; url?: string; artwork?: { url?: string } } | undefined
  const title = String(res.title ?? ''), artist = String(res.artist ?? '')
  const tempo = await deezerTempo(title, artist)
  const match = {
    title, artist,
    album: res.album ? String(res.album) : null,
    genre: apple?.genreNames?.[0] ?? null,
    appleUrl: apple?.url ?? null,
    spotifyUrl: (res.spotify as { external_urls?: { spotify?: string } } | undefined)?.external_urls?.spotify ?? null,
    artwork: apple?.artwork?.url ? apple.artwork.url.replace('{w}', '300').replace('{h}', '300') : null,
    features: tempo ? { tempo } : null,
  }
  return Response.json({ match })
}
