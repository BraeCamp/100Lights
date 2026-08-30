'use client'
// ── Saying it out loud ──────────────────────────────────────────────────────
//
// Brae: "Let's build responses then."
//
// The studio has always had the words — every command already returns a `say`
// string written as a sentence rather than a status code, because the read-back
// was meant to be understood by a person. What it lacked was a voice.
//
// A talking assistant is easy to add and easy to make unbearable, and in a
// studio the ways it goes wrong are specific and severe:
//
//   IT TALKS OVER THE MUSIC. Speech lands on top of whatever is playing. This is
//   the one application where an assistant reading a confirmation aloud is
//   actively destructive, so routine confirmations stay silent while the
//   transport runs. Questions and problems still speak: a question you cannot
//   hear is worse than a moment of talking over a loop, and if you asked the
//   studio something while it played, you are waiting for the answer.
//
//   IT TALKS INTO ITS OWN MICROPHONE. If it speaks while listening, it
//   transcribes itself, and the transcript of the studio saying "Bass 2: muted"
//   is a plausible-looking command. Speech is refused outright while the mic is
//   open, and stopped the instant it opens.
//
//   IT REPEATS ITSELF. A new command's answer replaces the old one rather than
//   queueing behind it. Nobody wants to hear the last four things they did.
//
// Everything is best-effort. speechSynthesis is missing or muted often enough —
// no voices installed, an OS that has not loaded them, a browser that requires a
// gesture first — that nothing here may throw or block, and every caller treats
// speaking as a bonus on top of the text, never as the delivery.

const ENABLED_KEY = 'beacon.voice.speak'
const SENSITIVITY_KEY = 'beacon.voice.sensitivity'

/**
 * How hard it should be to trigger while the microphone is held open.
 *
 * Brae: "It's also having trouble hearing me and differentiating my voice next
 * to the mic from background talking."
 *
 * There is no default that fixes that, because the answer depends on how loud
 * the room is, how far away the other people are and what microphone is in
 * front of him — none of which is measurable from here. What IS possible is to
 * make the bar adjustable and then SHOW it on the meter, so it can be set by
 * watching one voice cross it and the other not.
 *
 * 1 is the standing behaviour. Higher ignores more of the room.
 */
export function voiceSensitivity(): number {
  try {
    const v = Number(localStorage.getItem(SENSITIVITY_KEY))
    return Number.isFinite(v) && v > 0 ? v : 1
  } catch { return 1 }
}

export function setVoiceSensitivity(v: number): void {
  try { localStorage.setItem(SENSITIVITY_KEY, String(v)) } catch { /* private mode */ }
}

export type SpeechKind =
  /** What just happened. Suppressed while the transport runs. */
  | 'report'
  /** A question waiting for an answer. Always spoken — it is the point. */
  | 'question'
  /** Something went wrong, or a command was refused. Always spoken. */
  | 'problem'

export interface SpeakOptions {
  kind?: SpeechKind
  /** True while the transport is running. */
  playing?: boolean
  /**
   * True while the microphone is open AND cannot be deafened.
   *
   * A one-command take is over by the time there is anything to say, so this
   * is simply false. A microphone held open across commands is a different
   * matter: it is still listening, and it would hear the read-back. That case
   * is handled by deafening the recorder for the duration instead of staying
   * silent — see onDone — because a continuous session that never speaks is a
   * conversation with one participant.
   */
  listening?: boolean
  /** Called when the utterance finishes, or immediately if nothing was said.
   *  Used to stop ignoring the room again. */
  onDone?: () => void
}

/** Is the studio allowed to talk? Off until asked for — a studio that starts
 *  talking unprompted the first time you use it is one people switch off and
 *  never switch back on. */
export function speechEnabled(): boolean {
  try { return localStorage.getItem(ENABLED_KEY) === 'on' } catch { return false }
}

export function setSpeechEnabled(on: boolean): void {
  try { localStorage.setItem(ENABLED_KEY, on ? 'on' : 'off') } catch { /* private mode */ }
  if (!on) stopSpeaking()
}

