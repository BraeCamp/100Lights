'use client'
// ── Interpreting a sentence, rather than matching one ───────────────────────
//
// Brae: "The voice detection is pretty bad... Can we have the machine interpret
// sentences?"
//
// Those two are the same problem. The first resolver matched whole utterances
// against anchored patterns — /^(restart|start over|from the top)$/ — which
// works when the transcript is perfect and fails completely when it is not. And
// a transcript is never perfect: it arrives with a filler word in front, a
// politeness on the end, a swallowed article, a homophone in the middle.
//
// The second version fixed that by reading content words and bending anything
// within one edit of a command word. Which introduced the opposite failure, and
// Brae named it: "I see that words are correcting from other words, but why
// don't we have overlapping possible changes, a context check between different
// versions before correction... this way nothing will correct to another word
// without a context check."
//
// The bug that proves the point: "bass" is one edit from "bars". Reading a
// sentence greedily, the filter rule bent "bass" into "bars", deleted it as a
// unit of time, and then found no track — while the project sat there with a
// track called Bass 2 in it. The information needed to reject that correction
// existed; the parser had already thrown it away.
//
// So this file no longer takes the first rule that says yes. EVERY rule reads
// the sentence, each producing a candidate along with what it had to assume,
// and the candidates are compared against each other and against the project
// before any of them is believed. A correction now has to win an argument.
//
// It is deliberately not clever. It knows a fixed set of intents and looks for
// evidence of each; anything it cannot place, it declines and hands on. The rule
// stays what it always was: a wrong local answer is worse than a slow correct
// one.

import {
  VOICE_COMMANDS, nameWords, COMMAND_VOCABULARY, NEVER_SUBSTITUTE,
  type InterpretContext,
} from './commands'
import { hypotheses, type Heard, type Hypothesis } from './hypotheses'
import { Words } from './words'
import type { VoiceCall } from './execute-music'

export { COMMAND_VOCABULARY, NEVER_SUBSTITUTE, commandHelp, VOICE_COMMANDS, COMMANDS_BY_ID, UNORDERED_COMMANDS } from './commands'
export { contentWords, FILLER } from './words'
export { hypotheses, phoneticKey, editDistance } from './hypotheses'
export type { Heard, Hypothesis } from './hypotheses'
export type { InterpretContext } from './commands'

export interface Candidate {
  /** Which rule read it this way. */
  id: string
  calls: VoiceCall[]
  /** The rule's own certainty. */
  confidence: number
  /** How much of the sentence this reading accounts for, 0–1. */
  coverage: number
  /** How many words it had to bend, and by how much. */
  corrections: number
  /** Everything the reading could not explain. */
  unexplained: string[]
  /** The combined judgement the winner is chosen on. */
  score: number
  needsName: boolean
}

export interface Interpretation {
  calls: VoiceCall[]
  confidence: number
  /** Which rule fired — its id, or 'none'. */
  matched: string
  needsName: boolean
  /** True when the command destroys work and should be confirmed first. */
  destructive?: boolean
  /**
   * How much this reading had to assume.
   *
   * Surfaced because it is a different question from confidence. A rule can be
   * perfectly certain of what it read while having reached that reading only by
   * discarding a word that names a real track — and a reading built on bending
   * a name is exactly the one to ask about rather than act on.
   */
  corrections: number
  /**
   * Other readings that were nearly as good.
   *
   * Present only when the decision was CLOSE. An empty list means the winner
   * won clearly; a non-empty one means the sentence was genuinely ambiguous and
   * the right move is to ask which was meant rather than to act confidently on
   * a coin flip.
   */
  alternatives: Candidate[]
  /** Every reading, best first. For the log and for tests. */
  candidates: Candidate[]
  /**
   * The sentence this reading is OF.
   *
   * Usually the transcript. When a rewritten hypothesis won, this is the
   * rewritten sentence — and `rewrittenFrom` says what was actually heard, so a
   * read-back can admit to the substitution rather than quietly acting on a
   * sentence nobody said.
   */
  text?: string
  rewrittenFrom?: string
  /** Why the rewrite was proposed, when there was one. */
  rewriteReason?: string
}

const NOTHING: Interpretation = {
  calls: [], confidence: 0, matched: 'none', needsName: false,
  corrections: 0, alternatives: [], candidates: [],
}

/**
 * How good is this reading?
 *
 * Three things, in the order they matter:
 *
 *   THE RULE'S OWN CONFIDENCE. Some commands are simply less certain than
 *   others even when read perfectly.
 *
 *   COVERAGE. A reading that explains the whole sentence beats one that
 *   explains a third of it and shrugs at the rest. This is what stops "play the
 *   bass louder" being read as "play": both rules match, but one accounts for
 *   three words and the other for one.
 *
 *   CORRECTIONS. Every bent word is evidence against the reading that needed
 *   it. This is the context check — a reading that takes the sentence at its
 *   word beats one that had to rewrite it, so a correction only wins when
 *   nothing truer was available.
 *
 * The weights are deliberately gentle. Coverage moves the score by up to 45%
 * and each correction costs 8%, which is enough to settle a close call and not
 * enough to let a well-covered wrong reading beat a confident right one.
 */
function scoreOf(confidence: number, coverage: number, corrections: number): number {
  return confidence * (0.55 + 0.45 * coverage) - 0.08 * corrections
}

/** Below this gap, two readings are too close to call and the sentence is
 *  treated as ambiguous rather than decided by a hair. */
const AMBIGUOUS_MARGIN = 0.05

/**
 * Read a sentence and produce commands, or decline.
 *
 * Every rule gets the sentence. The best-scoring reading wins; if the runner-up
 * is within a hair of it, both are returned so the caller can ask instead of
 * guessing.
 */
