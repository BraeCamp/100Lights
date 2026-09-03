// Putting a sentence back together after it was cut in half.
//
// Brae: "when I talk more slowly it thinks that I'm saying different sentences.
// It should hold on to older transcription for longer so that it can process
// and correct slower speaking, or a break in speaking."
//
// ⚠️ WAITING LONGER CANNOT FIX THIS ON ITS OWN, because on one of the two
// platforms we do not own the clock. The recorder path ends a take with our own
// VAD, which already waits 2.2 seconds for a sentence — but a browser using
// SpeechRecognition is endpointed by the BROWSER, on its own timing, and it
// hands over a finished transcript whenever it decides the speaker stopped.
// Chrome does that well under a second, and there is no setting for it. So the
// repair has to live above both paths, where the words are, rather than in the
// thing that decides when they end.
//
// The rule is deliberately narrow, because joining two sentences that were
// meant to be separate is a much worse failure than not joining one that was
// split: it would run a command nobody asked for. So a fragment is only ever
// held when the studio could make NOTHING of it — when the alternative is
// "I didn't catch that" and the words are about to be thrown away regardless.
// Held text is offered to the next utterance and, if the two together read as a
// command when neither did alone, that is what was said.

/** How long a held fragment stays worth joining to. */
export const STITCH_MS = 6_000

export interface Fragment {
  text: string
  at: number
}

/**
 * Join a held fragment to what came next, if that is plausible.
 *
 * Returns the joined sentence, or null to leave the new text alone.
 */
export function stitch(held: Fragment | null, text: string, now: number): string | null {
  if (!held) return null
  const gap = now - held.at
  // ⚠️ A negative gap means the clock moved backwards or the fragment came from
  // a previous session — either way it is not a pause in a sentence.
  if (gap < 0 || gap > STITCH_MS) return null

  const a = held.text.trim()
  const b = text.trim()
  if (!a || !b) return null

  // ⚠️ Somebody who repeats themselves is not continuing a sentence. Without
  // this, saying it again after a failure produced "mute the drums mute the
  // drums", which reads as neither.
  if (a.toLowerCase() === b.toLowerCase()) return null

  // A fragment that already ended in a sentence stop was a whole thought; the
  // recogniser only punctuates where it heard one finish.
  if (/[.?!]$/.test(a)) return null

  // Two long halves are far more likely to be two sentences than one that was
  // cut. A real cut leaves at least one side short.
  if (words(a) > 12 && words(b) > 12) return null

  return `${a} ${b}`
}

function words(s: string): number {
  return s.split(/\s+/).filter(Boolean).length
}

/**
 * Does this trail off — half a sentence, with the rest still to come?
 *
 * Brae: "if a transcript is made after saying 'On Pad Intro...' then there's a
 * 3 second wait, 'descend the volume from 100% to 60%'. That is a broken up
 * sentence but the same idea."
 *
 * ⚠️ THIS IS WHAT LETS THE SILENCE TAIL BE SHORT. With the recorder waiting
 * 1.2 seconds instead of 2.2, a thinking pause cuts a sentence in half more
 * often — so the half has to be recognised as a half. The tell is that it has
 * no verb: "on pad intro", "the drums", "and then at bar 9" are all places and
 * things with nothing to do to them yet. A fragment like that is held quietly
 * rather than sent anywhere, because the alternative is a PAID turn spent asking
 * "what about the pad intro?" — a question the speaker was about to answer
 * anyway.
 *
 * Narrow on purpose. "stop" has a verb and is finished. "the reverb is too much"
 * has one too. Only a fragment with nothing to DO in it waits.
 */
const VERB = /\b(add|put|make|set|change|turn|move|copy|delete|remove|mute|unmute|solo|play|stop|start|restart|pause|loop|undo|redo|open|close|show|give|bring|take|drop|raise|lower|descend|ascend|fade|sweep|ramp|automate|double|halve|split|join|rename|call|save|export|render|freeze|duplicate|reverse|swing|quantize|quantise|transpose|pan|filter|compress|duck|draw|write|record|arm|select|focus|zoom|scroll|go|jump|seek|browse|hear|describe|is|are|was|has|have|do|does|can|could|would|should|want|need|keep|leave|let|try|use|apply|run|repeat|increase|decrease|boost|cut|brighten|darken|widen|narrow|shorten|lengthen|extend|hold|stay|stays|goes|comes|gets|sounds|louder|quieter|brighter|darker|faster|slower)\b/i
const TRAILS_OFF = /\b(and|then|to|on|at|from|with|for|of|the|a|an|but|so|or|into|onto|over|under|between|until|till|by)$/i

export function looksIncomplete(text: string): boolean {
  const t = text.trim().replace(/[.…]+$/, '')
  if (!t) return false
  const n = words(t)
  if (n > 12) return false                 // a paragraph is not a fragment
  if (/[?!]$/.test(t)) return false        // a question or an exclamation is whole
  if (TRAILS_OFF.test(t)) return true      // ended mid-phrase
  return !VERB.test(t)                     // a thing or a place, with nothing to do to it
}

/**
 * Is this worth holding on to?
 *
 * Only text the studio could not read at all. Anything it understood has
 * already been acted on, and joining the NEXT sentence to a command that
 * already ran would be inventing a request.
 */
export function worthHolding(text: string, understood: boolean): boolean {
  if (understood) return false
  const n = words(text)
  // ⚠️ One word is the shape of a false start ("um", "the"), and also of a
  // command that simply is not one ("banana"). Both are worth holding: the
  // first completes, and the second joins into something that still fails.
  // Beyond about a dozen words it was a whole sentence that was not understood,
  // and the problem is comprehension, not a pause.
  return n >= 1 && n <= 12
}
