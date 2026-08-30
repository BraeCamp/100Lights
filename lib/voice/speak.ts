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
const AI_AUTO_KEY = 'beacon.voice.ai-auto'
const STUDIO_KEY = 'beacon.voice.studio'

/**
 * Use the studio's own recorded voice rather than the browser's.
 *
 * Brae: "Can't we record the response and just play it off of our system so
 * that we aren't paying at all after one person uses something once?"
 *
 * So the good voice stops being a running cost and becomes a fixed one. A
 * phrase is rendered by whoever says it first, stored under a hash of its own
 * text, and served from storage to everybody afterwards — two people muting a
 * track called Drums get the same file without anything knowing they are
 * related. The studio speaks from a script of about a hundred and forty shapes,
 * so the bill is bounded by how many distinct sentences EXIST, not by how many
 * people say them.
 *
 * On by default when speech is on, because a miss costs a fraction of a cent
 * and every failure below falls back to the browser's voice, which is free.
 */
export function studioVoice(): boolean {
  try { return localStorage.getItem(STUDIO_KEY) !== 'off' } catch { return true }
}

export function setStudioVoice(on: boolean): void {
  try { localStorage.setItem(STUDIO_KEY, on ? 'on' : 'off') } catch { /* private mode */ }
  if (!on) stopSpeaking()
}

/**
 * How much the assistant is allowed to do.
 *
 * Brae: "Can we have the AI transcription and editing be in the settings so
 * that paid users can move to and from AI to non-AI from there?"
 *
 * There were two states in the code and three in people's heads. The missing
 * one is OFF — not "ask me first", but never involve the assistant at all, so
 * the studio is a fixed vocabulary that cannot spend anything. Somebody working
 * to a budget, or offline, or who simply does not want a model in the loop, had
 * no way to say so; the only control was whether they got asked before it
 * happened.
 *
 *   rules  the built-in commands only. Never calls out, never costs anything.
 *          Says so plainly when it does not know a sentence.
 *   ask    Rules first; anything they cannot read is read back and confirmed —
 *          out loud, answerable with "yes" — before a thing is spent.
 *   auto   the default. The assistant acts on what it heard.
 *
 * ⚠️ `auto` IS THE DEFAULT, AND THAT REVERSES AN EARLIER INSTRUCTION.
 *
 * The original was Brae's, and it was right at the time: "I'm worried that AI
 * will mishear things and create commands and use credits accidentally... every
 * single time it should get confirmation first." The reasoning has not become
 * wrong — a misheard sentence is still indistinguishable from a correct one
 * until somebody reads it.
 *
 * What changed is that he used it. "It needs to do what I say, that's the whole
 * point of this." "It still pulls up 'Ask the assistant' menu which it
 * shouldn't do at all in AI mode." "The AI should be able to detect what to do
 * itself since it's wired into the whole Beacon + Apollo system." Three
 * sentences making one point: a voice control that stops for permission before
 * every unfamiliar sentence is not a voice control.
 *
 * The protection did not leave with it. `rules` is there for anybody who wants
 * a studio that cannot spend at all, `ask` is one click away and now actually
 * works by voice, and undo still undoes. What is gone is the toll charged on
 * every sentence the built-in commands happen not to cover.
 */
export type AssistantMode = 'rules' | 'ask' | 'auto'

const ASSISTANT_KEY = 'beacon.voice.assistant'

export function assistantMode(): AssistantMode {
  try {
    const v = localStorage.getItem(ASSISTANT_KEY)
    if (v === 'rules' || v === 'ask' || v === 'auto') return v
    // Nobody has chosen yet. The older on/off switch still wins where it was
    // deliberately turned OFF, so anybody who asked to be asked keeps being
    // asked; everyone else gets a studio that acts.
    return localStorage.getItem(AI_AUTO_KEY) === 'off' ? 'ask' : 'auto'
  } catch { return 'auto' }
}

export function setAssistantMode(m: AssistantMode): void {
  try {
    localStorage.setItem(ASSISTANT_KEY, m)
    // Kept in step, because the old key is what a session already running reads.
    localStorage.setItem(AI_AUTO_KEY, m === 'auto' ? 'on' : 'off')
  } catch { /* private mode */ }
}

