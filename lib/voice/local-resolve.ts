'use client'
// ── Answering a command without asking anyone ───────────────────────────────
//
// Brae: "Connect AI for now ... whenever something is said and the program has
// low confidence in hearing it or in its answer then we can put AI on it ... it
// would run the answer through the voice program's wiring so that it's already
// wired for switching the answer to the program instead of AI."
//
// The swap point is the shape everything downstream consumes: `VoiceCall[]` —
// `{ name, input }` — which planVoiceCalls takes without caring whether a model
// or a parser produced it. So the assistant is the CURRENT IMPLEMENTATION of one
// step, not the feature.
//
// This file is the entry point and the confidence policy. The PARSING lives in
// ./interpret, which replaced a set of anchored regular expressions —
// /^(restart|start over|from the top)$/ and friends. Those matched a perfect
// transcript and nothing else, and a transcript is never perfect: it arrives
// with a filler word in front, a politeness on the end, a swallowed article, a
// homophone in the middle. Every one of those turned an exact match into no
// match, and no match into a paid round trip.

import type { VoiceCall } from './execute-music'
import { interpret, interpretHeard, type InterpretContext } from './interpret'
import type { Heard } from './hypotheses'

export interface LocalResult {
  calls: VoiceCall[]
  /** 0–1. Anything the caller does not fully trust should go to the assistant. */
  confidence: number
  /** Which rule fired, for the log and for knowing what to promote next. */
  matched: string
  /**
   * Did this depend on resolving a spoken TRACK NAME?
   *
   * The distinction decides how much the transcriber's own confidence matters.
   * A rule that matched the whole utterance against a fixed vocabulary carries
   * its own proof; one that had to find "the pad" among the project's tracks is
   * only as good as the words it was given.
   */
  needsName: boolean
  /**
   * Readings that were nearly as good as the winner.
   *
   * A non-empty list means the sentence was genuinely ambiguous. Acting on the
   * winner would be a coin flip presented as a decision, so the caller asks
   * instead.
   */
  alternatives?: { id: string; calls: VoiceCall[] }[]
  /** When the winning reading was of a REWRITTEN sentence: what was actually
   *  heard, and what changed. A read-back that hides a substitution is how a
   *  system quietly trains someone to distrust it. */
  rewrittenFrom?: string
  rewriteReason?: string
  /** The sentence the winning reading is of. */
  text?: string
  /**
   * Does this destroy work?
   *
   * Deleting a track cannot be undone by saying the opposite, and voice is
   * exactly the input that arrives misheard — so the caller reads it back and
   * waits for a press. Same shape as the credit barrier, same reasoning.
   */
  destructive?: boolean
  /** How much the reading had to assume to get there. */
  corrections?: number
}

export type ResolveContext = InterpretContext

/** Read a sentence and produce commands, or decline. */
export function resolveLocally(sentence: string, ctx: ResolveContext): LocalResult {
  return interpret(sentence, ctx)
}

/**
 * Read an UTTERANCE — everything the recogniser reported, not just the sentence
 * it settled on.
 *
 * Preferred over resolveLocally wherever the recogniser's own output is to
 * hand, because the extra information is exactly what makes a mishearing
 * recoverable: which words it doubted, and what else it considered. Passing
 * only the text throws that away before anything can use it.
 */
export function resolveHeard(heard: Heard, ctx: ResolveContext): LocalResult {
  return interpretHeard(heard, ctx)
}

/**
 * Is this good enough to run without asking the assistant?
 */
