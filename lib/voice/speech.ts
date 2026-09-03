'use client'
// Listening, and knowing when to stop.
//
// The browser's own speech recognition is the right tool for commands: it is
// instant, free, needs no upload, and the audio never leaves the machine. The
// app already has a transcription stack (lib/use-transcription) but that one is
// for CAPTIONS — it takes a finished blob and runs Whisper over it, which is
// the wrong shape here. A command wants words as they are spoken so the button
// can show them, and it wants them the moment the speaker stops.
//
// Not every browser has it. Rather than pretend, `isSpeechAvailable()` says so
// and the UI offers typing instead — a voice feature that silently does nothing
// on Firefox is worse than one that admits it.

export interface SpeechHandle {
  stop: () => void
  abort: () => void
}

interface RecognitionLike {
  continuous: boolean
  interimResults: boolean
  lang: string
  maxAlternatives: number
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((e: unknown) => void) | null
  onerror: ((e: unknown) => void) | null
  onend: (() => void) | null
}

type RecognitionCtor = new () => RecognitionLike

function ctor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export function isSpeechAvailable(): boolean {
  return ctor() != null
}

// ── Asking for the microphone ───────────────────────────────────────────────
//
// SpeechRecognition is SUPPOSED to prompt for the microphone by itself, and
// that is what this relied on. It is not dependable: Chrome will only raise its
// own prompt in some circumstances, and when it declines to, `start()` either
// throws nothing useful or ends immediately with `not-allowed` — a button that
// lights up, hears nothing, and reports no reason. Brae: "the voice thing isn't
// connect. It needs to request audio."
//
// So ask for the microphone explicitly first. getUserMedia is the call browsers
// treat as a real permission request, tied to the user gesture that started it,
// and once it resolves the recognition service has the access it needs.
//
// The stream is stopped immediately. We do not want the audio — SpeechRecognition
// opens its own capture — and holding it would leave the tab's recording
// indicator on for as long as the studio is open. The PERMISSION survives being
// granted; only the capture stops.
export async function requestMic(): Promise<{ ok: boolean; message?: string }> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return { ok: false, message: 'This browser will not give the page a microphone.' }
  }
  // Already granted? Then do NOT touch the microphone.
  //
  // Opening a capture and closing it again a millisecond later, immediately
  // before SpeechRecognition opens its own, is asking two things to take the
  // same device in quick succession — and when that loses, recognition ends the
  // moment it starts, which surfaces as "I didn't catch that" before anyone has
  // said a word. The permission prompt is the only reason to call getUserMedia
  // at all, so once permission exists this path should do nothing.
  try {
    const perm = await navigator.permissions?.query?.({ name: 'microphone' as PermissionName })
    if (perm?.state === 'granted') return { ok: true }
    if (perm?.state === 'denied') {
      return { ok: false, message: 'Microphone blocked. Allow it for this site in your browser settings, then try again.' }
    }
  } catch { /* Permissions API missing or does not know 'microphone' — ask properly below */ }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    for (const t of stream.getTracks()) t.stop()
    return { ok: true }
  } catch (e) {
    const name = (e as { name?: string })?.name ?? ''
    // Say which it is. "Denied" and "there is no microphone" need different
    // things from the user, and one message for both sends people to the wrong
    // settings page.
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      return { ok: false, message: 'Microphone blocked. Allow it for this site in your browser settings, then try again.' }
    }
    if (name === 'NotFoundError' || name === 'OverconstrainedError') {
      return { ok: false, message: 'No microphone found.' }
    }
    return { ok: false, message: 'Could not open the microphone.' }
  }
}

export interface ListenOptions {
  /** Words as they arrive, including the unfinished tail — for showing live. */
  onPartial?: (text: string) => void
  /**
   * The finished sentence. Fires once, when listening ends.
   *
   * `alternatives` holds the recogniser's other guesses for each phrase, best
   * first — the caller can score them against what is actually in the project
   * rather than trusting the top guess on proper nouns.
   *
   * `confidence` is the recogniser's own 0–1 rating of its best guess, averaged
   * over the phrases. It is the first of the two signals that decide whether a
   * sentence is safe to act on directly or should be handed to the assistant:
   * badly-heard speech and a badly-understood command need the same escape
   * hatch, and this is the half the browser can tell us.
   */
  onFinal: (text: string, alternatives: string[][], confidence: number) => void
  onError?: (message: string) => void
  lang?: string
}

/**
 * Start listening. Returns a handle; call `stop()` to finish and get the final
 * transcript, or `abort()` to throw it away.
 *
 * `continuous` is on so a long sentence — and Brae's examples are long — is not
 * cut off at the first pause for breath. That makes STOPPING the caller's job,
 * which is exactly what hold-to-talk and toggle both want.
 */
