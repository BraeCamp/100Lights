'use client'
// ── Capturing one spoken command, cleanly ───────────────────────────────────
//
// Brae: "It can't hear what I'm saying very well while there's conversations in
// the background... take some time optimizing and fixing audio detection, noise
// cancelling, and how it listens to phrases."
//
// Background SPEECH is the hardest interference there is, because it is signal
// by every measure a recogniser uses — it cannot be removed the way a hum or a
// fan can. So nothing here pretends to remove it. It takes every cheap
// advantage that makes the near voice easier to pick out instead:
//
//   VOICE ISOLATION. The platform can separate the near speaker from other
//   speech, and on macOS Chrome this is the same machinery as the system mic
//   mode. Asked for separately, with a fallback, because an unsupported
//   constraint throws rather than being ignored.
//
//   MONO, AND ROLLED OFF BELOW SPEECH. One channel of the near voice beats two
//   of the room, and everything under ~85 Hz is rumble, desk knocks and room —
//   none of it carries a word.
//
//   RECORD ONLY WHILE SOMEBODY IS TALKING. The first version captured from
//   press to release, so a pause at either end shipped seconds of the room to a
//   recogniser and asked it to find a command in there. It watches the level
//   now, ends shortly after speech stops, and refuses to send a clip that never
//   contained any — which also stops paying to be told there were no words.
//
//   SAY WHAT IT HEARS. The level is reported continuously so the button can
//   show it. "Is it even hearing me" is the first question when this goes
//   wrong, and it should not take a support round trip to answer.
//
// This is also why the transcriber is told the project's vocabulary (see the
// route): in a noisy room the decision between "mute" and "moot" is much easier
// when the likely words are known.

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
  /** Per-word confidence, when the recogniser reports it. What the interpreter
   *  uses to decide WHICH words are worth reconsidering. */
  words?: { word: string; confidence: number }[]
  confidence: number
}

export interface Recording {
  /**
   * Stop capturing and hand back what was said.
   *
   * A FAILURE returns its reason rather than null. Returning null for
   * everything made a missing DEEPGRAM_API_KEY, a 502 and genuine silence
   * indistinguishable, and the caller reported all three as "I didn't catch
   * that" — blaming the speaker for a server problem.
   */
  stop: () => Promise<{ ok: true; result: Transcript | null } | { ok: false; error: string }>
  /** Throw it away. */
  cancel: () => void
}

