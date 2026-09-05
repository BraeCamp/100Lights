/**
 * Punch in and punch out — recording that only happens inside the loop brace.
 *
 * The point of punching is to fix one phrase in the middle of a take without
 * touching what is either side of it. You play along from a few bars early,
 * the recorder starts by itself at the brace, it stops by itself at the end of
 * the brace, and the rest of the performance is never at risk. Doing that by
 * hand means hitting record on the beat and stopping on the beat, which is the
 * one thing you cannot do while you are playing.
 *
 * The punch region IS the loop brace, whether or not Loop is switched on. That
 * is a deliberate reuse rather than a second pair of markers to drag: the brace
 * is already how you say "this part of the song" everywhere else in Beacon, and
 * a punch region that could disagree with it would be a bug generator.
 *
 * This module is pure and works in beats. It decides WHEN, and nothing else —
 * the engine arms itself from the plan (lib/daw-engine.ts `armPunch`) and the
 * transport reads it to say what is about to happen.
 */

export interface PunchState {
  /** Wait for the brace before the recorder starts. */
  punchIn?: boolean
  /** Stop the recorder at the end of the brace. */
  punchOut?: boolean
  loopStart: number
  loopEnd: number
}

export interface PunchPlan {
  /** Beat the take starts at. `null` = the moment record is pressed. */
  startAt: number | null
  /** Beat the take stops at. `null` = when you press stop. */
  stopAt: number | null
  /**
   * Set when arming would record nothing at all. The take is refused rather
   * than started, because a recorder that runs and captures silence looks
   * exactly like one that is working.
   */
  refused?: string
}

const bar = (beat: number, beatsPerBar: number) => Math.floor(beat / (beatsPerBar > 0 ? beatsPerBar : 4)) + 1

/** Is either punch switched on? */
export function punchArmed(s: PunchState): boolean {
  return Boolean(s.punchIn || s.punchOut)
}

/**
 * When the recorder should start and stop, given where the playhead is now.
 *
 * The playhead matters because punching is a live decision: pressing record
 * with the playhead already inside the brace means "start now", not "wait for
 * the next pass" — waiting would silently discard the take somebody just
 * played. Past the brace entirely is the one case with no sensible reading, so
 * it is refused out loud.
 */
export function planPunch(s: PunchState, playhead: number, beatsPerBar = 4): PunchPlan {
  if (!punchArmed(s)) return { startAt: null, stopAt: null }

  if (!(s.loopEnd > s.loopStart)) {
    return { startAt: null, stopAt: null, refused: 'The punch region is empty — drag the loop brace over the part you want to record.' }
  }
  if (playhead >= s.loopEnd) {
    const what = s.punchIn ? 'punch-in' : 'punch-out'
    return { startAt: null, stopAt: null, refused: `The playhead is past the ${what} region — move it before bar ${bar(s.loopEnd, beatsPerBar)}.` }
  }

  // Already inside the brace: roll now. Only a playhead BEFORE it waits.
  const startAt = s.punchIn && playhead < s.loopStart ? s.loopStart : null
  const stopAt  = s.punchOut ? s.loopEnd : null
  return { startAt, stopAt }
}

/** What the punch settings will do, in words, for the transport and for Light. */
export function describePunch(s: PunchState, beatsPerBar = 4): string {
  if (!punchArmed(s)) return 'Recording starts and stops when you say so'
  const from = `bar ${bar(s.loopStart, beatsPerBar)}`
  const to   = `bar ${bar(s.loopEnd, beatsPerBar)}`
  if (s.punchIn && s.punchOut) return `Recording runs from ${from} to ${to}`
  if (s.punchIn)  return `Recording starts at ${from}`
  return `Recording stops at ${to}`
}
