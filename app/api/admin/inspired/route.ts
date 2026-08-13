// "Find music inspired by ___" for the radio admin. Picks the best available method:
//   • audio-embeddings — if the catalogue is embedded (scripts/embed-jamendo.mjs) AND Replicate has
//     credit: embed the prompt (ImageBind text→same space as audio) and return the nearest tracks.
//   • ai-search — otherwise: Claude maps the prompt to Jamendo tags/name, then we search the API.
import { isAdmin } from '@/lib/admin-auth'
import { jamendoSearch } from '@/lib/jamendo'
import { embedText } from '@/lib/audio-embed'
import { embeddingCount, nearest } from '@/lib/track-embeddings'

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

  // 1) True audio similarity, if the catalogue is embedded and Replicate has credit.
  if (await embeddingCount() > 0) {
    const { vector } = await embedText(prompt)
    if (vector) {
      const rows = await nearest(vector, 40)
      const tracks: OutTrack[] = rows.map(r => ({ id: r.id, title: r.title, artist: r.artist, audio: r.audio, score: Math.round(r.score * 100) / 100 }))
      return Response.json({ method: 'audio-embeddings', tracks, note: `Nearest ${tracks.length} tracks by sound.` })
    }
  }

  // 2) AI-interpreted catalogue search (works now, no embeddings needed).
  const spec = await interpret(prompt)
  let rows = spec.tags ? await jamendoSearch({ tags: spec.tags, limit: 60 }) : []
  if (rows.length < 8 && spec.name) rows = [...rows, ...await jamendoSearch({ name: spec.name, limit: 30 })]
  const seen = new Set<string>()
  const tracks: OutTrack[] = rows.filter(t => (seen.has(t.id) ? false : seen.add(t.id))).slice(0, 40)
    .map(t => ({ id: t.id, title: t.title, artist: t.artist, audio: t.audio }))
  return Response.json({ method: 'ai-search', tracks, interpretation: spec })
}