export interface RecordOptions {
  /** Words likely in this project — commands and track names. */
  vocabulary?: string[]
  /** Called ~20x a second with 0–1 loudness, for a level meter. */
  onLevel?: (level: number) => void
  /** Fires once when speech is first detected. */
  onSpeechStart?: () => void
  /** Fires when speech has stopped long enough that the take ends itself. */
  onSilence?: () => void
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

// ── Deciding whether anyone is talking ──────────────────────────────────────
//
// Adaptive rather than a fixed number, because a threshold that works in a
// quiet room mutes someone in a loud one and vice versa. The floor is learned
// from the first half-second — whatever this room happens to sound like — and
// speech is anything comfortably above it, with an absolute minimum so that a
// silent room cannot trigger on its own hiss.
const SPEECH_OVER_FLOOR = 2.5
const MIN_SPEECH_LEVEL = 0.012
const SILENCE_MS = 1100
const MAX_MS = 15_000

/**
 * Start recording. Call `stop()` to transcribe, or let it end itself once the
 * speaker stops.
 *
 * The microphone is released the moment recording ends — a studio that leaves
 * the tab's recording indicator lit is one nobody trusts.
 */
export async function startRecording(opts: RecordOptions | string[] = {}): Promise<Recording | null> {
  const o: RecordOptions = Array.isArray(opts) ? { vocabulary: opts } : opts
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return null
  if (typeof MediaRecorder === 'undefined') return null

  const base: MediaTrackConstraints = {
    echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1,
  }
  let stream: MediaStream | null = null
  try {
    // voiceIsolation targets background SPEECH, which is exactly the case
    // noiseSuppression cannot help with.
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { ...base, voiceIsolation: true } as MediaTrackConstraints,
    })
  } catch {
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: base }) } catch { return null }
  }
  if (!stream) return null

  // ── Clean it before it is recorded ────────────────────────────────────────
  // High-pass below the voice removes rumble and handling noise without
  // touching a word. A gentle compressor evens out how close the speaker is to
  // the microphone, which matters more than it sounds when a recogniser is
  // choosing between a quiet real word and a loud background one.
  let ctx: AudioContext | null = null
  let processed: MediaStream = stream
  let analyser: AnalyserNode | null = null
  try {
    ctx = new AudioContext()
    const src = ctx.createMediaStreamSource(stream)
    const hp = ctx.createBiquadFilter()
    hp.type = 'highpass'; hp.frequency.value = 85; hp.Q.value = 0.7
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -30; comp.knee.value = 12; comp.ratio.value = 3
    comp.attack.value = 0.005; comp.release.value = 0.2
    analyser = ctx.createAnalyser()
    analyser.fftSize = 1024
    const dest = ctx.createMediaStreamDestination()
    src.connect(hp); hp.connect(comp); comp.connect(analyser); analyser.connect(dest)
    processed = dest.stream
  } catch {
    // No processing available — record the raw stream rather than nothing.
    ctx = null; analyser = null; processed = stream
  }

  const mimeType = pickMime()
  let rec: MediaRecorder
  try {
    rec = new MediaRecorder(processed, mimeType ? { mimeType } : undefined)
  } catch {
    for (const t of stream.getTracks()) t.stop()
    void ctx?.close()
    return null
  }

  const chunks: BlobPart[] = []
  rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data) }
  rec.start()

  let heardSpeech = false
  let lastLoudAt = 0
  let floor = 0
  let floorSamples = 0
  let watcher: ReturnType<typeof setInterval> | null = null
  const startedAt = Date.now()
  let autoStop: (() => void) | null = null

  if (analyser) {
    const buf = new Float32Array(analyser.fftSize)
    watcher = setInterval(() => {
      analyser.getFloatTimeDomainData(buf)
      let sum = 0
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
      const rms = Math.sqrt(sum / buf.length)
      o.onLevel?.(Math.min(1, rms * 8))

      // The first half-second is taken as the room, whatever the room is.
      if (floorSamples < 10) {
        floor = (floor * floorSamples + rms) / (floorSamples + 1)
        floorSamples++
        return
      }

      const threshold = Math.max(MIN_SPEECH_LEVEL, floor * SPEECH_OVER_FLOOR)
      const now = Date.now()
      if (rms > threshold) {
        if (!heardSpeech) { heardSpeech = true; o.onSpeechStart?.() }
        lastLoudAt = now
      } else if (heardSpeech && now - lastLoudAt > SILENCE_MS) {
        // Finished talking. Ending here rather than on release keeps the
        // trailing room — and whoever is talking in it — out of the clip.
        o.onSilence?.()
        autoStop?.()
      }
      if (now - startedAt > MAX_MS) autoStop?.()
    }, 50)
  }

  const release = () => {
    if (watcher) { clearInterval(watcher); watcher = null }
    for (const t of stream.getTracks()) t.stop()
    void ctx?.close()
  }

  const finish = (): Promise<{ ok: true; result: Transcript | null } | { ok: false; error: string }> =>
    new Promise(resolve => {
      rec.onstop = async () => {
        release()
        const blob = new Blob(chunks, { type: mimeType || 'audio/webm' })
        if (blob.size < 1200) { resolve({ ok: true, result: null }); return }
        // Nothing ever rose above the room. Sending it means paying to be told
        // there were no words in it, and then telling the speaker they mumbled.
        if (analyser && !heardSpeech) { resolve({ ok: true, result: null }); return }
        try {
          // The words likely in THIS project, as a hint to the recogniser.
          const qs = new URLSearchParams()
          for (const term of (o.vocabulary ?? []).slice(0, 40)) if (term.trim()) qs.append('kt', term.trim())
          const res = await fetch(`/api/voice/transcribe${qs.toString() ? `?${qs}` : ''}`, {
            method: 'POST',
            headers: { 'content-type': blob.type || 'audio/webm' },
            body: blob,
          })
          if (!res.ok) {
            const e = await res.json().catch(() => ({} as { error?: string }))
            throw new Error(e.error || `transcribe ${res.status}`)
          }
          const data = await res.json() as {
            text?: string
            alternatives?: string[]
            words?: { word: string; confidence: number }[]
            confidence?: number
          }
          resolve({
            ok: true,
            result: {
              text: (data.text ?? '').trim(),
              alternatives: data.alternatives ?? [],
              words: data.words ?? [],
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
    })

  // One promise, whether the caller stopped it or the silence did.
  let pending: ReturnType<typeof finish> | null = null
  const stopOnce = () => (pending ??= finish())
  autoStop = () => { void stopOnce() }

  return {
    cancel: () => { try { rec.stop() } catch { /* already stopped */ } release() },
    stop: stopOnce,
  }
}