export function listen(opts: ListenOptions): SpeechHandle | null {
  const C = ctor()
  if (!C) { opts.onError?.('This browser has no speech recognition. Type the command instead.'); return null }

  const rec = new C()
  rec.continuous = true
  rec.interimResults = true
  rec.lang = opts.lang ?? 'en-US'
  // Several guesses, not one. The recogniser has already computed them, and the
  // caller can score them against the names in the open project — which is a far
  // easier problem than general transcription and is the one that decides
  // whether "loop base two" reaches the right track. See lib/voice/hear-better.
  rec.maxAlternatives = 5

  let finalText = ''
  /** Per finished phrase: every transcript the recogniser offered, best first. */
  const finalAlternatives: string[][] = []
  /** The recogniser's own confidence in each finished phrase, 0–1. */
  const confidences: number[] = []
  let stopped = false
  let aborted = false
  // ── The words that were on screen when it gave up ─────────────────────────
  //
  // ⚠️ Brae: "I asked Light to 'Change the reverb on pad to 100%' and it heard
  // me but said 'I didn't catch that'."
  //
  // Both halves of that were true. The recogniser streams INTERIM results,
  // which is what he watched appear, and promotes them to FINAL when it commits
  // to them — and only finals were kept. When the session ends before that
  // promotion (Chrome ends a continuous session on its own after a pause, and
  // does not always finalise the last phrase first) the interim text was thrown
  // away and the studio reported that nothing had been heard, while the words
  // were still sitting on the screen.
  //
  // So the last interim is kept as the fallback. It is only ever used when
  // NOTHING was finalised — the case that used to be a flat failure — and it is
  // handed over at reduced confidence, because it genuinely is a guess the
  // recogniser never stood behind. That is not a fudge: low confidence is what
  // routes a sentence to the assistant instead of to a rule, which is exactly
  // the right treatment for words nobody has confirmed.
  let lastInterim = ''

  rec.onresult = (e: unknown) => {
    const ev = e as {
      resultIndex: number
      results: ArrayLike<ArrayLike<{ transcript: string; confidence?: number }> & { isFinal: boolean; length: number }>
    }
    let interim = ''
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const r = ev.results[i]
      const text = r[0]?.transcript ?? ''
      if (r.isFinal) {
        finalText += text
        // Keep the runners-up for the caller to choose between. The top guess is
        // wrong often enough on proper nouns — a track called "Bass 2" arrives
        // as "base two" — and the right one is frequently already in this list.
        const alts: string[] = []
        for (let k = 0; k < (r.length ?? 1); k++) {
          const t = r[k]?.transcript?.trim()
          if (t) alts.push(t)
        }
        if (alts.length > 1) finalAlternatives.push(alts)
        // Chrome reports a confidence for the top alternative. It is not always
        // present, and 0 is a real value, so an absent one is recorded as 1
        // rather than as certainty-of-nothing — a missing rating should not by
        // itself send a good sentence to the assistant.
        const c = r[0]?.confidence
        confidences.push(typeof c === 'number' && c > 0 ? c : 1)
      } else interim += text
    }
    if (interim.trim()) lastInterim = interim.trim()
    opts.onPartial?.((finalText + interim).trim())
  }

  // ── Staying open ────────────────────────────────────────────────────────────
  //
  // `continuous` does NOT mean "listen until told to stop". Chrome ends the
  // session on its own after a stretch of quiet — sometimes within a second of
  // starting, before anyone has spoken — and `onend` then delivered an empty
  // transcript, which is the "I didn't catch that" that appears the instant the
  // button is pressed. In toggle mode especially, the button is a promise that
  // it is still listening, and it was not.
  //
  // So an end that the CALLER did not ask for restarts the recognition instead
  // of reporting. Bounded, because a microphone that cannot open would
  // otherwise spin forever: a fatal error stops it, and so do the caps below.
  let fatal = false
  let restarts = 0
  // ── Retry a blip, not an outage ──────────────────────────────────────────
  //
  // Three, not twelve. Every restart re-opens the microphone, and the operating
  // system shows that: Brae, on a machine that cannot reach the speech service,
  // "the microphone symbol on my computer is showing up and disappearing once a
  // second". Twelve retries against a service that is not there is a flashing
  // recording indicator and nothing else.
  //
  // Three failures in a row is already not a blip. After that the caller is
  // told, and it switches to recording — which is the path that actually works
  // on such a machine.
  let transientErrs = 0
  const MAX_TRANSIENT = 3
  let delivered = false
  const MAX_RESTARTS = 40
  const DEADLINE_MS = 3 * 60 * 1000
  const startedAt = Date.now()

  /** Hand the caller the result, exactly once. */
  const deliver = () => {
    if (delivered || aborted) return
    delivered = true
    // Anything finalised wins. Failing that, the words that were on screen —
    // see lastInterim above. Never both: a partial final plus a partial interim
    // would risk saying a word twice, and half a sentence acted on is worse
    // than one that asks again.
    const settled = finalText.trim()
    const text = settled || lastInterim
    if (text) {
      const conf = !settled
        // Never confirmed by the recogniser, so it must not fire a rule on its
        // own authority. 0.5 clears the bar for ordinary commands and not the
        // higher one used where a NAME has to be right.
        ? 0.5
        : confidences.length
          ? confidences.reduce((a, b) => a + b, 0) / confidences.length
          : 1
      opts.onFinal(text, finalAlternatives, conf)
    }
    // Only say "I didn't catch that" when nothing was heard AND nothing else
    // has already been reported — a fatal error has its own, better message.
    else if (!fatal) opts.onError?.('I didn\'t catch that.')
  }

  rec.onerror = (e: unknown) => {
    const err = (e as { error?: string }).error ?? 'unknown'
    // Record every one, even the ordinary ones. This is the single hardest
    // thing to diagnose remotely — the error code says exactly what went wrong
    // and it was previously visible only as a sentence in the UI, which is not
    // something anyone thinks to copy.
    void import('@/lib/diag-journal').then(m => m.diag('audio', `speech error: ${err}`)).catch(() => {})

    // "no-speech" and "aborted" are ordinary: the user pressed the button and
    // said nothing yet, or let go early. Reporting those as failures trains
    // people to ignore the error line, which is where the real ones appear —
    // and no-speech in particular is exactly what a restart is for.
    if (err === 'no-speech' || err === 'aborted') return

    // ── Not every failure is permanent, and treating them alike broke this ───
    //
    // Chrome's SpeechRecognition is not local: it streams audio to Google and
    // gets words back. So `network` is a NORMAL transient — a slow connection,
    // a VPN, a firewall, a service hiccup — and it arrives immediately, before
    // a word has been spoken. Every non-fatal code used to set `fatal` and stop
    // everything, which is exactly "it said speech recognition failed right off
    // the bat before I could even say anything".
    //
    // Transient codes now fall through to onend, which restarts, so a blip
    // costs a moment instead of the session. Only a genuinely unrecoverable
    // condition stops it: permission refused, or a speech service that will not
    // serve this browser at all.
    if (err === 'network' || err === 'audio-capture') {
      transientErrs++
      // Say something after a few, because silence while nothing works is worse
      // than a warning — but do NOT stop; the restart may well succeed.
      if (transientErrs < MAX_TRANSIENT) return
      fatal = true
      opts.onError?.(err === 'network'
        ? 'Speech recognition needs to reach Google\'s speech service and cannot. Type the command instead.'
        : 'Could not read the microphone.')
      return
    }

    fatal = true
    opts.onError?.(err === 'not-allowed'
      ? 'Microphone permission is off for this site.'
      : err === 'service-not-allowed'
        ? 'This browser will not allow speech recognition. Type the command instead.'
        : `Speech recognition failed (${err}). Type the command instead.`)
  }

  rec.onend = () => {
    if (aborted) return
    if (!stopped && !fatal && restarts < MAX_RESTARTS && Date.now() - startedAt < DEADLINE_MS) {
      restarts++
      // A short gap normally: calling start() from inside onend can throw
      // InvalidStateError because the previous session is still tearing down.
      //
      // But BACK OFF once errors have started. Restarting every 120ms against a
      // service that is failing re-opens the microphone that often, which the
      // operating system shows as an indicator flashing on and off — alarming,
      // and it makes a broken feature look like a spying one.
      const gap = transientErrs > 0 ? 500 * transientErrs : 120
      setTimeout(() => {
        if (stopped || aborted || fatal) return
        try { rec.start() } catch { /* it really is finished — deliver below */ }
      }, gap)
      return
    }
    // Either the caller stopped it, or it is genuinely over.
    stopped = true
    deliver()
  }

  try { rec.start() } catch { opts.onError?.('Could not start listening.'); return null }

  return {
    stop: () => {
      stopped = true
      try { rec.stop() } catch { /* already stopping */ }
      // Deliver even if `onend` never comes.
      //
      // Between sessions there IS no live recognition — the restart above is
      // waiting on a timer — so rec.stop() has nothing to end and fires no
      // event. Without this the transcript is never handed over and the button
      // sits on "Listening…" forever, which is the restart loop trading one
      // stuck state for another. deliver() is idempotent, so the ordinary path
      // (onend arrives first) is unaffected.
      setTimeout(deliver, 300)
    },
    abort: () => { aborted = true; try { rec.abort() } catch { /* already gone */ } },
  }
}

// ── The wake word ───────────────────────────────────────────────────────────

/**
 * Strip a leading "Hey Light" and the politeness around it.
 *
 * Brae's example opens with "Hey Light, could you …, please." None of that is
 * the command, and leaving it in makes the model spend a turn on the greeting.
 * The wake word is optional: the button already means "I am talking to you".
 */
export function stripWakeWord(text: string): string {
  return String(text ?? '')
    .replace(/^\s*(hey|hi|ok|okay|yo)\s+(light|lights|lite)\s*[,.!]?\s*/i, '')
    .replace(/^\s*(could|can|would|will)\s+you\s+(please\s+)?/i, '')
    .replace(/\s*,?\s*please\s*[.!]?\s*$/i, '')
    .trim()
}
