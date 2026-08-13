// "Find music inspired by ___" for the radio admin. Picks the best available method:
//   • audio-embeddings — if the catalogue is embedded (npm run embed:jamendo, local CLAP): Claude
//     turns the prompt into vibe tags, we pick the best-matching EMBEDDED track as a seed, and return
//     its nearest-by-sound neighbours. Query-by-example → nothing heavy runs on the server.
//   • ai-search — otherwise: Claude maps the prompt to Jamendo tags/name, then we search the API and
//     re-rank by vibe. Commercial-safe (no NonCommercial) either way.
import { isAdmin } from '@/lib/admin-auth'
import { jamendoSearch } from '@/lib/jamendo'
import { embeddingCount, seedByTags, nearest } from '@/lib/track-embeddings'

export const runtime = 'nodejs'
export const maxDuration = 60

interface OutTrack { id: string; title: string; artist: string; audio: string; score?: number }

// Claude turns "inspired by <X>" into a catalogue search spec.
async function interpret(prompt: string): Promise<{ tags: string; name: string; note: string }> {
  const fallback = { tags: prompt.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 5).join('+'), name: '', note: '' }
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return fallback
  const system = 'You map a "music inspired by ___" request onto a search over a royalty-free music catalogue. Reply with ONLY compact JSON: {"tags":"a+b+c","name":"","note":""}. tags = 3-6 lowercase single-word genre/mood/instrument tags joined by "+", derived from the musical characteristics of the reference (genre, tempo feel, mood, instrumentation, era). name = a specific artist or song title to also search, or "" . note = one short sentence describing the target vibe.'
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 300, system, messages: [{ role: 'user', content: `inspired by: ${prompt}` }] }),
    })
    const d = await r.json() as { content?: { text?: string }[] }
    const m = (d.content?.[0]?.text || '').match(/\{[\s\S]*\}/)
    if (m) {
      const j = JSON.parse(m[0]) as { tags?: string; name?: string; note?: string }
      return { tags: String(j.tags || '').replace(/\s+/g, '+').replace(/,/g, '+'), name: String(j.name || ''), note: String(j.note || '') }
    }
  } catch { /* fall through */ }
  return fallback
}

export async function POST(req: Request) {
  if (!await isAdmin()) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  let prompt = ''
  try { prompt = String((await req.json())?.prompt || '').trim() } catch { /* bad json */ }
  if (!prompt) return Response.json({ error: 'Missing prompt' }, { status: 400 })

  // 1) True audio similarity (query-by-example) — if the catalogue is embedded. Claude interprets the
  //    prompt → vibe tags → we pick the best-matching embedded track as a seed → return its nearest
  //    neighbours by sound. All embedded tracks are commercial-safe, so every neighbour is too.
  if (await embeddingCount() > 0) {
    const spec = await interpret(prompt)
    const seed = await seedByTags(spec.tags.split('+').filter(Boolean))
    if (seed) {
      const rows = await nearest(seed.embedding, 40, seed.id)
      const tracks: OutTrack[] = rows.map(r => ({ id: r.id, title: r.title, artist: r.artist, audio: r.audio, score: Math.round(r.score * 100) / 100 }))
      return Response.json({ method: 'audio-embeddings', tracks, interpretation: { ...spec, note: `Sounds like “${seed.title}” — ${spec.note}`.trim() } })
    }
  }

  // 2) AI-interpreted catalogue search (works now, no embeddings needed).
  //    Jamendo's fuzzytags is a loose keyword OR — it can't tell "dark & moody" from "upbeat disco".
  //    So we pull a wide commercial-safe candidate set, then re-rank by how many of Claude's
  //    interpreted mood/genre tags each track actually carries. Commercial-safe only (no NC) so
  //    every result is usable on a monetized broadcast.
  const spec = await interpret(prompt)
  let rows = spec.tags ? await jamendoSearch({ tags: spec.tags, limit: 200, commercialOnly: true }) : []
  if (rows.length < 12 && spec.name) rows = [...rows, ...await jamendoSearch({ name: spec.name, limit: 40, commercialOnly: true })]

  // Score each track by how many of its own tags relate to Claude's interpreted tags. Substring match
  // both ways (min 3 chars) so "synth" counts a track tagged "synthpop", "melanchol" catches
  // "melancholic", etc.
  const targets = spec.tags.split('+').map(t => t.trim().toLowerCase()).filter(t => t.length >= 3)
  const vibe = (t: { tags?: string[] }) =>
    (t.tags ?? []).reduce((s, x) => s + (targets.some(g => x.includes(g) || g.includes(x)) ? 1 : 0), 0)

  const seen = new Set<string>()
  const tracks: OutTrack[] = rows
    .filter(t => (seen.has(t.id) ? false : seen.add(t.id)))
    .map(t => ({ t, s: vibe(t) }))
    .sort((a, b) => b.s - a.s)                                     // best vibe-overlap first; stable keeps popularity order within a tie
    .slice(0, 40)
    .map(({ t, s }) => ({ id: t.id, title: t.title, artist: t.artist, audio: t.audio, score: s || undefined }))
  return Response.json({ method: 'ai-search', tracks, interpretation: spec })
}
