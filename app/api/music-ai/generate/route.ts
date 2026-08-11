import { auth } from '@clerk/nextjs/server'
import { CREDITS_ENABLED, meterAI, CREDIT_COSTS } from '@/lib/credits'
import { recordUsage } from '@/lib/api-usage'

export const runtime = 'nodejs'
export const maxDuration = 300

// AI music generation: ElevenLabs Music (model music_v2) turns a text prompt
// into a full song. We proxy the request server-side so ELEVENLABS_API_KEY
// never reaches the browser, then stream the upstream audio bytes back to the
// client, which imports them as an editable DAW track. Needs ELEVENLABS_API_KEY.

const MIN_MS = 3000
const MAX_MS = 600000
const DEFAULT_MS = 30000

export async function POST(req: Request) {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Sign in to generate music.' }, { status: 401 })
  const key = process.env.ELEVENLABS_API_KEY
  if (!key) return Response.json({ error: 'ELEVENLABS_API_KEY is not set.' }, { status: 501 })

  if (CREDITS_ENABLED) {
    const m = await meterAI(userId, CREDIT_COSTS.generateClip, 'AI music generation')
    if (!m.ok) return Response.json({ error: 'Not enough credits.', needCredits: true, balance: m.balance }, { status: 402 })
  }

  let body: { prompt?: string; lengthMs?: number; instrumental?: boolean }
  try { body = await req.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const prompt = (body.prompt ?? '').trim()
  if (!prompt) return Response.json({ error: 'Enter a prompt describing the music.' }, { status: 400 })

  const rawLen = Number(body.lengthMs)
  const lengthMs = Number.isFinite(rawLen)
    ? Math.max(MIN_MS, Math.min(MAX_MS, Math.round(rawLen)))
    : DEFAULT_MS

  const payload: Record<string, unknown> = {
    prompt,
    model_id: 'music_v2',
    music_length_ms: lengthMs,
  }
  if (body.instrumental === true) payload.force_instrumental = true

  const res = await fetch('https://api.elevenlabs.io/v1/music', {
    method: 'POST',
    headers: { 'xi-api-key': key, 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(290_000),
  }).catch(() => null)

  if (!res) return Response.json({ error: 'Could not reach the music service.' }, { status: 502 })
  if (!res.ok) {
    const msg = (await res.text().catch(() => '')).slice(0, 300)
    return Response.json({ error: `Music generation error ${res.status}: ${msg}` }, { status: 502 })
  }

  const contentType = res.headers.get('content-type') || 'audio/mpeg'
  recordUsage({ userId, provider: 'elevenlabs', operation: 'music-gen', units: lengthMs / 1000, unitType: 'seconds',
    metadata: { model: 'music_v2', lengthMs, instrumental: body.instrumental, credits: res.headers.get('x-credits-used') || res.headers.get('character-cost') || undefined } })
  return new Response(res.body, { headers: { 'content-type': contentType } })
}
