import { phoneticKey } from './hypotheses'

// ── On, but not listening to everything ─────────────────────────────────────
//
// Brae: "What can we do to help light be able to be on but quiet until it can
// tell that somebody is talking to it? I don't want background noise to mess
// with the on toggled voice command system."
//
// Holding the microphone open solved one problem and created its own. Every
// filter before this point answers "is that a voice?" — the level detector, the
// hold time, the transcriber. None of them answers the question that actually
// matters once the mic stays open for minutes at a time:
//
//   IS THAT VOICE TALKING TO ME?
//
// Nothing acoustic settles it. Somebody across the room saying "stop" is,
// acoustically, a person clearly saying stop. Turning the sensitivity down does
// not help either: it makes the studio worse at hearing its owner while leaving
// it perfectly able to hear a louder mistake.
//
// The answer every always-on assistant has arrived at is the one people already
// use on each other — say who you are talking to. The studio has a name, and it
// was being thrown away: "light", "lights" and "beacon" sit in the filler list,
// stripped as noise before any rule sees them.
//
// So the session has two states. ATTENTIVE, where commands run: you just
// clicked the button, or you just used your voice, so of course you are talking
// to it. DORMANT, which it drifts into after a quiet spell, where nothing
// happens unless it is addressed by name.
//
// The important half is what happens to everything else: it is dropped in
// silence. No panel, no question, no credits — a room having a conversation
// near an open microphone should produce nothing at all.

/**
 * What the studio answers to.
 *
 * Several, because a recogniser hearing one syllable over a mix will not always
 * pick the same word, and because people address a thing by whatever they call
 * it. All of them are already treated as filler once a command is being read,
 * so keeping them here costs nothing downstream.
 */
export const WAKE_WORDS = ['light', 'lights', 'beacon', 'lite'] as const

/**
 * How long the studio keeps paying attention after being spoken to.
 *
 * Long enough to give three or four commands in a row without repeating
 * yourself, short enough that a session left running does not stay armed while
 * the room fills up with a conversation. It restarts on every utterance the
 * studio UNDERSTANDS — including one it only queued or had a question about —
 * so a working session never goes dormant underneath somebody.
 *
 * Raised from 25 seconds after Brae reported having to say the name before
 * everything: a window is a guess about how long a person pauses while
 * thinking, and twenty-five seconds was too short a guess.
 */
export const ATTENTION_MS = 45_000

/**
 * How sure the transcriber must be before a DORMANT session will believe it was
 * addressed.
 *
 * The one place a false positive costs the whole feature: a studio that wakes on
 * mishearing its own name is a studio that is always awake. When it is already
 * attentive this does not apply — the conversation is established.
 */
export const WAKE_CONFIDENCE = 0.55

export interface AttentionInput {
  /**
   * Does this text read as a command the studio knows?
   *
   * Supplied by the caller rather than imported, because attention must not
   * depend on the command registry — and because this is exactly the "context
   * approves" test: a name that only SOUNDED right is believed when what
   * follows it is something the studio can actually do.
   */
  looksLikeCommand?: (text: string) => boolean
  /** What was heard. */
  text: string
  /** The transcriber's confidence in the utterance. */
  confidence?: number
  /** When it was heard. */
  now: number
  /** When a command was last accepted, or 0. */
  lastAcceptedAt: number
  /** False for push-to-talk, where holding the button IS the address. */
  continuous?: boolean
}

export type AttentionVerdict =
  /** Act on it. */
  | { act: true; text: string; addressed: boolean }
  /** Ignore it, and say nothing at all. */
  | { act: false; reason: 'not-addressed' | 'unsure' }

/** One edit apart, for a name heard through a mix. */
function near(a: string, b: string): boolean {
  if (a === b) return true
  let i = 0, j = 0, edits = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue }
    if (++edits > 1) return false
    if (a.length > b.length) i++
    else if (b.length > a.length) j++
    else { i++; j++ }
  }
  return edits + (a.length - i) + (b.length - j) <= 1
}

/**
 * Does this word SOUND like the studio's name?
 *
 * Brae: "Light seems to switch to late... Can we code Light in as a name so that
 * it recognizes its name being said if the context approves?"
 *
 * "Light" and "late" differ by one vowel and nothing else — a general-purpose
 * recogniser has no reason to prefer either, and it does not know this one is a
 * name. So the name is matched by SOUND, which puts light, late and lite in one
 * bucket while leaving right, white and night in their own.
 *
 * That bucket is too loose to wake on by itself, which is the second half of
 * what he asked for: a sound-alike only counts when the context approves — when
 * the rest of the sentence is a command the studio actually knows. "Late" on its
 * own is somebody talking about the time. "Late, mute the drums" is somebody
 * whose microphone misheard them.
 */
