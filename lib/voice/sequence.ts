'use client'
// ── More than one command in a breath ───────────────────────────────────────
//
// Brae: "it looks like it's seeing commands in separate lines and has trouble
// differentiating where they start if there isn't a substantial pause between
// things. Can you make it so that the commands would work even in a continuous
// transcript instead of needing the pauses between commands?"
//
// The whole pipeline assumed one utterance was one command, and enforced it
// with silence: the level detector cut a take when somebody stopped talking, so
// two commands run together arrived as one sentence and were read as one thing —
// usually as nothing at all, because "mute the drums set the tempo to 120" is
// not a command anybody wrote a rule for.
//
// Requiring a pause is a bad bargain. It is a rule about how to TALK, imposed
// to make the parser's life easier, and it is exactly the sort of thing that
// makes a voice interface feel like operating machinery.
//
// So a transcript is read as a SEQUENCE. Longest match first, left to right:
// take the longest run of words from here that reads as a command, emit it,
// carry on from where it ended. Longest-first is what stops "mute the bass 2"
// being split into "mute the bass" and a stray 2 — the longer reading is tried
// before the shorter one and wins by existing.
//
// A single command is the ordinary case and stays exactly as it was: the first
// and longest span is the whole sentence, one segment comes back, and nothing
// downstream can tell this file ran.

import { interpret, type Interpretation } from './interpret'
import type { InterpretContext } from './commands'
import { contentWords } from './words'

/** How sure a span must be to be taken as a command in its own right. Higher
 *  than the single-command bar: cutting a sentence in the wrong place produces
 *  two confident wrong answers instead of one honest failure. */
const SEGMENT_CONFIDENCE = 0.88

/** The most commands one breath may contain. Somebody who really does say six
 *  things in a row can say them in two breaths, and a cap stops a long stretch
 *  of conversation being mined for anything that looks like an instruction. */
const MAX_SEGMENTS = 5

/** Below this many words there is nothing to split. */
const MIN_WORDS = 4

export interface Segment {
  /** The words this command was read from. */
  text: string
  reading: Interpretation
}

/**
 * Read a transcript as one command, or as several.
 *
 * Returns a single segment for the ordinary case, so callers can treat one and
 * many the same way. Returns nothing when no span reads as a command at all.
 */
export function interpretSequence(sentence: string, ctx: InterpretContext): Segment[] {
  const words = contentWords(sentence)

  // The ordinary case, tried first and whole — but only accepted when the
  // sentence EXPLAINS ITSELF. A reading that finds one command and shrugs at
  // the other half is exactly what made "mute the drums set the tempo to 120"
  // mute the drums and silently discard the tempo: it matched, so nothing
  // looked further.
  const whole = interpret(sentence, ctx)
  const wholeCoverage = whole.candidates[0]?.coverage ?? 0
  if (whole.calls.length && wholeCoverage >= 0.8) {
    return [{ text: sentence.trim(), reading: whole }]
  }

  if (words.length < MIN_WORDS) {
    return whole.calls.length ? [{ text: sentence.trim(), reading: whole }] : []
  }

  const out: Segment[] = []
  let i = 0
  while (i < words.length && out.length < MAX_SEGMENTS) {
    let taken = 0
    // Longest first. A shorter span that also reads as a command is a worse
    // answer, not a different one — "mute the bass" inside "mute the bass 2"
    // is the same command aimed at the wrong track.
    for (let j = words.length; j > i; j--) {
      const span = words.slice(i, j).join(' ')
      const reading = interpret(span, ctx)
      if (!reading.calls.length) continue
      if (reading.confidence < SEGMENT_CONFIDENCE) continue
      // The span has to be about itself. A command found inside a longer run of
      // words it cannot explain is the search finding what it went looking for.
      const top = reading.candidates[0]
      if ((top?.coverage ?? 0) < 0.75) continue
      // And it has to be about itself WITHOUT being bent into shape. Reading
      // every span of a sentence gives a near-miss many more chances to land:
      // "that take was better than the LAST one" offered the word "last", which
      // is one letter from "fast", and the studio was about to answer a question
      // about the tempo. A correction is weak evidence on its own and hopeless
      // evidence in the middle of a sentence about something else.
      if ((reading.corrections ?? 0) > 0) continue
      out.push({ text: span, reading })
      taken = j - i
      i = j
      break
    }
    // Nothing here starts a command. Step over one word and try again — the
    // first word of a run is often a stray from the end of the last thought.
    if (!taken) i++
  }

  // Segmenting found nothing better than the partial reading of the whole. That
  // reading is still the best answer available, and refusing it here would mean
  // a sentence that used to work stopped working the moment this file existed.
  if (out.length < 2 && whole.calls.length) {
    return [{ text: sentence.trim(), reading: whole }]
  }
  return out
}

/**
 * Is this worth telling the caller about as a sequence?
 *
 * One segment is just a command and should travel the ordinary path. Two or
 * more is the case this file exists for.
 */
export function isSequence(segments: Segment[]): boolean {
  return segments.length > 1
}