export function interpret(sentence: string, ctx: InterpretContext): Interpretation {
  // Tell the sentence which of its words name something in this project BEFORE
  // any rule reads it. This is the context check: from here on, a rule that
  // wants to hear "bass" as "bars" is charged for discarding a real name, and
  // any reading that keeps the name intact beats it.
  const words = new Words(sentence).protecting(nameWords(ctx))
  if (!words.length) return NOTHING

  const candidates: Candidate[] = []
  for (const command of VOICE_COMMANDS) {
    // A fresh tally per rule: what THIS reading consumed and bent, independent
    // of what every other rule made of the same words.
    const w = words.fork()
    let hit
    try {
      hit = command.match(w, ctx)
    } catch {
      // A rule that throws is a bug in that rule, not a reason to fail the
      // whole utterance — another reading may well be waiting, and falling
      // through to a confirmation beats an error where a command should be.
      continue
    }
    if (!hit || !hit.calls.length) continue
    const coverage = w.coverage()
    candidates.push({
      id: command.id,
      calls: hit.calls,
      confidence: hit.confidence,
      coverage,
      corrections: w.corrections,
      unexplained: w.unexplained(),
      score: scoreOf(hit.confidence, coverage, w.corrections),
      needsName: hit.needsName ?? false,
    })
  }

  if (!candidates.length) return NOTHING

  // Best first. Ties break on the registry's declared precedence, which is the
  // order they were tried in — so an exact tie is resolved the same way every
  // time rather than by whichever happened to be pushed first.
  candidates.sort((a, b) => b.score - a.score)
  const best = candidates[0]
  const runnersUp = candidates
    .slice(1)
    .filter(c => best.score - c.score < AMBIGUOUS_MARGIN)
    // Two rules that produce the SAME command from the same sentence are not an
    // ambiguity worth asking about — they agree.
    .filter(c => JSON.stringify(c.calls) !== JSON.stringify(best.calls))

  const command = VOICE_COMMANDS.find(c => c.id === best.id)
  return {
    calls: best.calls,
    confidence: best.confidence,
    matched: best.id,
    needsName: best.needsName,
    corrections: best.corrections,
    destructive: command?.destructive,
    alternatives: runnersUp,
    candidates,
  }
}

// ── Reading what was heard, without first deciding what that was ────────────

/**
 * How much a rewritten sentence is penalised for not being what was heard.
 *
 * The transcript is the only direct evidence of what was said. A rewrite has to
 * be a substantially better fit for the project before it wins, or the system
 * starts hearing what it expects instead of what it was told — which is a much
 * worse failure than not understanding, because it is confident and silent.
 */
const REWRITE_PENALTY = 0.25

/**
 * A rewritten sentence must explain nearly all of itself.
 *
 * This is the guard that stops a wide net manufacturing commands out of
 * ordinary speech, and it was found the hard way: "what time is it" became
 * "halt time is it" and stopped the transport, and "the drums are too loud in
 * the room" soloed the drums. Both readings were cheap, and both explained
 * about half the sentence — the other half being the words that made it obvious
 * nobody was giving a command.
 *
 * The rule that separates the two cases cleanly: if a word had to be rewritten
 * AND the result still cannot account for the rest of the sentence, the reading
 * is an artefact of the search rather than a recovery of what was said. A real
 * mishearing — "moot the drums" — explains every word once the one bad word is
 * put right.
 */
const REWRITE_MIN_COVERAGE = 0.7

/**
 * Interpret an utterance, considering every sentence it might have been.
 *
 * Brae: "it's okay to have the system recognize multiple possible words from
 * the audio instead of deciding on one... the idea of widening the net to find
 * the solution is there."
 *
 * So the recogniser's single answer is treated as its best guess rather than as
 * the truth. Each plausible sentence is read in full, and the winner is the
 * reading that best explains a sentence that could plausibly have been said —
 * with what it cost to assume that sentence counted against it.
 *
 * This is the same argument as the rule-level one, one layer up: nothing is
 * corrected without something else getting the chance to disagree.
 */
export function interpretHeard(heard: Heard, ctx: InterpretContext): Interpretation {
  // The project's own track names belong in the substitution vocabulary. They
  // are exactly the words a general-purpose recogniser has never seen and is
  // most likely to have mangled, and the only place they exist is here.
  const banned = new Set(NEVER_SUBSTITUTE)
  const vocabulary = [
    ...COMMAND_VOCABULARY,
    ...[...nameWords(ctx)],
  ].filter(word => !banned.has(word))
  const options: Hypothesis[] = hypotheses(heard, vocabulary)
  if (!options.length) return NOTHING

  let best: { reading: Interpretation; option: Hypothesis; score: number } | null = null
  for (const option of options) {
    const reading = interpret(option.text, ctx)
    if (!reading.calls.length) continue
    const top = reading.candidates[0]
    // A rewrite is held to a higher standard than the words actually heard: it
    // has to explain the sentence it invented, not merely find a command in it.
    if (option.cost > 0 && (top?.coverage ?? 0) < REWRITE_MIN_COVERAGE) continue
    const score = (top?.score ?? 0) - REWRITE_PENALTY * option.cost
    if (!best || score > best.score) best = { reading, option, score }
  }
  if (!best) {
    // Nothing could be read out of any of them. Return the reading of what was
    // actually heard, so the caller shows the speaker their own words rather
    // than a rewrite that also failed.
    return { ...interpret(heard.text, ctx), text: heard.text }
  }

  const rewritten = best.option.cost > 0
  return {
    ...best.reading,
    text: best.option.text,
    rewrittenFrom: rewritten ? heard.text : undefined,
    rewriteReason: rewritten ? best.option.why : undefined,
  }
}
