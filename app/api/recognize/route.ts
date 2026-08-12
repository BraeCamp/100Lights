// Passive song identification for Lightning Bug ("what's playing"). The client records a short
// audio clip and POSTs it here; we fingerprint it with AudD (Shazam-like — Shazam itself has no
// usable web API), then optionally enrich with Spotify audio-features (tempo/energy/…) so the Auto
// system has ground-truth to check its own analysis against. Degrades gracefully with no keys.
import { NextRequest } from 'next/server'

export const runtime = 'nodejs'
export const maxDuration = 30

// ---- optional Spotify audio-features enrichment (needs SPOTIFY_CLIENT_ID/SECRET) ----
let spToken: { value: string; exp: number } | null = null
async function spotifyToken(): Promise<string | null> {
  const id = process.env.SPOTIFY_CLIENT_ID, secret = process.env.SPOTIFY_CLIENT_SECRET
  if (!id || !secret) return null
  if (spToken && spToken.exp > Date.now() + 5000) return spToken.value
  try {
    const r = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', Authorization: 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64') },
      body: 'grant_type=client_credentials',
    })
    if (!r.ok) return null
    const d = await r.json() as { access_token: string; expires_in: number }
    spToken = { value: d.access_token, exp: Date.now() + d.expires_in * 1000 }
    return spToken.value
  } catch { return null }
}
async function spotifyFeatures(title: string, artist: string) {
  const tok = await spotifyToken(); if (!tok) return null
  try {
    const q = encodeURIComponent(`track:${title} artist:${artist}`)
    const s = await fetch(`https://api.spotify.com/v1/search?q=${q}&type=track&limit=1`, { headers: { Authorization: `Bearer ${tok}` } })
    if (!s.ok) return null
    const sd = await s.json() as { tracks?: { items?: { id: string }[] } }
    const id = sd.tracks?.items?.[0]?.id; if (!id) return null
    const f = await fetch(`https://api.spotify.com/v1/audio-features/${id}`, { headers: { Authorization: `Bearer ${tok}` } })
    if (!f.ok) return null
    const fd = await f.json() as Record<string, number>
    return { tempo: Math.round(fd.tempo), energy: fd.energy, danceability: fd.danceability, valence: fd.valence, acousticness: fd.acousticness, instrumentalness: fd.instrumentalness, key: fd.key, mode: fd.mode }
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
  body.append('return', 'apple_music,spotify')
  body.append('file', file, 'clip.webm')
  let d: { status?: string; result?: Record<string, unknown> }
  try {
    const r = await fetch('https://api.audd.io/', { method: 'POST', body })
    d = await r.json()
  } catch { return Response.json({ error: 'recognizer_unreachable' }, { status: 502 }) }

  if (d.status !== 'success' || !d.result) return Response.json({ match: null })
  const res = d.result as Record<string, any>
  const apple = res.apple_music as { genreNames?: string[]; url?: string; artwork?: { url?: string } } | undefined
  const match = {
    title: String(res.title ?? ''),
    artist: String(res.artist ?? ''),
    album: res.album ? String(res.album) : null,
    genre: apple?.genreNames?.[0] ?? null,
    appleUrl: apple?.url ?? null,
    spotifyUrl: (res.spotify as { external_urls?: { spotify?: string } } | undefined)?.external_urls?.spotify ?? null,
    artwork: apple?.artwork?.url ? apple.artwork.url.replace('{w}', '300').replace('{h}', '300') : null,
    features: await spotifyFeatures(String(res.title ?? ''), String(res.artist ?? '')),
  }
  return Response.json({ match })
}