export function confidentEnough(local: LocalResult, heardConfidence: number): boolean {
  if (!local.calls.length || local.confidence < 0.85) return false

  // ── How sure the transcriber needs to be depends on what matched ──────────
  //
  // Brae, after saying "start" and being told the AI was out of credits: "it
  // should be a non-AI response — it should have high confidence after running
  // through the existing program that it already knows the command."
  //
  // He is right, and the first version got this wrong by treating both signals
  // as one flat AND. A transcriber reports LOW confidence on short utterances
  // as a matter of course — "start" is one syllable with no context to check
  // itself against, and Deepgram routinely rates it below 0.75 — so a single
  // hard threshold sent the simplest, most-used commands in the studio to a
  // model, which is the exact opposite of the intent.
  //
  // The insight is that recognising the command IS the confirmation. "start" is
  // not a word the parser half-recognised; it is a sentence whose content words
  // place it, unambiguously, among a dozen known commands. For a mishearing to
  // produce that, the speaker would have had to say something landing on
  // another known command — and the cost of that is a transport button pressed,
  // which is instantly obvious and instantly undone.
  //
  // A NAME is the opposite case. "mute the pad" is only as good as the word
  // "pad", the project has a dozen candidates, and muting the wrong track is
  // quiet and easy to miss. That one still wants the transcriber to be sure.
  const needed = local.needsName ? 0.6 : 0.3
  if (heardConfidence < needed) return false

  // ── A close second reading is a reason to ask ─────────────────────────────
  //
  // Confidence answers "how sure am I of this reading". It cannot answer "was
  // there another reading just as good", and that is a different question with
  // a different right answer: two readings within a hair of each other mean the
  // sentence was ambiguous, and acting on the winner is a coin flip dressed up
  // as a decision. The alternatives are surfaced instead, so the choice goes to
  // the person who knows which they meant.
  if (local.alternatives?.length) return false

  // ── A reading built on bending a name is not a confident reading ──────────
  //
  // Brae: "nothing will correct to another word without a context check."
  //
  // Bending a word that names a real track costs three corrections — enough
  // that any competing reading wins, but a sentence can arrive with no
  // competitor at all. "sole the vocals", in a project that has a track called
  // Sole, has exactly one reading: solo the vocals, reached by deciding that
  // "Sole" was a mispronounced "solo". That may well be right, and it is not
  // something to do silently while a track by that name sits in the project.
  //
  // So the cost is checked as well as compared. Above the price of one bent
  // name, the reading is offered rather than performed.
  if ((local.corrections ?? 0) >= 2) return false

  return true
}


/**
 * The commands that must never wait for a model.
 *
 * Brae: "When AI mode is enabled, is it still using the rules for the non AI
 * variant? It shouldn't be doing that, instead letting the AI do the work."
 *
 * It was, for everything — the local reading ran first whenever it was
 * confident, and the assistant never saw the sentence. That is how "change the
 * name of the item drums 1 to drums 2" became a TIME SIGNATURE with AI mode on:
 * no model was involved in that decision at all.
 *
 * ⚠️ But not everything should go to a model. "Stop" has to stop NOW — a
 * round-trip is another second of a song playing while somebody waits — and
 * these are the ones where latency IS the experience and the action is
 * trivially undone. Everything else, including anything that edits the song,
 * goes to the assistant when the assistant is on.
 *
 * Keep this list SHORT. Every name on it is a sentence the model never gets to
 * read, which is the shape of the bug above.
 */
export const INSTANT_COMMANDS: ReadonlySet<string> = new Set([
  'transport', 'metronome', 'undo', 'redo',
])

/**
 * Should the local reading run, or should this go to the assistant?
 *
 * In 'rules' mode the local reading IS the studio and nothing changes. With the
 * assistant on, the rules step back to the instant commands above.
 */
export function runsLocally(
  local: LocalResult,
  heardConfidence: number,
  assistant: 'rules' | 'ask' | 'auto',
): boolean {
  if (!confidentEnough(local, heardConfidence)) return false
  if (assistant === 'rules') return true
  return local.calls.length > 0 && local.calls.every(c => INSTANT_COMMANDS.has(c.name))
}


/**
 * Commands that do not need a project open.
 *
 * Brae: "I'll say a command like 'Create new project' and it will say [there is
 * no project open], which means that it should work while not in a project."
 *
 * ⚠️ Exactly right, and the gate was too broad: it refused EVERY command
 * outside the studio, including the ones whose whole purpose is to get you into
 * one. Going somewhere, opening or starting a project, asking what is in your
 * library, asking what Light can do — none of those touch a song.
 *
 * The list is the small closed set that genuinely works with no project. Adding
 * a song command here would mean a command that reports success against an
 * empty project, which is the failure this codebase keeps finding.
 */
export const WORKS_ANYWHERE: ReadonlySet<string> = new Set([
  'open_editor',      // navigation: "open the video module", "take me to my projects"
  'project_action',   // "open Winter Drift", "start a new project"
  'describe',         // the library, and "what can you do"
  'transport',        // harmless with nothing loaded, and never surprising
  'metronome',
  'undo', 'redo',
])

/** Can this reading run with no project open? */
export function needsNoProject(calls: { name: string }[]): boolean {
  return calls.length > 0 && calls.every(c => WORKS_ANYWHERE.has(c.name))
}
