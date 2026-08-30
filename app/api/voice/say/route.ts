import { auth } from '@clerk/nextjs/server'
import { objectExists, putObject } from '@/lib/r2'
import { recordUsage } from '@/lib/api-usage'
import {
  voiceKey, looksSpeakable, normaliseSpoken, MISS_BUDGET_PER_DAY,
} from '@/lib/voice/voice-cache'

export const runtime = 'nodejs'
export const maxDuration = 30

// ── The studio's voice, bought once ─────────────────────────────────────────
//
// Brae: "Can't we record the response and just play it off of our system so that
// we aren't paying at all after one person uses something once?"
//
// So: a phrase is rendered by whoever says it first, stored under a hash of its
// own text, and served from storage to everybody afterwards. Two people muting a
// track called Drums produce the same bytes and get the same file without
// anything having to know they are related.
//
// A HIT costs nothing and is the overwhelmingly common case. A MISS costs a few
// hundredths of a cent and happens once per distinct sentence in the product's
// lifetime.
//
// Every failure here falls back to the browser's own voice on the client, so
// this route is allowed to say no cheaply and often.

const VOICE_ID = process.env.ELEVENLABS_VOICE_ID || 'EXAVITQu4vr4xnSDxMaL'
const MODEL = 'eleven_turbo_v2_5'

/** Misses per account per day, in memory. Restarting resets it, which is fine:
 *  this bounds a runaway, it is not an accounting record. */
const misses = new Map<string, { day: string; n: number }>()
function spendMiss(userId: string): boolean {
  const day = new Date().toISOString().slice(0, 10)
  const seen = misses.get(userId)
  const now = seen && seen.day === day ? seen : { day, n: 0 }
  if (now.n >= MISS_BUDGET_PER_DAY) return false
  now.n++
  misses.set(userId, now)
  return true
}

export async function POST(req: Request) {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Sign in for the studio voice.' }, { status: 401 })

  let body: { text?: string }
  try { body = await req.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const text = String(body.text ?? '').trim()
  if (!looksSpeakable(text)) return Response.json({ error: 'Not a read-back.' }, { status: 400 })

  const key = voiceKey(text, VOICE_ID)
  const base = process.env.R2_PUBLIC_BASE
  if (!base) return Response.json({ error: 'Voice storage is not configured.' }, { status: 501 })
  const url = `${base.replace(/\/$/, '')}/${key}`

  // ── The common case: somebody has already paid for this sentence ─────────
  if (await objectExists(key)) {
    return Response.json({ url, cached: true })
  }

  const apiKey = process.env.ELEVENLABS_API_KEY
  if (!apiKey) return Response.json({ error: 'The studio voice is not configured.' }, { status: 501 })
  if (!spendMiss(userId)) {
    return Response.json({ error: 'Too many new phrases today.' }, { status: 429 })
  }

  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}?output_format=mp3_44100_64`,
    {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({
        text,
        model_id: MODEL,
        // Steady rather than expressive. This is a studio reading back what it
        // just did, over and over — a performance would wear out fast, and the
        // same words have to sound the same every time or the cache becomes
        // audible as inconsistency.
        voice_settings: { stability: 0.55, similarity_boost: 0.75, style: 0, use_speaker_boost: false },
      }),
      signal: AbortSignal.timeout(20_000),
    },
  ).catch(() => null)

  if (!res || !res.ok) {
    const detail = res ? (await res.text().catch(() => '')).slice(0, 200) : 'unreachable'
    return Response.json({ error: `The voice service failed. ${detail}` }, { status: 502 })
  }

  const audio = new Uint8Array(await res.arrayBuffer())
  if (!audio.length) return Response.json({ error: 'The voice service returned nothing.' }, { status: 502 })

  try {
    await putObject(key, audio, 'audio/mpeg')
  } catch {
    // Storing failed, so the next person pays again — but this person still
    // gets their audio. Returning the bytes rather than an error means a
    // storage fault degrades the economics, not the feature.
    return new Response(audio, {
      headers: { 'content-type': 'audio/mpeg', 'cache-control': 'private, max-age=3600' },
    })
  }

  // Billed to nobody. The point of the cache is that this is a one-off for the
  // product, so it is recorded as a product cost rather than charged to whoever
  // happened to say a new sentence first.
  recordUsage({
    userId, provider: 'elevenlabs', operation: 'voice-readback', unitType: 'characters',
    units: normaliseSpoken(text).length,
    // ~$0.20 per 1,000 characters at the tiers this account uses. The estimate
    // exists so the admin view can total it; the real bill comes from the
    // provider.
    costUsd: +((normaliseSpoken(text).length / 1000) * 0.20).toFixed(5),
    metadata: { model: MODEL, voice: VOICE_ID, key, chars: text.length },
  })

  return Response.json({ url, cached: false })
}
