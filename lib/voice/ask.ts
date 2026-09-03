'use client'
// ── Asking, instead of picking ──────────────────────────────────────────────
//
// Brae: "if there's a bass track with 3 track items on it and one of them is
// named 'bass' then there would be confusion. The program would ask 'Do you mean
// the bass track, or the bass item on the bass track at bar 15?'"
//
// That confusion was live and silent. resolveClip looks for a clip by name
// first and falls back to the named track's earliest clip, so in a project with
// a track called Bass and a clip called bass, "loop the bass three more times"
// picked the clip without mentioning that it had a choice. And a track with
// three clips took the first one every time, which is right often enough to be
// trusted and wrong often enough to matter.
//
// Both are the same mistake this system keeps making in different places:
// resolving an ambiguity by ORDER — first match, earliest clip — rather than by
// evidence. Where there is no evidence, the answer is not a better tie-break.
// It is a question.
//
// The shapes here are DATA, not callbacks. A question has to survive being
// spoken aloud, drawn as buttons, answered by voice minutes later, and tested
// without a browser — which a closure does not. Everything is a plain object
// carrying the calls it would make.

import type { VoiceCall } from './execute-music'

export interface AskOption {
  /** Written for the ear first: "the bass clip at bar 15", not "clip c3". */
  label: string
  /** What choosing this does. */
  calls: VoiceCall[]
  /**
   * Words that pick this option when the answer is spoken.
   *
   * People answer a question with a fragment — "the track", "bar 15", "the
   * second one" — not by repeating the whole option back. These are what those
   * fragments are matched against.
   */
  keywords: string[]
  /**
   * Something the STUDIO does, rather than something the song becomes.
   *
   * ⚠️ Every other option is a list of VoiceCalls, which is right for anything
   * that edits the project: calls are data, so they can be read back, queued,
   * confirmed and recorded as a training example. But a few questions are about
   * the studio's own behaviour and have no representation as an edit — "do you
   * want the click on this take?" starts a count-in and opens a microphone, and
   * there is no call that means that.
   *
   * Kept OPTIONAL and rare on purpose. An option with a closure is invisible to
   * everything that reasons about calls, so anything expressible as a call must
   * stay one.
   */
  onPick?: () => void
}

/**
 * A follow-up worth offering once the ambiguity is resolved.
 *
 * Brae: "Would you like to rename the bass item at bar 15 to avoid confusion?"
 * and "What would you like to change it to?"
 *
 * This is the part that makes the feature more than a disambiguator. Answering
 * the question fixes THIS command; renaming the thing stops the question being
 * asked again. An assistant that notices the cause of a confusion it just had
 * to interrupt you about is doing something a menu cannot.
 */
export interface AskOffer {
  /** "Would you like to rename it to avoid confusion?" */
  speak: string
  /** Asked only if they say yes. "What would you like to call it?" */
  prompt: string
  /** The call to make, with the spoken answer substituted into `field`. */
  call: { name: string; input: Record<string, unknown>; field: string }
}

export interface VoiceAsk {
  /** The whole question, phrased to be spoken. */
  speak: string
  options: AskOption[]
  /** Offered after an option is chosen, when there is something worth fixing. */
  offer?: AskOffer
}

/** Yes and no, as people actually say them. */
const YES = ['yes', 'yeah', 'yep', 'sure', 'ok', 'okay', 'please', 'do', 'go', 'right', 'correct', 'yup']
const NO = ['no', 'nope', 'nah', 'cancel', 'never', 'stop', 'forget', 'nevermind', 'leave']

/** Did they agree? Null when the answer is neither. */
export function readYesNo(sentence: string): boolean | null {
  const words = String(sentence ?? '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean)
  if (!words.length) return null
  // "no" checked first: "no thanks" contains neither a yes word nor anything
  // else, while "yes, no wait" is rare enough to leave alone.
  if (words.some(w => NO.includes(w))) return false
  if (words.some(w => YES.includes(w))) return true
  return null
}

/** Ordinals, for "the second one". */
const ORDINALS: Record<string, number> = {
  first: 0, second: 1, third: 2, fourth: 3, fifth: 4, sixth: 5,
  last: -1, latter: -1, former: 0, one: 0, two: 1, three: 2,
}

/**
 * Which option does this answer pick?
 *
 * People answer a question in the fewest words that could possibly work — "the
 * track", "bar 15", "the second one" — so this scores each option by how many
 * of its keywords the answer contains, and takes a clear winner.
 *
 * Returns null rather than guessing. A misread answer to a disambiguating
 * question is worse than the original ambiguity, because the person believes it
 * has been settled.
 */
export function readChoice(sentence: string, options: AskOption[]): number | null {
  const text = String(sentence ?? '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ')
  const words = text.split(/\s+/).filter(Boolean)
  if (!words.length || !options.length) return null

  // "the second one" — positional, and unambiguous when it fits.
  for (const word of words) {
    const n = ORDINALS[word]
    if (n == null) continue
    const index = n < 0 ? options.length - 1 : n
    if (index >= 0 && index < options.length) return index
  }

  const scores = options.map(option => {
    let score = 0
    for (const keyword of option.keywords) {
      const k = keyword.toLowerCase()
      // Multi-word keywords ("bar 15") count for more than single words: they
      // are specific, and a person who says one has identified something.
      //
      // Padded on both sides so the match respects word boundaries. Plain
      // substring matching made "bar 15" match the option for "bar 1", which
      // tied the two and turned a perfectly clear answer into a re-asked
      // question — and every project has a bar 1.
      if (k.includes(' ')) { if (` ${text} `.includes(` ${k} `)) score += 2 }
      else if (words.includes(k)) score += 1
    }
    return score
  })

  const best = Math.max(...scores)
  if (best === 0) return null
  // A tie is not an answer. Asking again is annoying; acting on a coin flip
  // after explicitly asking is worse.
  if (scores.filter(s => s === best).length > 1) return null
  return scores.indexOf(best)
}
