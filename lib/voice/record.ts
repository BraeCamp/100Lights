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

import { newVad, vadStep, worthSending } from './vad'

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

/**
 * What the microphone actually turned out to be.
 *
 * Asking for a raw input is a request, not a guarantee, and the difference
 * matters: some devices cannot give one. A headset that carries both the
 * microphone and the monitoring — anything Bluetooth, most obviously — switches
 * itself into a hands-free profile the moment an input opens, and everything it
 * plays drops to a narrow, grainy 16 kHz. No constraint can prevent that from a
 * browser, and it produces the same symptom as the bug above.
 *
 * So the granted settings are reported. It is the difference between "the studio
 * did something wrong" and "this headset cannot do both jobs at once", which are
 * fixed in completely different places.
 */
export interface MicReport {
  label: string
  /** What the input is actually running at. 16000 or 8000 means a call profile. */
  sampleRate: number | null
  echoCancellation: boolean | null
  /** True when the device looks like it has dropped into a call profile. */
  degraded: boolean
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
  stop: () => Promise<StopResult>
  /** Throw it away. */
  cancel: () => void
  /**
   * Stop listening to the room for a moment.
   *
   * Used while the studio is speaking. With the microphone held open across
   * commands it would otherwise hear its own read-back, transcribe it, and act
   * on it — and "Bass 2 muted" is a perfectly good command. Audio recorded
   * while muted is discarded rather than buffered.
   */
  setMuted: (muted: boolean) => void
  /** What the device actually gave us. */
  mic: MicReport
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
   * Only used when there is no context to borrow. A second AudioContext at a
   * different rate can make the browser renegotiate the output device
   * mid-playback, which is heard as a glitch.
   */
  sampleRate?: number
  /**
   * The studio's own AudioContext, to build the microphone graph inside.
   *
   * Strongly preferred over making another. A second context is a second output
   * stream on the same hardware, opened and closed underneath a session that is
   * now held open for minutes — two clients negotiating one device is a
   * standing invitation to the crackle this feature keeps producing. Borrowing
   * the engine's removes the question: one context, one device, one rate, by
   * construction.
   *
   * Nothing is ever connected to its destination, so the microphone cannot
   * reach the mix.
   */
  audioContext?: AudioContext
  /**
   * Called ~20x a second with the input level and the bar it is being judged
   * against, both 0–1.
   *
   * The threshold is reported because a meter without one cannot answer the
   * question people actually have: not "is it hearing something" but "is what
   * it hears loud enough to count". Seeing your voice cross the line and the
   * room not cross it is the only way to set the sensitivity for a particular
   * room, and no default can do that from here.
   */
  onLevel?: (level: number, threshold: number) => void
  /**
   * How hard it is to trigger while the microphone is held open.
   *
   * 1 is the default. Higher ignores more of the room and takes a firmer voice;
   * lower is quicker to respond and quicker to mistake a conversation for a
   * command. Exposed because the right value is a property of the room and the
   * microphone, not of the software.
   */
  sensitivity?: number
  /** Fires once when speech is first detected. */
  onSpeechStart?: () => void
  /** Fires when speech has stopped long enough that the take ends itself. */
  onSilence?: () => void
  /**
   * Keep the microphone open across several commands.
   *
   * Brae: "Can you set the voice command up to be able to execute commands
   * while still listening for more commands? ... This way the user can do
   * multiple things while only clicking Voice once."
   *
   * The obvious way to build this is to start a new recording after each
   * command, and it is wrong: re-opening a microphone renegotiates the audio
   * device, which is the very thing that was making playback crackle. So the
   * stream is opened ONCE and cut into utterances, and the device is never
   * touched again until the user is finished.
   */
  continuous?: boolean
  /** Each finished utterance, while continuous. */
  onUtterance?: (r: StopResult) => void
}

export type StopResult =
  | { ok: true; result: Transcript | null }
  | { ok: false; error: string }

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
 * How long a held-open microphone may record nothing before the clip is started
 * over.
 *
 * This was twelve seconds, and it was most of the delay Brae reported on
 * "stop". The clip holds everything since the last cut, so a command spoken
 * after a quiet minute arrived as twelve seconds of room with one word at the
 * end — uploaded in full, and transcribed in full, to find it.
 *
 * Two and a half seconds keeps a little pre-roll, so nothing is clipped off the
 * front of a word that begins just as the timer fires, while keeping what
 * crosses the network to about the length of the command itself.
 */