/** Can this browser speak at all? */
export function speechAvailable(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

/**
 * Should this be said aloud right now?
 *
 * Pure, and separated from the speaking so the policy can be tested without a
 * speech engine — the rules are the part worth getting right, and they are the
 * part a browser cannot be asked about in a unit test.
 */
export function shouldSpeak(text: string, opts: SpeakOptions = {}): boolean {
  if (!text || !text.trim()) return false
  // Never into an open microphone: it would transcribe itself, and "Bass 2
  // muted" reads as a command.
  if (opts.listening) return false
  // Routine confirmations wait until the music stops. Questions and problems do
  // not — an unheard question is a conversation that stalls.
  if (opts.playing && (opts.kind ?? 'report') === 'report') return false
  return true
}

/**
 * Pick a voice worth listening to.
 *
 * Browsers return a long list in no useful order, and the default is often the
 * worst one. Preference: a local (non-network) English voice, since a network
 * voice adds latency to something that should feel immediate and stops working
 * offline. Cached, because getVoices() is surprisingly expensive and is called
 * on every utterance otherwise.
 */
let cachedVoice: SpeechSynthesisVoice | null | undefined
export function preferredVoice(): SpeechSynthesisVoice | null {
  if (cachedVoice !== undefined) return cachedVoice
  if (!speechAvailable()) return (cachedVoice = null)
  const voices = window.speechSynthesis.getVoices()
  if (!voices.length) {
    // Not loaded yet. Do not cache a miss — they arrive asynchronously and the
    // next utterance should look again.
    return null
  }
  const english = voices.filter(v => v.lang?.toLowerCase().startsWith('en'))
  const pool = english.length ? english : voices
  cachedVoice = pool.find(v => v.localService && /samantha|daniel|karen|serena|natural/i.test(v.name))
    ?? pool.find(v => v.localService)
    ?? pool[0]
    ?? null
  return cachedVoice
}

/**
 * Say something.
 *
 * Returns whether it actually spoke, so a caller can tell the difference
 * between "said it" and "stayed quiet because the transport is running" without
 * guessing.
 */
export function speak(text: string, opts: SpeakOptions = {}): boolean {
  if (!speechEnabled() || !speechAvailable() || !shouldSpeak(text, opts)) {
    opts.onDone?.()
    return false
  }
  try {
    // Replace rather than queue: the answer to what you just asked matters, the
    // four before it do not.
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(spoken(text))
    const voice = preferredVoice()
    if (voice) utterance.voice = voice
    // A touch quicker than default. These are short confirmations to someone
    // mid-task, not an audiobook.
    utterance.rate = 1.08
    utterance.pitch = 1
    // Both, because a browser that fails to speak still owes the caller its
    // callback — a session that stays deaf because an utterance never ended is
    // a worse failure than one that never spoke.
    utterance.onend = () => opts.onDone?.()
    utterance.onerror = () => opts.onDone?.()
    window.speechSynthesis.speak(utterance)
    return true
  } catch {
    // A browser that refuses to speak is not a reason to fail a command that
    // already ran.
    opts.onDone?.()
    return false
  }
}

/** Shut up immediately — when the mic opens, or the user turns speech off. */
export function stopSpeaking(): void {
  if (!speechAvailable()) return
  try { window.speechSynthesis.cancel() } catch { /* nothing to cancel */ }
}

/**
 * Rewrite a read-back for the ear rather than the eye.
 *
 * The `say` strings were written to be read, and a few things that look right
 * sound wrong: quotation marks around a track name become audible in some
 * voices, "3/4" is read as a fraction, and "bar 5 beat 3" wants a comma to stop
 * it running together. Small, and the difference between sounding deliberate
 * and sounding like a screen reader.
 */
export function spoken(text: string): string {
  return String(text ?? '')
    .replace(/["“”]/g, '')
    .replace(/(\d)\/(\d)/g, '$1 $2')
    .replace(/\s+beat\b/g, ', beat')
    .replace(/\s+/g, ' ')
    .trim()
}
