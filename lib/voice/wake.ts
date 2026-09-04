// Standby: a microphone left open that acts on nothing until it is called.
//
// Brae: "Can we have a standby mode that only listens for the user saying
// 'Hey Light' or 'Voice Control'."
//
// This is the wake word coming back as a CHOICE rather than a toll. The old
// rule demanded "light" in front of every sentence and failed both ways: the
// recogniser renders "light" as "late", "right", "like", so real commands
// were dropped, and words that were unmistakably for the studio ("execute")
// were dropped as room noise. Standby is different in two ways. It is opt-in,
// for the person who wants the microphone open across a session and does not
// want the room's conversation read. And the wake phrase is two words — "hey
// light", "voice control" — so a bent "light" still wakes when "hey" is in
// front of it, and a bare "right" or "like" never does.

/** The phrases that wake a standing-by studio, longest first. */
export const WAKE_PHRASES = [
  'hey light', 'hello light', 'hi light', 'ok light', 'okay light', 'yo light', 'oi light',
  'voice control', 'voice controls', 'voice command', 'voice commands',
]

/** How the recogniser renders "light" — accepted only after a greeting. */
const LIGHT_LIKE = ['light', 'lights', 'lite', 'late', 'right', 'like', 'white', 'night', 'flight', 'bright', 'lit', 'lyte']
const GREETINGS = ['hey', 'hay', 'a', 'hi', 'hello', 'ok', 'okay', 'yo', 'oi']

export interface Wake {
  /** The phrase as understood — "hey light", "voice control". */
  phrase: string
  /** What came after it: the command, if any, or nothing. */
  rest: string
}

const flat = (s: string) => ` ${String(s ?? '').toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim()} `

/**
 * Was the studio called? Anywhere in the sentence — a recogniser often puts
 * an "um" or half a word before the greeting — and the words after the call
 * are the command.
 *
 *   "hey light, mute the drums"      → { phrase: "hey light", rest: "mute the drums" }
 *   "voice control unmute the pad"   → { phrase: "voice control", rest: "unmute the pad" }
 *   "Hey Light"                      → { phrase: "hey light", rest: "" }
 *   "hey late mute the drums"        → { phrase: "hey light", rest: "mute the drums" }
 *   "turn right at the lights"       → null
 *   "the light is on"                → null
 */
export function wakePhraseIn(text: string): Wake | null {
  const t = flat(text)
  if (!t.trim()) return null
  for (const phrase of WAKE_PHRASES) {
    const at = t.indexOf(` ${phrase} `)
    if (at < 0) continue
    const canonical = phrase.startsWith('voice') ? 'voice control' : 'hey light'
    return { phrase: canonical, rest: t.slice(at + phrase.length + 2).trim() }
  }
  // A greeting and a bent "light": "hey late", "a light", "hi right".
  const words = t.trim().split(' ')
  for (let i = 0; i + 1 < words.length; i++) {
    if (GREETINGS.includes(words[i]) && LIGHT_LIKE.includes(words[i + 1])) {
      return { phrase: 'hey light', rest: words.slice(i + 2).join(' ').trim() }
    }
  }
  return null
}

/** Words that put a listening studio back to sleep, or wake it for good. */
export type StandbyControl = 'sleep' | 'standby-on' | 'standby-off'

const SLEEP = ['stand by', 'standby', 'go to standby', 'standby mode', 'standby now', 'go to sleep', 'go back to sleep', 'back to sleep',
  'sleep now', "that's all", "that's all for now", "that's it for now", "that'll do", 'thanks light', 'thank you light',
  'stop listening', 'stop listening for now', 'rest now', 'stand down']
const STANDBY_OFF = ['standby off', 'turn off standby', 'turn standby off', 'stop standing by', 'stay awake', 'keep listening to everything',
  'no standby', 'standby mode off', 'always listen', 'listen to everything']
const STANDBY_ON = ['standby on', 'turn on standby', 'turn standby on', 'standby mode on', 'only listen for hey light', 'only wake on hey light',
  'wait for hey light', 'wait for voice control']

export function standbyControlIn(text: string): StandbyControl | null {
  const t = flat(text)
  if (!t.trim()) return null
  // Longest sets first, and the explicit off/on before the bare "standby".
  if (STANDBY_OFF.some(p => t.includes(` ${p} `))) return 'standby-off'
  if (STANDBY_ON.some(p => t.includes(` ${p} `))) return 'standby-on'
  // Only a sentence that IS the instruction: "stand by" inside a longer
  // sentence ("I'll stand by the door") is somebody's conversation.
  const bare = t.trim()
  if (SLEEP.some(p => bare === p || bare === `light ${p}` || bare === `${p} light` || bare === `hey light ${p}` || bare === `please ${p}` || bare === `${p} please`)) return 'sleep'
  return null
}

// ── The setting ─────────────────────────────────────────────────────────────

const STANDBY_KEY = 'beacon.voice.standby'
const AWAKE_KEY = 'beacon.voice.standby.awake'

/** Off by default: the button is the signal, until somebody asks for the call. */
export function standbyOn(): boolean {
  try { return localStorage.getItem(STANDBY_KEY) === 'on' } catch { return false }
}
export function setStandbyOn(on: boolean): void {
  try { localStorage.setItem(STANDBY_KEY, on ? 'on' : 'off') } catch { /* private mode */ }
}

/** How long it stays awake after the call or the last command, in seconds. 0 = until told to stand by. */
export const AWAKE_CHOICES = [15, 30, 60, 0] as const
export function standbyAwakeSeconds(): number {
  try {
    const v = Number(localStorage.getItem(AWAKE_KEY))
    return Number.isFinite(v) && (AWAKE_CHOICES as readonly number[]).includes(v) ? v : 30
  } catch { return 30 }
}
export function setStandbyAwakeSeconds(v: number): void {
  try { localStorage.setItem(AWAKE_KEY, String(v)) } catch { /* private mode */ }
}

/** Awake now? Woken or last spoken to within the window — or told to stay up. */
export function isAwake(wokeAt: number, lastAcceptedAt: number, awakeSeconds: number, now = Date.now()): boolean {
  if (!wokeAt && !lastAcceptedAt) return false
  if (awakeSeconds === 0) return wokeAt > 0
  return now - Math.max(wokeAt, lastAcceptedAt) < awakeSeconds * 1000
}
