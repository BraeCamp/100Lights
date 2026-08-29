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
  /** The finished sentence. Fires once, when listening ends. */
  onFinal: (text: string) => void
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
  rec.maxAlternatives = 1

  let finalText = ''
  let stopped = false
  let aborted = false

  rec.onresult = (e: unknown) => {
    const ev = e as { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }
    let interim = ''
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const r = ev.results[i]
      const text = r[0]?.transcript ?? ''
      if (r.isFinal) finalText += text
      else interim += text
    }
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
  let delivered = false
  const MAX_RESTARTS = 40
  const DEADLINE_MS = 3 * 60 * 1000
  const startedAt = Date.now()

  /** Hand the caller the result, exactly once. */
  const deliver = () => {
    if (delivered || aborted) return
    delivered = true
    const text = finalText.trim()
    if (text) opts.onFinal(text)
    // Only say "I didn't catch that" when nothing was heard AND nothing else
    // has already been reported — a fatal error has its own, better message.
    else if (!fatal) opts.onError?.('I didn\'t catch that.')
  }

  rec.onerror = (e: unknown) => {
    const err = (e as { error?: string }).error ?? 'unknown'
    // "no-speech" and "aborted" are ordinary: the user pressed the button and
    // said nothing yet, or let go early. Reporting those as failures trains
    // people to ignore the error line, which is where the real ones appear —
    // and no-speech in particular is exactly what a restart is for.
    if (err === 'no-speech' || err === 'aborted') return
    // Everything else is worth stopping for. Retrying a denied microphone or a
    // missing speech service just loops.
    fatal = true
    opts.onError?.(err === 'not-allowed'
      ? 'Microphone permission is off for this site.'
      : err === 'audio-capture'
        ? 'No microphone available.'
        : `Speech recognition failed (${err}).`)
  }

  rec.onend = () => {
    if (aborted) return
    if (!stopped && !fatal && restarts < MAX_RESTARTS && Date.now() - startedAt < DEADLINE_MS) {
      restarts++
      // A short gap: calling start() from inside onend can throw
      // InvalidStateError because the previous session is still tearing down.
      setTimeout(() => {
        if (stopped || aborted || fatal) return
        try { rec.start() } catch { /* it really is finished — deliver below */ }
      }, 120)
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
