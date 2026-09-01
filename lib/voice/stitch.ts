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
