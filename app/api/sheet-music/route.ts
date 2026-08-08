import { auth } from '@clerk/nextjs/server'

export const runtime = 'nodejs'
export const maxDuration = 120

// AI sheet-music transcription: Claude (vision) reads an uploaded score image or
// PDF and returns notes in quarter-note beats — the same shape the MIDI/MusicXML
// importers produce. Not exact OMR, but it turns a photo/scan into an editable
// pattern with no separate recognition engine. Needs ANTHROPIC_API_KEY.

const MODEL = 'claude-sonnet-5'

const SYSTEM = `You are an expert at reading standard music notation (and reasonable at handwritten scores). Transcribe the sheet music in the image/PDF into machine-readable notes.

Rules:
- Read pitches, octaves, accidentals (incl. key signature), note/rest durations, dots, ties, and chords.
- Times are in QUARTER-NOTE BEATS from the start of the excerpt: a quarter note = 1.0, eighth = 0.5, half = 2.0, dotted-quarter = 1.5, etc. Measures accumulate (bar 2 of 4/4 starts at beat 4).
- Rests advance the time but produce no note. Chord/stacked notes share the same "start". Tied notes become ONE note whose "dur" is the sum.
- pitch is a MIDI number (middle C = 60).
- Transcribe ALL staves/voices you can read; merge them into one note list.

Reply with ONLY a JSON object, no prose, no code fence:
{"tempo": <bpm or null>, "notes": [{"pitch": <int>, "start": <beats>, "dur": <beats>}, ...]}`

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

  // PDFs go in a `document` block; images in an `image` block.
  const isPdf = mediaType === 'application/pdf'
  const source = { type: 'base64', media_type: mediaType, data }
  const contentBlock = isPdf ? { type: 'document', source } : { type: 'image', source }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 8000,
      system: SYSTEM,
      messages: [{ role: 'user', content: [contentBlock, { type: 'text', text: 'Transcribe this sheet music.' }] }],
    }),
    signal: AbortSignal.timeout(110_000),
  }).catch(() => null)

  if (!res) return Response.json({ error: 'Could not reach the transcription service.' }, { status: 502 })
  if (!res.ok) return Response.json({ error: `Transcription error ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}` }, { status: 502 })

  const out = await res.json() as { content?: Array<{ type: string; text?: string }> }
  const text = (out.content ?? []).filter(c => c.type === 'text').map(c => c.text ?? '').join('\n')
  const json = (text.match(/\{[\s\S]*\}/) || [])[0]
  if (!json) return Response.json({ error: 'No notes recognized. Try a clearer, higher-contrast image.' }, { status: 422 })
  let parsed: { tempo?: number | null; notes?: Array<{ pitch: number; start: number; dur: number }> }
  try { parsed = JSON.parse(json) } catch { return Response.json({ error: 'Transcription returned malformed data.' }, { status: 422 }) }

  const notes = (parsed.notes ?? [])
    .filter(n => Number.isFinite(n.pitch) && Number.isFinite(n.start) && Number.isFinite(n.dur))
    .map(n => ({
      pitch: Math.max(0, Math.min(127, Math.round(n.pitch))),
      startBeat: +Math.max(0, n.start).toFixed(4),
      durationBeats: +Math.max(0.05, n.dur).toFixed(4),
      velocity: 90,
    }))
    .sort((a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch)
  if (!notes.length) return Response.json({ error: 'No notes recognized in the image.' }, { status: 422 })

  return Response.json({ notes, tempo: parsed.tempo ?? undefined, name: 'Sheet music' })
}
