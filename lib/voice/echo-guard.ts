// Light hearing itself.
//
// The record, 22:03–22:05: "Restart." ×3, "Pause." ×5. The read-back was the
// command word, the room played it back into the microphone, and the rules ran
// it again. The read-backs no longer use command words, and this is the second
// guard: within a few seconds of Light speaking, a transcript that IS what it
// just said is its own echo, not the person.
//
// ⚠️ "Contains" was too wide in both directions. The guard used to drop any
// transcript that contained the read-back, or was contained by it — so after
// Light said "Rhodes", "change the preset to Rhodes" was thrown away as an
// echo, and after "Which one, Bass 2 or the pad?" the answer "Bass 2" was too.
// A person saying MORE than the read-back is a person; an answer that happens
// to be a word from the question is an answer. An echo is the read-back heard
// whole, give or take a little room noise.

/** How long after Light speaks its own words can still come back. */
export const ECHO_WINDOW_MS = 8_000

/** The most extra characters an echo may carry around the read-back. */
const ECHO_SLACK = 8

/** How much of the read-back a shorter transcript must cover to be its echo. */
const ECHO_COVERAGE = 0.6

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()

/**
 * Is `text` Light's own read-back coming back through the microphone?
 *
 * `lastSpoken` is what Light last said out loud; `msSinceReply` how long ago.
 */
export function isEchoOfReadBack(text: string, lastSpoken: string, msSinceReply: number): boolean {
  if (msSinceReply < 0 || msSinceReply > ECHO_WINDOW_MS) return false
  const heard = norm(text), spoke = norm(lastSpoken)
  if (heard.length < 4 || spoke.length < 4) return false
  if (heard === spoke) return true
  // A piece of the read-back — but MOST of it, so a one-word answer that also
  // appears inside a long read-back is not mistaken for the read-back.
  if (spoke.includes(heard)) return heard.length >= spoke.length * ECHO_COVERAGE
  // The read-back with a little around it — a breath, a click, a syllable of
  // room — but not a sentence that merely mentions the same word.
  if (heard.includes(spoke)) return heard.length <= spoke.length + ECHO_SLACK
  return false
}