/**
 * May the assistant act without being asked first?
 *
 * Now one reading of the mode above rather than its own setting. Kept because
 * it says the thing the barrier actually cares about, at the point where the
 * money would be spent.
 */
export function aiActs(): boolean {
  return assistantMode() === 'auto'
}

export function setAiActs(on: boolean): void {
  setAssistantMode(on ? 'auto' : 'ask')
}

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
  if (!speechEnabled() || !shouldSpeak(text, opts)) {
    opts.onDone?.()
    return false
  }
  // The studio's own voice if it can be had, the browser's if not. Deciding
  // here rather than inside the player keeps the fallback in one place: every
  // path that gives up on the recording lands in speakLocal.
  if (studioVoice()) {
    speakStudio(text, opts)
    return true
  }
  return speakLocal(text, opts)
}

/** The browser's built-in voice. Free, always available, and the floor that
 *  every other path falls back to. */
export function speakLocal(text: string, opts: SpeakOptions = {}): boolean {
  // Whatever is said now is the newest thing said, so a studio recording still
  // in flight belongs to a superseded utterance and must not arrive on top of
  // this one. (Harmless when this call IS that fetch's own fallback — it simply
  // retires a generation nothing is waiting on.)
  generation++
  if (!speechAvailable()) {
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
  // Bump first. A fetch already in flight resolves into a stale generation and
  // discards itself rather than starting to talk a second after being told to
  // stop — the microphone may be open by then, and speech into an open
  // microphone is transcribed as a command.
  generation++
  try { player?.pause() } catch { /* never played */ }
  if (!speechAvailable()) return
  try { window.speechSynthesis.cancel() } catch { /* nothing to cancel */ }
}

// ── The studio voice ────────────────────────────────────────────────────────

/** Phrases this tab has already resolved. The server cache is what makes the
 *  voice cheap; this one makes it INSTANT — a repeated read-back plays from a
 *  URL already in hand, with no round trip at all. */
const known = new Map<string, string>()
/** Phrases that are not worth asking about again this session: refused, or the
 *  endpoint is not there. Without it, a studio with no voice configured asks
 *  the server on every single command. */
const hopeless = new Set<string>()
let player: HTMLAudioElement | null = null
let generation = 0

/**
 * Say it in the studio's voice, falling back to the browser's.
 *
 * Asynchronous, and deliberately not awaited by the caller: `speak` reports
 * that it will speak, and whichever voice gets there does the talking. The
 * fallback is the important part — a recording that cannot be fetched, played,
 * or paid for must never be the reason a command goes unacknowledged.
 */
async function speakStudio(text: string, opts: SpeakOptions): Promise<void> {
  const words = spoken(text)
  const mine = ++generation
  if (hopeless.has(words)) { speakLocal(text, opts); return }

  let url = known.get(words)
  if (!url) {
    try {
      const res = await fetch('/api/voice/say', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: words }),
      })
      if (!res.ok) {
        // 401, 429, 501 and friends all mean the same thing here: this voice is
        // not available right now. Remembered so the next command does not ask
        // again — except a 429, which is a budget that resets tomorrow, and a
        // 502, which is a service that may come back in a minute.
        if (res.status !== 429 && res.status !== 502) hopeless.add(words)
        speakLocal(text, opts)
        return
      }
      url = (await res.json()).url as string
      if (url) known.set(words, url)
    } catch {
      speakLocal(text, opts)
      return
    }
  }
  // Told to stop while the request was in the air.
  if (mine !== generation) { opts.onDone?.(); return }
  if (!url) { speakLocal(text, opts); return }

  try {
    // One element reused: constructing a new one per utterance leaks them in
    // long sessions, and reusing it gives "replace, don't queue" for free.
    if (!player) player = new Audio()
    player.src = url
    player.onended = () => { if (mine === generation) opts.onDone?.() }
    player.onerror = () => { if (mine === generation) speakLocal(text, opts) }
    await player.play()
  } catch {
    // Autoplay refused, decode failed, no audio device. The browser voice is
    // subject to the same gesture rules, but it fails differently often enough
    // to be worth the try.
    if (mine === generation) speakLocal(text, opts)
  }
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