const IDLE_RESET_MS = 2_500

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
  // ── A held-open session is ALWAYS playing, eventually ────────────────────
  //
  // Brae: "While the voice toggle is on, it has a LOT of static. It sounds like
  // I'm washing rice in a sieve."
  //
  // This condition was read once, when the microphone opened, and that was fine
  // while a take lasted one command: the transport either was or was not running
  // for those two seconds. A toggled session outlives the condition entirely.
  // You click Voice with the transport stopped, so the processed microphone is
  // opened and the device drops into the system's voice-processing mode — and
  // then you press play, and everything you hear for the rest of the session is
  // coming through a mode designed for phone calls. It never recovers, because
  // the microphone never closes.
  //
  // So a session that is held open takes the raw microphone unconditionally.
  // There is no moment at which it is safe to assume no music will play.
  const wantsRaw = o.playing || o.continuous
  const base = wantsRaw ? raw : voiceProcessed

  let stream: MediaStream | null = null
  try {
    // voiceIsolation targets background SPEECH, which is exactly the case
    // noiseSuppression cannot help with — and it is part of the same
    // voice-processing mode, so it is only asked for when nothing can be
    // playing and the microphone is closing again in a moment.
    stream = await navigator.mediaDevices.getUserMedia({
      audio: wantsRaw ? raw : ({ ...base, voiceIsolation: true } as MediaTrackConstraints),
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
  /** Every node this added, so a borrowed context can be handed back clean. */
  const built: AudioNode[] = []
  let ctx: AudioContext | null = null
  // Borrowed contexts must NOT be closed when the take ends — the studio is
  // still using it to make sound.
  let ownsContext = false
  let processed: MediaStream = stream
  let analyser: AnalyserNode | null = null
  try {
    if (o.audioContext && o.audioContext.state !== 'closed') {
      ctx = o.audioContext
    } else {
      // Nothing to borrow. Matched to the engine's rate at least, so opening
      // this cannot make the browser renegotiate the device mid-bar.
      ctx = new AudioContext(o.sampleRate
        ? { sampleRate: o.sampleRate, latencyHint: 'interactive' }
        : { latencyHint: 'interactive' })
      ownsContext = true
    }
    const src = ctx.createMediaStreamSource(stream)
    const hp = ctx.createBiquadFilter()
    hp.type = 'highpass'; hp.frequency.value = 85; hp.Q.value = 0.7
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -30; comp.knee.value = 12; comp.ratio.value = 3
    comp.attack.value = 0.005; comp.release.value = 0.2
    analyser = ctx.createAnalyser()
    analyser.fftSize = 1024
    const dest = ctx.createMediaStreamDestination()
    // ── The analyser taps BEFORE the compressor ──────────────────────────
    //
    // Brae: "I think that it cuts off the quieter last part of my words because
    // of the sound limiter." He meant this compressor, and he was right about
    // it in a way I had not seen: the two things on this chain want opposite
    // signals.
    //
    // The compressor is here for the TRANSCRIBER, which does better on an even
    // level. But WebAudio's compressor has no makeup gain, so everything above
    // its threshold is pulled down and everything below it — the room — is left
    // exactly where it was. Speech at 0.11 over a 0.02 room came out near 0.05
    // over the same 0.02: a five-fold gap squeezed to two-and-a-half. The
    // detector's bar is a RATIO above the floor, and in a held-open session it
    // asks for about three and a half. So the very stage meant to make speech
    // easier to hear was flattening it under the bar.
    //
    // The recording still gets the compression. Only the judging is moved to
    // where the dynamics are still real.
    src.connect(hp)
    hp.connect(analyser)
    hp.connect(comp); comp.connect(dest)
    // Nothing reaches ctx.destination: the microphone is analysed and recorded,
    // never monitored. In a borrowed context that is the difference between a
    // voice command and a feedback loop through the speakers.
    built.push(src, hp, comp, analyser, dest)
    processed = dest.stream
  } catch {
    // No processing available — record the raw stream rather than nothing.
    ctx = null; analyser = null; ownsContext = false; processed = stream
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

  let chunks: BlobPart[] = []
  rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data) }
  rec.start()

  let muted = false

  let vad = newVad()
  let heardSpeech = false
  /**
   * The loudest sample in this segment.
   *
   * Kept so that whether audio is SENT can be decided separately from whether
   * the detector recognised it as speech. Those had been the same question, and
   * they are not: the detector is an RMS threshold, and the thing on the other
   * end of the wire is a speech recogniser. Deciding on this side that there
   * were no words in a recording — and throwing it away unheard — is the one
   * job we are least equipped to do.
   */
  let peakSeen = 0
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
      const now = Date.now()
      // While the studio is talking, the room is not evidence of anything.
      if (muted) return
      const step = vadStep(vad, rms, now, {
        playing: o.playing, continuous: o.continuous, sensitivity: o.sensitivity,
      })
      vad = step.state
      // Reported on the same scale as the level, so the meter can draw one
      // against the other.
      o.onLevel?.(Math.min(1, rms * 8), Math.min(1, step.threshold * 8))
      if (rms > peakSeen) peakSeen = rms
      if (step.speaking && !heardSpeech) { heardSpeech = true; o.onSpeechStart?.() }
      if (step.ended) {
        // Finished talking. Ending here rather than on release keeps the
        // trailing room — and whoever is talking in it — out of the clip.
        if (o.continuous) {
          // The UTTERANCE ended. The session did not.
          //
          // onSilence means "this take is over", which is only ever true for
          // push-to-talk — and firing it here did exactly what it says: the
          // caller closed the session after the first command, so the button
          // went dark while the microphone was still open, AND the closing
          // stop() transcribed the clip a second time, so every command ran
          // twice. One line, both symptoms.
          void cutUtterance()
        } else {
          o.onSilence?.()
          autoStop?.()
        }
        return
      }
      if (o.continuous) {
        // Nobody has said anything for a long time and the recorder has been
        // accumulating the room. Start it over so the next command is not
        // appended to two minutes of nothing.
        // Not while the level is up: somebody may be a hundred milliseconds into
        // a word that has not yet cleared the bar, and restarting here would cut
        // its beginning off.
        if (!heardSpeech && !vad.activeSince && now - segmentStartedAt > IDLE_RESET_MS) {
          // ── The other half of the volume gate ─────────────────────────────
          //
          // Brae: "I think we need to remove the volume gate and try it." And,
          // exactly: "It works for hard letters like 'check check', but not
          // 'start'."
          //
          // That is the shape of the whole bug. "Check" is two hard transients
          // that spike well over any bar; "start" opens on a sibilant and
          // closes on a softer t, and never spikes at all. The word was
          // recorded perfectly both times — and when the detector did not
          // recognise it, the take was never CUT, so it was never sent, so it
          // reached the idle reset and was thrown away unheard.
          //
          // Removing the veto on sending was not enough on its own, because
          // this is where audio the detector does not recognise actually dies.
          // So: if anything at all rose above the room, cut and send it. The
          // recogniser gets to decide whether there were words in it, which is
          // its job and not ours.
          if (worthSending(peakSeen, vad.floor)) void cutUtterance()
          else restartSegment()
        }
        return
      }
      if (now - startedAt > MAX_MS) autoStop?.()
    }, 50)
  }

  let segmentStartedAt = Date.now()

  /** Throw away what has been recorded and start a fresh clip on the same
   *  stream. The DEVICE is never reopened — only the recorder. */
  function restartSegment(): void {
    try { rec.stop() } catch { /* already stopped */ }
    chunks = []
    vad = newVad()
    heardSpeech = false
    peakSeen = 0
    segmentStartedAt = Date.now()
    try {
      rec = new MediaRecorder(processed, mimeType ? { mimeType } : undefined)
      rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data) }
      rec.start()
    } catch { /* the take is over; stop() will report it */ }
  }

  /**
   * End one utterance, transcribe it, and immediately start listening for the
   * next.
   *
   * The new recorder is started BEFORE the transcription is awaited, so the
   * gap between "finished talking" and "listening again" is a few
   * milliseconds rather than a network round trip. Somebody giving three
   * commands in a row should not have to wait for the first to come back.
   */
  async function cutUtterance(): Promise<void> {
    const finished = chunks
    // Anything that rose above the room at all is worth sending, whether or not
    // the detector called it speech.
    const hadSpeech = worthSending(peakSeen, vad.floor, heardSpeech)
    const type = mimeType || 'audio/webm'
    await new Promise<void>(resolve => {
      rec.onstop = () => resolve()
      try { rec.stop() } catch { resolve() }
    })
    chunks = []
    vad = newVad()
    heardSpeech = false
    const wasPeak = peakSeen
    peakSeen = 0
    void wasPeak
    segmentStartedAt = Date.now()
    try {
      rec = new MediaRecorder(processed, mimeType ? { mimeType } : undefined)
      rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data) }
      rec.start()
    } catch { /* cannot continue; the caller's stop() will notice */ }

    // ── The detector does not get a veto ────────────────────────────────
    //
    // Brae, three rounds into this: "I calibrated and it still can't hear me."
    // The key was valid, the endpoint was answering, and the audio never left
    // the browser — because this line asked an RMS threshold whether there were
    // any words in the recording, and threw the recording away when it said no.
    //
    // That is the one judgement we are worst placed to make. On the other end of
    // the wire is a speech recogniser; on this end is a number compared against
    // a moving average. The detector's real job is deciding WHEN to cut, and it
    // is good at that. Whether a clip contains words is not its business.
    //
    // So the bar for sending is now "did anything at all rise above the room",
    // and being wrong costs one transcription that comes back empty — against
    // the alternative, which is somebody saying "play" nine times.
    if (!hadSpeech && !o.playing) return
    const blob = new Blob(finished, { type })
    if (blob.size < 1200) return
    o.onUtterance?.(await transcribe(blob))
  }

  const release = () => {
    if (watcher) { clearInterval(watcher); watcher = null }
    for (const t of stream.getTracks()) t.stop()
    // Disconnect what was added either way; only close what was created here.
    for (const node of built) { try { node.disconnect() } catch { /* already gone */ } }
    built.length = 0
    if (ownsContext) void ctx?.close()
  }

  /** Send one clip and read the answer. Shared by both modes, so a fix to one
   *  is a fix to the other. */
  async function transcribe(blob: Blob): Promise<StopResult> {
    try {
      // The words likely in THIS project, as a hint to the recogniser.
      const qs = new URLSearchParams()
      // Raised from 40. The list is now built from what the rules actually
      // react to rather than from the example phrasings, and forty was cutting
      // it off long before the words that matter — the caller sorts it so the
      // most valuable hints survive any cap at all.
      for (const term of (o.vocabulary ?? []).slice(0, 100)) if (term.trim()) qs.append('kt', term.trim())
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
      return {
        ok: true,
        result: {
          text: (data.text ?? '').trim(),
          alternatives: data.alternatives ?? [],
          words: data.words ?? [],
          confidence: typeof data.confidence === 'number' ? data.confidence : 1,
        },
      }
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err)
      void import('@/lib/diag-journal')
        .then(m => m.diag('audio', `server transcribe failed: ${why}`))
        .catch(() => {})
      return { ok: false, error: why }
    }
  }

  const finish = (): Promise<StopResult> =>
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
        // Same rule as the continuous path: rose above the room at all, send
        // it. Somebody who held the button down and spoke has already told us
        // there is something here, which is better evidence than the meter.
        if (analyser && !worthSending(peakSeen, vad.floor, heardSpeech) && !o.playing) {
          resolve({ ok: true, result: null }); return
        }
        resolve(await transcribe(blob))
      }
      try { rec.stop() } catch { release(); resolve({ ok: false, error: 'Recording stopped unexpectedly.' }) }
    })

  // One promise, whether the caller stopped it or the silence did.
  let pending: ReturnType<typeof finish> | null = null
  const stopOnce = () => (pending ??= finish())
  autoStop = () => { void stopOnce() }

  const track0 = stream.getAudioTracks()[0]
  const granted = track0?.getSettings?.() ?? {}
  const grantedRate = typeof granted.sampleRate === 'number' ? granted.sampleRate : null
  const mic: MicReport = {
    label: track0?.label ?? '',
    sampleRate: grantedRate,
    echoCancellation: typeof granted.echoCancellation === 'boolean' ? granted.echoCancellation : null,
    // A call profile, whoever asked for it. Under 24 kHz no music is being
    // monitored properly, and the cause is the device rather than the studio.
    degraded: grantedRate != null && grantedRate < 24_000,
  }

  return {
    mic,
    cancel: () => { try { rec.stop() } catch { /* already stopped */ } release() },
    stop: stopOnce,
    setMuted: (m: boolean) => {
      const wasMuted = muted
      muted = m
      // Coming back from muted, throw away whatever was captured while the
      // studio was talking rather than transcribing its own voice.
      if (wasMuted && !m && o.continuous) restartSegment()
    },
  }
}
