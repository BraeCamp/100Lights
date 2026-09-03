import { auth } from '@clerk/nextjs/server'
import { CREDITS_ENABLED, meterAI, CREDIT_COSTS, grantCredits } from '@/lib/credits'
import { cacheKey, getCached, putCached } from '@/lib/ai-cache'
import { recordUsage } from '@/lib/api-usage'
import { LUMENS_NAME } from '@/lib/credit-tiers'

export const runtime = 'nodejs'
export const maxDuration = 120

// AI sheet-music transcription: Claude (vision) reads an uploaded score image or
// PDF and returns notes in quarter-note beats — the same shape the MIDI/MusicXML
// importers produce. Not exact OMR, but it turns a photo/scan into an editable
// pattern with no separate recognition engine. Needs ANTHROPIC_API_KEY.

const MODEL = 'claude-sonnet-5'

// Compact output = fewer tokens for the same notes: each note is a bare [pitch, startBeat, durBeats]
// triple instead of a verbose object (~half the output tokens per note).
const SYSTEM = `Transcribe the sheet music (printed or handwritten) into notes.
Rules: read pitch (MIDI number, middle C=60), octave, accidentals incl. key signature, durations, dots, ties, chords. Times are QUARTER-NOTE BEATS from the start (quarter=1, eighth=0.5, half=2, dotted-quarter=1.5); measures accumulate. Rests advance time but emit nothing. Chord notes share a start; tied notes merge into one (durations summed). Merge all staves/voices into one list.
Reply with ONLY this JSON (no prose, no code fence). Each note is [pitch, startBeat, durBeats]:
{"tempo": <bpm or null>, "notes": [[<int>, <beats>, <beats>], ...]}`

export async function POST(req: Request) {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Sign in to use sheet-music transcription.' }, { status: 401 })
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return Response.json({ error: 'ANTHROPIC_API_KEY is not set.' }, { status: 501 })

  let body: { data?: string; mediaType?: string }
  try { body = await req.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const data = body.data?.replace(/^data:[^;]+;base64,/, '')   // tolerate a data: URL
  const mediaType = body.mediaType || 'image/png'
  if (!data) return Response.json({ error: 'No image data' }, { status: 400 })
  if (data.length > 8_000_000) return Response.json({ error: 'File too large (max ~6MB).' }, { status: 413 })

  // Deterministic-AI cache: the same score always transcribes to the same notes, so a repeat upload
  // (public-domain pieces, a retry, a test) returns instantly and costs $0 — no model call, no credits.
  // Version pins the cache to this model + output format so a logic change invalidates stale answers.
  const cacheHash = cacheKey('sheet-music', data, `${MODEL}-triples`)
  const cached = await getCached<{ notes: unknown[]; tempo?: number; name: string }>(cacheHash)
  if (cached) return Response.json({ ...cached, cached: true })

  // Meter credits (no-op until CREDITS_ENABLED — see lib/credits.ts). Skipped on a cache hit above.
  // Refund if the transcription fails or recognizes nothing usable — the user shouldn't pay for a blank result.
  let charged = 0
  if (CREDITS_ENABLED) {
    const m = await meterAI(userId, CREDIT_COSTS.visionPage, 'sheet-music vision')
    if (!m.ok) return Response.json({ error: `Out of ${LUMENS_NAME} for transcription.`, needCredits: true, balance: m.balance }, { status: 402 })
    if (!m.usedFree) charged = CREDIT_COSTS.visionPage
  }
  const refundOnFail = async () => { if (charged) await grantCredits(userId, charged, 'refund: sheet-music transcription failed') }

  // PDFs go in a `document` block; images in an `image` block.
  const isPdf = mediaType === 'application/pdf'
  const source = { type: 'base64', media_type: mediaType, data }
  const contentBlock = isPdf ? { type: 'document', source } : { type: 'image', source }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4000,   // compact triples fit far more notes per token; ample even for dense scores
      system: SYSTEM,
      messages: [{ role: 'user', content: [contentBlock, { type: 'text', text: 'Transcribe this sheet music.' }] }],
    }),
    signal: AbortSignal.timeout(110_000),
  }).catch(() => null)

  if (!res) { await refundOnFail(); return Response.json({ error: 'Could not reach the transcription service.' }, { status: 502 }) }
  if (!res.ok) { await refundOnFail(); return Response.json({ error: `Transcription error ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}` }, { status: 502 }) }

  const out = await res.json() as { content?: Array<{ type: string; text?: string }>; usage?: { input_tokens?: number; output_tokens?: number } }
  recordUsage({ userId, provider: 'anthropic', operation: 'vision', unitType: 'tokens',
    inputTokens: out.usage?.input_tokens, outputTokens: out.usage?.output_tokens,
    units: (out.usage?.input_tokens ?? 0) + (out.usage?.output_tokens ?? 0), metadata: { model: MODEL, feature: 'sheet-music' } })
  const text = (out.content ?? []).filter(c => c.type === 'text').map(c => c.text ?? '').join('\n')
  const json = (text.match(/\{[\s\S]*\}/) || [])[0]
  if (!json) { await refundOnFail(); return Response.json({ error: 'No notes recognized. Try a clearer, higher-contrast image.' }, { status: 422 }) }
  let parsed: { tempo?: number | null; notes?: unknown[] }
  try { parsed = JSON.parse(json) } catch { await refundOnFail(); return Response.json({ error: 'Transcription returned malformed data.' }, { status: 422 }) }

  // Accept the compact [pitch, start, dur] triples (and legacy {pitch,start,dur} objects, just in case).
  const triple = (n: unknown): [number, number, number] | null => {
    if (Array.isArray(n)) return [Number(n[0]), Number(n[1]), Number(n[2])]
    if (n && typeof n === 'object') { const o = n as { pitch?: number; start?: number; dur?: number }; return [Number(o.pitch), Number(o.start), Number(o.dur)] }
    return null
  }
  const notes = (parsed.notes ?? [])
    .map(triple)
    .filter((t): t is [number, number, number] => !!t && t.every(Number.isFinite))
    .map(([pitch, start, dur]) => ({
      pitch: Math.max(0, Math.min(127, Math.round(pitch))),
      startBeat: +Math.max(0, start).toFixed(4),
      durationBeats: +Math.max(0.05, dur).toFixed(4),
      velocity: 90,
    }))
    .sort((a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch)
  if (!notes.length) { await refundOnFail(); return Response.json({ error: 'No notes recognized in the image.' }, { status: 422 }) }

  const result = { notes, tempo: parsed.tempo ?? undefined, name: 'Sheet music' }
  await putCached(cacheHash, 'sheet-music', result)   // next identical upload is free
  return Response.json(result)
}
