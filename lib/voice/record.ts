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

import { newVad, vadStep } from './vad'

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
  /**
   * Is the transport running?
   *
   * Changes almost everything about how the microphone is opened, because a
   * studio that is playing is a different acoustic situation AND a different
   * risk: the monitor path must not be touched.
   */
  playing?: boolean
  /**
   * The studio's own sample rate.
   *
   * A second AudioContext at a different rate can make the browser renegotiate
   * the output device mid-playback, which is heard as a glitch. Matching the
   * engine costs nothing and removes the possibility.
   */
  sampleRate?: number
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

// The longest a single command may run before it ends itself.
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

  // ── What opening the microphone does to the SPEAKERS ─────────────────────
  //
  // Brae: "when I hit voice control during playback, the audio starts becoming
  // staticy. It loads fine, just bad static."
  //
  // Asking for echoCancellation is not a request about the microphone. On macOS
  // it switches the whole device into the system's voice-processing mode, and
  // that mode owns the OUTPUT as well — it resamples, ducks and filters
  // everything the browser plays so a voice call sounds clean. In a phone call
  // that is the entire point. Over a mix it is heard as static, and it arrives
  // the instant the mic opens, which is exactly what he described.
  //
  // Nothing about a microphone is worth degrading the monitor path in a studio,
  // so while the transport runs the microphone is opened RAW. The cost is that
  // the mix ends up in the recording, and that cost is paid where it can be
  // paid — a gentler speech threshold below, and a transcriber that is good at
  // finding words in a noisy clip.
  const voiceProcessed: MediaTrackConstraints = {
    echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1,
  }
  const raw: MediaTrackConstraints = {
    echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1,
  }
  const base = o.playing ? raw : voiceProcessed

  let stream: MediaStream | null = null
  try {
    // voiceIsolation targets background SPEECH, which is exactly the case
    // noiseSuppression cannot help with — and it is part of the same
    // voice-processing mode, so it is only asked for when nothing is playing.
    stream = await navigator.mediaDevices.getUserMedia({
      audio: o.playing ? raw : ({ ...base, voiceIsolation: true } as MediaTrackConstraints),
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
    // Matched to the engine, so opening this cannot make the browser
    // renegotiate the output device in the middle of a bar.
    ctx = new AudioContext(o.sampleRate
      ? { sampleRate: o.sampleRate, latencyHint: 'interactive' }
      : { latencyHint: 'interactive' })
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

  let vad = newVad()
  let heardSpeech = false
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

      const now = Date.now()
      const step = vadStep(vad, rms, now, { playing: o.playing })
      vad = step.state
      if (step.speaking && !heardSpeech) { heardSpeech = true; o.onSpeechStart?.() }
      if (step.ended) {
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
        //
        // Not while the transport is running, though. Over a mix the meter is a
        // much weaker witness — this is the check that turned "I spoke and it
        // did not hear me" into a confident refusal to even look — so when
        // there is music in the room the clip goes to the transcriber and the
        // transcriber decides.
        if (analyser && !heardSpeech && !o.playing) { resolve({ ok: true, result: null }); return }
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
