import { putObject } from '@/lib/r2'
import { addCorrection, pcmBase64ToWav } from '@/lib/voice-corrections-db'

export const runtime = 'nodejs'
export const maxDuration = 30

// Public submit endpoint for the no-login VoiceMidi app's "Send to admin" button.
// A CorrectionRecord (see lib/voice-corrections.ts) is POSTed here; we store the
// take audio as a WAV in R2 and the structured signals as a row. NO AUTH — so it
// is capped (body size), rate-limited per IP, and shape-validated, and everything
// it accepts is moderatable/deletable by the admin. See the follow-up note in the
// task report for a stricter gate (submit token / admin cookie).

const MAX_BYTES = 6 * 1024 * 1024   // ~6 MB — a 5 s 16 kHz take + evidence fits well under this
const MAX_NOTES = 4000              // detected/corrected arrays: sane upper bound
const MAX_FRAMES = 200_000          // evidence per-frame arrays
const MAX_COMMENT = 4000

// ── In-memory per-IP token bucket (best-effort; resets on cold start) ────────────
const BUCKET_MAX = 12               // burst
const REFILL_PER_SEC = 12 / 60      // ~12 / minute sustained
const buckets = new Map<string, { tokens: number; last: number }>()
function allow(ip: string): boolean {
  const now = Date.now()
  const b = buckets.get(ip) ?? { tokens: BUCKET_MAX, last: now }
  b.tokens = Math.min(BUCKET_MAX, b.tokens + ((now - b.last) / 1000) * REFILL_PER_SEC)
  b.last = now
  if (b.tokens < 1) { buckets.set(ip, b); return false }
  b.tokens -= 1
  buckets.set(ip, b)
  // Opportunistic cleanup so the map can't grow unbounded.
  if (buckets.size > 5000) { for (const [k, v] of buckets) if (now - v.last > 600_000) buckets.delete(k) }
  return true
}

function clientIp(req: Request): string {
  const xf = req.headers.get('x-forwarded-for')
  if (xf) return xf.split(',')[0].trim()
  return req.headers.get('x-real-ip') || 'unknown'
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isNoteArr = (v: unknown): boolean =>
  Array.isArray(v) && v.length <= MAX_NOTES && v.every(n =>
    n && typeof n === 'object' && isNum((n as Record<string, unknown>).startSec) && isNum((n as Record<string, unknown>).midi))

export async function POST(req: Request) {
  const ip = clientIp(req)
  if (!allow(ip)) return Response.json({ error: 'Too many submissions — slow down' }, { status: 429 })

  // Size guard BEFORE parse: read the raw text and measure real bytes.
  const raw = await req.text().catch(() => '')
  if (Buffer.byteLength(raw, 'utf8') > MAX_BYTES) {
    return Response.json({ error: 'Payload too large (max 6 MB)' }, { status: 413 })
  }

  let body: Record<string, unknown>
  try { body = JSON.parse(raw) } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }
  if (!body || typeof body !== 'object') return Response.json({ error: 'Invalid body' }, { status: 400 })

  // ── Shape validation ───────────────────────────────────────────────
  const detected = body.detected, corrected = body.corrected
  if (!isNoteArr(detected) || !isNoteArr(corrected)) {
    return Response.json({ error: 'detected/corrected must be note arrays' }, { status: 400 })
  }
  const evidence = (body.evidence && typeof body.evidence === 'object') ? body.evidence as Record<string, unknown> : {}
  // Cap any evidence frame array so a hostile body can't bloat the row past reason.
  for (const k of Object.keys(evidence)) {
    const v = evidence[k]
    if (Array.isArray(v) && v.length > MAX_FRAMES) {
      return Response.json({ error: 'evidence arrays too large' }, { status: 413 })
    }
  }
  const diff = (body.diff && typeof body.diff === 'object') ? body.diff : {}
  const settings = (body.settings && typeof body.settings === 'object') ? body.settings : {}
  const audio = (body.audio && typeof body.audio === 'object') ? body.audio as Record<string, unknown> : {}
  const appVersion = typeof body.appVersion === 'string' ? body.appVersion.slice(0, 40) : ''
  const ts = isNum(body.ts) ? body.ts : Date.now()
  let comment = typeof body.comment === 'string' ? body.comment.slice(0, MAX_COMMENT) : ''
  comment = comment.trim()

  // Server-minted id — never trust the client's for the PK / R2 key.
  const id = crypto.randomUUID()

  // ── Store the take audio as a WAV in R2 (if the record carried PCM) ──
  let r2Key: string | null = null
  const pcmBase64 = typeof audio.pcmBase64 === 'string' ? audio.pcmBase64 : ''
  const sampleRate = isNum(audio.sampleRate) ? audio.sampleRate : 0
  const audioDur = isNum(audio.durSec) ? audio.durSec : null
  if (pcmBase64 && sampleRate > 0) {
    try {
      const wav = pcmBase64ToWav(pcmBase64, sampleRate)
      const key = `voice-corrections/${id}.wav`
      await putObject(key, wav, 'audio/wav')
      r2Key = key
    } catch { /* R2 down — keep the structured data, drop the audio */ }
  }

  try {
    await addCorrection({
      id, ts, appVersion,
      detected, corrected, diff, evidence,
      r2Key, audioSr: sampleRate || null, audioDur,
      settings, comment, status: 'new',
    })
  } catch (e) {
    // Fail soft like getFlags — a 5xx, not a crash. Don't leak internals.
    return Response.json({ error: 'Store unavailable', detail: e instanceof Error ? e.message : 'unknown' }, { status: 503 })
  }

  return Response.json({ ok: true, id })
}
