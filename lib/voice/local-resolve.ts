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
import { interpret, type InterpretContext } from './interpret'

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
}

export type ResolveContext = InterpretContext

/** Read a sentence and produce commands, or decline. */
export function resolveLocally(sentence: string, ctx: ResolveContext): LocalResult {
  return interpret(sentence, ctx)
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
  return heardConfidence >= needed
}