function soundsLikeName(word: string): boolean {
  const key = phoneticKey(word)
  return !!key && WAKE_WORDS.some(n => phoneticKey(n) === key)
}

/**
 * Was the studio addressed, and what is left when its name is taken out?
 *
 * The name has to be at the START or the END. "Light, mute the drums" and "mute
 * the drums, light" are both people talking to a machine; "the light on the
 * compressor" is a person talking about one, and a name found anywhere in the
 * sentence would make the second indistinguishable from the first.
 */
export function addressed(text: string): {
  addressed: boolean
  /** True when the name was only a SOUND-ALIKE and wants the context checked. */
  approximate: boolean
  rest: string
} {
  const raw = String(text ?? '').trim()
  const words = raw.toLowerCase().replace(/[^a-z0-9\s'-]/g, ' ').split(/\s+/).filter(Boolean)
  if (!words.length) return { addressed: false, approximate: false, rest: raw }

  // EXACTLY one of the names. Not "near" one: a one-edit tolerance here made
  // "late" and "right" both count as the name outright, which skipped the
  // context check entirely and defeated the point of having two tiers. Sounding
  // like the name is the other tier's job, and it is the one that asks
  // permission.
  const spelled = (w: string) => (WAKE_WORDS as readonly string[]).includes(w)
  // A greeting in front of the name is part of the address, not the command.
  const GREETING = ['hey', 'ok', 'okay', 'hi', 'yo', 'hello']

  let start = 0
  while (start < words.length && GREETING.includes(words[start])) start++
  const greeted = start > 0

  const at = (i: number) => {
    const w = words[i]
    if (spelled(w)) return 'exact' as const
    if (soundsLikeName(w)) return 'sound' as const
    return null
  }

  if (start < words.length) {
    const how = at(start)
    if (how) {
      return {
        addressed: true,
        // "Hey late, mute the drums" — the greeting is itself evidence that
        // somebody is addressing something, so the sound-alike needs no further
        // approval. Nobody says "hey late".
        approximate: how === 'sound' && !greeted,
        rest: words.slice(start + 1).join(' '),
      }
    }
  }

  // Trailing: "mute the drums, light".
  if (words.length > 1) {
    const how = at(words.length - 1)
    if (how) {
      return { addressed: true, approximate: how === 'sound', rest: words.slice(0, -1).join(' ') }
    }
  }

  return { addressed: false, approximate: false, rest: raw }
}

/**
 * Should this utterance be acted on?
 *
 * The whole point is how much is refused. A held-open microphone in a room with
 * other people in it will hear far more that is not for it than is, and every
 * one of those must produce nothing — not a question, not an apology, and above
 * all not a command.
 */
export function considerUtterance(input: AttentionInput): AttentionVerdict {
  const { addressed: named, approximate, rest } = addressed(input.text)

  // Push-to-talk: the button was held down for the duration of the sentence.
  // There is no ambiguity about who was being spoken to.
  if (!input.continuous) return { act: true, text: named ? rest : input.text, addressed: named }

  if (named) {
    // Being addressed is the strongest signal there is, but a session that
    // wakes on a mishearing of its own name is a session that is always awake.
    if ((input.confidence ?? 1) < WAKE_CONFIDENCE) return { act: false, reason: 'unsure' }

    // A name that only SOUNDED right has to be approved by what follows it.
    // "Late" alone is somebody talking about the time; "late, mute the drums"
    // is somebody whose microphone misheard them.
    if (approximate) {
      const approved = rest.trim() ? (input.looksLikeCommand?.(rest) ?? false) : false
      if (!approved) return { act: false, reason: 'not-addressed' }
    }

    // "Light." on its own is somebody getting the studio's attention, which is
    // a complete and reasonable thing to say. It wakes and waits.
    return { act: true, text: rest, addressed: true }
  }

  // Still in the conversation: a command was accepted moments ago, so this is
  // almost certainly the next one.
  if (input.lastAcceptedAt && input.now - input.lastAcceptedAt < ATTENTION_MS) {
    return { act: true, text: input.text, addressed: false }
  }

  return { act: false, reason: 'not-addressed' }
}

/** Is the session currently listening for its name, or for commands? */
export function isAttentive(now: number, lastAcceptedAt: number): boolean {
  return !!lastAcceptedAt && now - lastAcceptedAt < ATTENTION_MS
}
