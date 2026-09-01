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
import { isTriggerWord, type InterpretContext } from './commands'
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
  // ⚠️ A ratio is not enough on its own. "Turn the bass up and pan it left"
  // scored exactly 0.80 — clearing this bar — with the word "pan" left over,
  // and quietly did half of what was asked. One unexplained COMMAND WORD is
  // stronger evidence of a second command than four unexplained filler words
  // are of anything, so it is checked separately rather than averaged away.
  //
  // Worst case this sends a genuine single command to the segmenter, which
  // finds nothing better and hands the same reading back a few milliseconds
  // later. The cost of being wrong here is time; the cost of being wrong the
  // other way is a command nobody notices was dropped.
  const leftOver = whole.candidates[0]?.unexplained ?? []
  const missedCommand = leftOver.some(isTriggerWord)
  if (whole.calls.length && wholeCoverage >= 0.8 && !missedCommand) {
    return [{ text: sentence.trim(), reading: whole }]
  }

  if (words.length < MIN_WORDS) {
    return whole.calls.length ? [{ text: sentence.trim(), reading: whole }] : []
  }

  const out: Segment[] = []
  let i = 0
  // ⚠️ "IT" IN THE SECOND CLAUSE MEANS THE FIRST CLAUSE'S TRACK. "Turn the bass
  // up and pan it left" is two commands about ONE track, and the second half
  // names nothing — so on its own "pan it left" reads as nothing at all, the
  // split fails for want of a second segment, and the whole sentence falls back
  // to a single reading that does half of what was asked.
  //
  // The studio already has this idea: a selected track is what "it" means when
  // a sentence names nothing. A sentence is its own, smaller context — whatever
  // the last segment was about is what the next one means by "it".
  let ctxNow = ctx
  let carried: string | null = null
  const carryTarget = (reading: Interpretation): void => {
    const named = reading.calls
      // `target` for a command aimed at a track, `name` for one that just made
      // one — "add a track called Keys and turn it down" means turn KEYS down.
      .map(c => {
        const input = c.input as { target?: string; name?: string } | undefined
        return input?.target ?? input?.name
      })
      .find(t => typeof t === 'string' && t.trim())
    if (!named) return
    carried = named
    // ⚠️ And the track has to EXIST for the next clause. "Add a track called
    // Keys and turn it down" carries the name fine, but the volume rule needs
    // the track's current level to nudge from — and a track created a
    // millisecond ago is not in the context yet. Same staleness as planning
    // every call against the original project, one layer up.
    const known = ctxNow.tracks.some(t => (t.name ?? '').toLowerCase() === named.toLowerCase())
    ctxNow = {
      ...ctxNow,
      selectedTrackName: named,
      tracks: known ? ctxNow.tracks : [...ctxNow.tracks, { id: `pending-${named}`, name: named, volume: 0.8, pan: 0 }],
    }
  }
  while (i < words.length && out.length < MAX_SEGMENTS) {
    let taken = 0
    // Longest first. A shorter span that also reads as a command is a worse
    // answer, not a different one — "mute the bass" inside "mute the bass 2"
    // is the same command aimed at the wrong track.
    for (let j = words.length; j > i; j--) {
      const span = words.slice(i, j).join(' ')
      const reading = interpret(span, ctxNow)
      if (!reading.calls.length) continue
      // ⚠️ A PRONOUN WHOSE REFERENT WAS JUST NAMED IS NOT A GUESS. A reading
      // that leans on the selected track scores lower than one that names it —
      // rightly, in isolation, because the selection might be stale. Inside a
      // sentence it is the opposite: "turn the bass up and pan it left" said
      // "bass" a breath ago, in this same sentence, and there is nothing
      // ambiguous about "it".
      //
      // Without this the second clause read perfectly — full coverage, no
      // corrections — and was thrown out for scoring 0.85 against a bar of
      // 0.88, so the sentence collapsed back to doing only its first half.
      //
      // The relaxation is narrow on purpose: only after a segment has already
      // been taken, and only when this reading is about THAT SAME track.
      const refersToCarried = carried != null
        && reading.calls.some(c => {
          const t = (c.input as { target?: string } | undefined)?.target
          return typeof t === 'string' && t.toLowerCase() === carried!.toLowerCase()
        })
      const bar = out.length && refersToCarried ? SEGMENT_CONFIDENCE - 0.05 : SEGMENT_CONFIDENCE
      if (reading.confidence < bar) continue
      // The span has to be about itself. A command found inside a longer run of
      // words it cannot explain is the search finding what it went looking for.
      const top = reading.candidates[0]
      if ((top?.coverage ?? 0) < 0.75) continue
      // ⚠️ And the same rule as the whole sentence, for the same reason: a span
      // that leaves a COMMAND WORD unexplained is not one command, it is two
      // with the second thrown away. Without this the longest span — the entire
      // sentence — was taken as segment one and there was never a segment two.
      if ((top?.unexplained ?? []).some(isTriggerWord)) continue
      // And it has to be about itself WITHOUT being bent into shape. Reading
      // every span of a sentence gives a near-miss many more chances to land:
      // "that take was better than the LAST one" offered the word "last", which
      // is one letter from "fast", and the studio was about to answer a question
      // about the tempo. A correction is weak evidence on its own and hopeless
      // evidence in the middle of a sentence about something else.
      if ((reading.corrections ?? 0) > 0) continue
      out.push({ text: span, reading })
      carryTarget(reading)
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
