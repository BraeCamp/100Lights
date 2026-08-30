'use client'
// ── Listening without the browser's help ────────────────────────────────────
//
// Brae: "It says that it isn't reaching Google's speech service."
//
// Chrome's SpeechRecognition streams audio to Google. When that is unreachable
// — a firewall, a VPN, a region, a Chromium build without the key — voice
// control does not work and nothing in this app can make it, because the
// dependency belongs to the browser.
//
// This is the other way in: record a few seconds with MediaRecorder, post the
// bytes to /api/voice/transcribe, get words back. Slower, since it cannot show
// the sentence as it is spoken, and it costs a fraction of a cent per command —
// but it works where the browser's own service does not, and it produces the
// SAME shape (a sentence plus alternatives plus a confidence), so everything
// downstream is untouched.
//
// Which path to use is remembered rather than rediscovered. A browser that
// cannot reach Google today will not reach it on the next command either, and
// making someone wait through twelve failing retries every single time is its
// own kind of broken.

const PREFER_KEY = 'beacon.voice.transcriber'

export type Transcriber = 'browser' | 'server'

/** Which path this browser should use. Defaults to the browser's own. */
export function preferredTranscriber(): Transcriber {
  try { return localStorage.getItem(PREFER_KEY) === 'server' ? 'server' : 'browser' } catch { return 'browser' }
}

/** Remember that the browser's recogniser does not work here. */
export function setPreferredTranscriber(t: Transcriber): void {
  try { localStorage.setItem(PREFER_KEY, t) } catch { /* private mode */ }
}

export interface Transcript {
  text: string
  alternatives: string[]
  confidence: number
}

export interface Recording {
  /**
   * Stop capturing and hand back what was said.
   *
   * A FAILURE returns its reason rather than null. The first version returned
   * null for everything, so a missing DEEPGRAM_API_KEY, a 502 and genuine
   * silence were indistinguishable — and the caller reported all three as "I
   * didn't catch that", which blames the speaker for a server problem and hides
   * the one message that would have explained it.
   */
  stop: () => Promise<{ ok: true; result: Transcript | null } | { ok: false; error: string }>
  /** Throw it away. */
  cancel: () => void
}

/** The first container this browser will actually produce. Safari and Chrome
 *  disagree, and an unsupported mimeType makes MediaRecorder throw at
 *  construction rather than fail later. */
function pickMime(): string | undefined {
  const wanted = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']
  for (const m of wanted) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(m)) return m
  }
  return undefined
}

/**
 * Start recording. Call `stop()` to transcribe what was captured.
 *
 * The microphone is released as soon as recording ends — a studio that leaves
 * the tab's recording indicator lit is one nobody trusts.
 */
export async function startRecording(): Promise<Recording | null> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return null
  if (typeof MediaRecorder === 'undefined') return null

  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      // Voice, not music: the browser's own cleanup helps a recogniser here,
      // where it would be wrong for anything being recorded INTO the song.
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    })
  } catch { return null }

  const mimeType = pickMime()
  let rec: MediaRecorder
  try {
    rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
  } catch {
    for (const t of stream.getTracks()) t.stop()
    return null
  }

  const chunks: BlobPart[] = []
  rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data) }
  rec.start()

  const release = () => { for (const t of stream.getTracks()) t.stop() }

  return {
    cancel: () => { try { rec.stop() } catch { /* already stopped */ } release() },
    stop: () => new Promise(resolve => {
      rec.onstop = async () => {
        release()
        const blob = new Blob(chunks, { type: mimeType || 'audio/webm' })
        // Nothing was said. Better to return null than to spend a request on
        // silence and get an empty transcript back.
        if (blob.size < 1200) { resolve({ ok: true, result: null }); return }
        try {
          const res = await fetch('/api/voice/transcribe', {
            method: 'POST',
            headers: { 'content-type': blob.type || 'audio/webm' },
            body: blob,
          })
          if (!res.ok) {
            const e = await res.json().catch(() => ({} as { error?: string }))
            throw new Error(e.error || `transcribe ${res.status}`)
          }
          const data = await res.json() as { text?: string; alternatives?: string[]; confidence?: number }
          resolve({
            ok: true,
            result: {
              text: (data.text ?? '').trim(),
              alternatives: data.alternatives ?? [],
              confidence: typeof data.confidence === 'number' ? data.confidence : 1,
            },
          })
        } catch (err) {
          const why = err instanceof Error ? err.message : String(err)
          void import('@/lib/diag-journal')
            .then(m => m.diag('audio', `server transcribe failed: ${why}`))
            .catch(() => {})
          resolve({ ok: false, error: why })
        }
      }
      try { rec.stop() } catch { release(); resolve({ ok: false, error: 'Recording stopped unexpectedly.' }) }
    }),
  }
}
