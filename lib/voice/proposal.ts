'use client'
// ── The change on the table ─────────────────────────────────────────────────
//
// Brae's dialogue turns on its third line:
//
//   U: "Let's do that, yeah. Maybe just a little bit less of it, or it could
//       start that way then lower?"
//
// "A little bit less of it" is not a command. There is no track in it, no
// parameter, no number — it only means anything because of what just happened.
// So something has to still be holding what just happened, and holding it in a
// form that can be BENT rather than re-parsed: scaled down, spread over time,
// taken back.
//
// That is a proposal: a change that has been made for real and is still under
// discussion. Made for real on purpose — a preview path that rendered
// something else would be a second implementation of playback, and the day it
// drifted from the real one it would be lying at exactly the moment somebody
// trusted it. What you hear is what you have; the conversation decides whether
// it stays.
//
// It ends when the person moves on. "That's good" lets it go, "undo that"
// takes it back, and saying something unrelated simply leaves it behind —
// there is nothing to clean up, because the edit is already an ordinary edit.

import type { VoiceCall } from './execute-music'
import type { PlainSense } from './plain-words'

export interface Proposal {
  /** The word that started it: "fuzzy". */
  word: string
  /** The sense that was chosen. */
  sense: PlainSense
  /** What it is being done to, as it was said. */
  target: string
  /** Where it applies, in beats — for playing it back in context. */
  span: { start: number; end: number } | null
  /** Strength now, 0–100. */
  amount: number
  /** Already spread over its span, rather than sitting at one value. */
  ramped?: { from: number; to: number }
  /** When it was made, so a stale one can be let go of. */
  at: number
}

/**
 * How long a proposal stays on the table. Long enough to listen, think, and
 * answer; short enough that "a bit less" an hour later is not quietly applied
 * to something forgotten.
 */
export const PROPOSAL_TTL_MS = 5 * 60 * 1000

let current: Proposal | null = null

export function setProposal(p: Proposal | null): void { current = p }
export function getProposal(now = Date.now()): Proposal | null {
  if (current && now - current.at > PROPOSAL_TTL_MS) current = null
  return current
}
export function clearProposal(): void { current = null }

// ── Bending it ───────────────────────────────────────────────────────────────

export type AdjustKind = 'less' | 'more' | 'ramp_down' | 'ramp_up' | 'undo' | 'keep'

/** How far "a little", nothing said, and "a lot" move the strength. */
export const STEP = { little: 12, normal: 22, lot: 38 } as const
export type StepSize = keyof typeof STEP

/**
 * What the sentence is asking of the thing on the table, if anything.
 *
 * ⚠️ These words only mean this while a proposal is live. "Less" on its own is
 * meaningless otherwise, and the caller must not offer this reading when there
 * is nothing to be less OF — which is the whole reason it takes the proposal.
 */
export function readAdjust(sentence: string): { kind: AdjustKind; size: StepSize } | null {
  const s = ` ${String(sentence ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `
  const has = (...w: string[]) => w.some(x => s.includes(` ${x} `))
  // ⚠️ "Way" is only a size next to what it sizes. "Start that way then come
  // down" means "like that", and reading it as "a lot" made a gentle request
  // into the strongest move available.
  const size: StepSize = has('little', 'bit', 'touch', 'hair', 'slightly', 'tiny') ? 'little'
    : has('lot', 'much', 'loads', 'heaps', 'far') || /\bway (?:more|less|louder|quieter|lower|higher|down|up)\b/.test(s) ? 'lot'
      : 'normal'

  // Taking it back beats every other reading: somebody saying "no, undo that"
  // has also said "that", and must not be read as keeping it.
  if (has('undo', 'revert', 'remove', 'take', 'cancel', 'scrap') && !has('keep')) return { kind: 'undo', size }
  if (has('nevermind', 'never')) return { kind: 'undo', size }

  // "Start that way then lower" and its many phrasings. Checked before the
  // plain less/more, because it contains them.
  const down = has('lower', 'down', 'fade', 'decrease', 'less', 'quieter', 'off')
  const up = has('higher', 'up', 'increase', 'more', 'grow', 'build')
  const overTime = has('then', 'start', 'starts', 'starting', 'begin', 'begins', 'over', 'across', 'gradually', 'slowly')
    || s.includes(' from ') || s.includes(' to ')
  if (overTime && (down || up)) return { kind: down ? 'ramp_down' : 'ramp_up', size }

  if (has('less', 'quieter', 'softer', 'subtler', 'subtle', 'gentler', 'back', 'down', 'lower')) return { kind: 'less', size }
  if (has('more', 'stronger', 'heavier', 'harder', 'up', 'higher')) return { kind: 'more', size }
  if (has('good', 'great', 'perfect', 'nice', 'lovely', 'thanks', 'thank', 'leave', 'keep')) return { kind: 'keep', size }
  return null
}

/**
 * Every word an adjustment is allowed to be made of.
 *
 * ⚠️ THE GUARD THAT MATTERS. Excluding sentences that name something was not
 * enough — with a change on the table, "turn the bass up", "take the bass up an
 * octave" and "remove the drop marker" were all read as nudges to it, because
 * each contains one of these words and the name did not match a track exactly.
 * The rule is the other way round: an adjustment is a sentence that is NOTHING
 * BUT these words. A noun in it means a new request.
 */
export const ADJUST_WORDS = new Set([
  // sizes and shapes
  'little', 'bit', 'touch', 'hair', 'slightly', 'tiny', 'lot', 'much', 'way', 'loads', 'heaps', 'far', 'bunch',
  // directions
  'less', 'more', 'lower', 'higher', 'down', 'up', 'quieter', 'louder', 'softer', 'stronger', 'subtler', 'subtle', 'gentler', 'back', 'off',
  // over time
  'then', 'start', 'starts', 'starting', 'begin', 'begins', 'over', 'across', 'gradually', 'slowly', 'come', 'comes', 'go', 'goes', 'fade', 'fades', 'ramp', 'build', 'builds', 'grow', 'decrease', 'increase',
  // taking it back
  'undo', 'revert', 'remove', 'take', 'cancel', 'scrap', 'nevermind', 'never', 'mind',
  // keeping it
  'good', 'great', 'perfect', 'nice', 'lovely', 'thanks', 'thank', 'leave', 'keep', 'yeah', 'yes', 'yep', 'sure', 'ok', 'okay', 'cool', 'sounds', 'sound',
  // pointing at it
  'that', 'this', 'it', 'them', 'those', 'these', 'one',
  // filler that survives the strip
  'lets', 'let', 'maybe', 'just', 'could', 'can', 'make', 'makes', 'do',
])

/** Is this sentence made only of the words an adjustment is made of? */
export function isBareAdjustment(words: readonly string[]): boolean {
  return words.length > 0 && words.every(w => ADJUST_WORDS.has(w))
}

export const clampAmount = (n: number) => Math.max(0, Math.min(100, Math.round(n)))

/** The strength after "a bit less" / "more" — never off the ends. */
export function stepAmount(amount: number, kind: 'less' | 'more', size: StepSize): number {
  return clampAmount(amount + (kind === 'less' ? -STEP[size] : STEP[size]))
}

/**
 * Which automatable parameter a sense's effect IS, so it can be spread over
 * time. Null where it cannot: an LFO's depth and a tone shape are not on the
 * automation list, and saying "I can do that" and then not doing it is worse
 * than saying which part is out of reach.
 */
export function rampParameter(sense: PlainSense): string | null {
  const call = sense.call('x', 50)
  const i = call.input as Record<string, unknown>
  if (call.name !== 'add_effect') return null
  const map: Record<string, string> = { filter: 'lowpass', saturator: 'drive', reverb: 'reverb', delay: 'delay' }
  return map[String(i.effect)] ?? null
}

/**
 * The ends of a ramp: it starts where the sound already is and travels from
 * there. Proportional rather than a fixed number of points, because "start
 * that way then come down" is a shape, not a distance — from 50% it should
 * land near 20%, the way Brae described it, and from 10% it should not fall
 * off the bottom of the world.
 */
export const RAMP_FACTOR = { little: 0.6, normal: 0.4, lot: 0.2 } as const

export function rampEnds(p: Proposal, kind: 'ramp_down' | 'ramp_up', size: StepSize): { from: number; to: number } {
  const from = p.amount
  const f = RAMP_FACTOR[size]
  const to = clampAmount(kind === 'ramp_down' ? from * f : Math.max(from / f, from + STEP[size]))
  return { from, to }
}

// ── Saying it ────────────────────────────────────────────────────────────────

/** "bars 1 to 9" for a span in beats, or nothing when it covers everything. */
export function describeSpan(span: { start: number; end: number } | null, beatsPerBar: number): string {
  if (!span) return ''
  const bar = (b: number) => Math.floor(b / (beatsPerBar > 0 ? beatsPerBar : 4)) + 1
  const a = bar(span.start), z = bar(Math.max(span.start, span.end - 0.001))
  return a === z ? `bar ${a}` : `bars ${a} to ${z}`
}

/**
 * The span to PLAY so a change can be judged: a couple of bars of run-up and a
 * couple after it, because a filter coming down means nothing heard on its own
 * and starting at the top of the song to reach bar 9 wastes everybody's time.
 */
export function playbackSpan(
  span: { start: number; end: number } | null,
  beatsPerBar: number,
  songEnd: number,
  leadBars = 2,
): { start: number; end: number } {
  const bar = beatsPerBar > 0 ? beatsPerBar : 4
  if (!span) return { start: 0, end: Math.max(bar, Math.min(songEnd, bar * 8)) }
  const start = Math.max(0, span.start - leadBars * bar)
  const end = Math.min(Math.max(songEnd, span.end), span.end + leadBars * bar)
  return { start, end: Math.max(start + bar, end) }
}
