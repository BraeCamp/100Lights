// ── Deciding whether anyone is talking ──────────────────────────────────────
//
// Brae: "The voice control doesn't hear me while it's playing."
//
// It could not, and the reason was this file's fault before this file existed.
// The rule was: learn the room from the first half-second, then treat anything
// 2.5x above it as speech. In a quiet room that is exactly right. With the
// transport running, THE ROOM IS THE MUSIC — so the floor was learned as the
// mix, the bar became two and a half times the mix, and nothing a person can
// say from a normal distance ever reached it. The take then failed the "was
// there any speech in this" check and came back "I didn't catch that", which
// reads as a hearing problem and was a maths problem.
//
// Two things follow from that, and both are about the same mistake — treating a
// number learned once as a fact about the world:
//
//   THE FLOOR HAS TO KEEP MOVING. Music is not a constant. A floor measured
//   during an intro is wrong by the first chorus, so it tracks continuously,
//   and only while nobody is talking — otherwise it chases the speech it is
//   supposed to be detecting and the speaker talks themselves into silence.
//
//   THE BAR HAS TO DEPEND ON WHAT IT IS ABOVE. Speech does not get 2.5x louder
//   than a full mix; it adds to it. Over music the useful signal is a modest
//   rise, and demanding a large one is demanding something that never happens.
//
// Pure, and separate from the microphone, because the only way to test any of
// this without a room and a voice is to feed it numbers.

export interface VadOptions {
  /** True while the transport is running — the loud case. */
  playing?: boolean
}

export interface VadState {
  /** The level the room is sitting at, tracked continuously. */
  floor: number
  /** How many samples have gone into the initial estimate. */
  calibrated: number
  /** Has anyone spoken during this take? */
  heard: boolean
  /** When the level was last above the bar. */
  lastLoudAt: number
  /** When the level FIRST went above the bar without coming back down. */
  aboveSince: number | null
}

export interface VadStep {
  state: VadState
  /** Is somebody speaking right now? */
  speaking: boolean
  /** Has speech finished — the take can end itself. */
  ended: boolean
  /** The bar this sample was judged against, for the meter and for tests. */
  threshold: number
}

export function newVad(): VadState {
  return { floor: 0, calibrated: 0, heard: false, lastLoudAt: 0, aboveSince: null }
}

/** Samples of the room taken before any judging starts. 10 x 50ms = half a
 *  second, which is long enough to average out a syllable of nothing and short
 *  enough that nobody notices. */
export const CALIBRATION_SAMPLES = 10

/**
 * How far above the floor a sample has to sit to count as speech.
 *
 * In a quiet room the floor is hiss and a large multiple is safe and correct.
 * Over a mix the floor is the music, and speech ADDS to it rather than
 * multiplying it — a person talking over their own playback raises the meter by
 * something like a quarter, not by a factor of two and a half.
 */
export const RATIO_QUIET = 2.5
export const RATIO_OVER_MUSIC = 1.3

/** Below this, nothing counts as speech however quiet the room is — otherwise a
 *  silent room triggers on its own noise floor. */
export const MIN_SPEECH_LEVEL = 0.012

/** How long a gap ends the take. Longer over music, where the level falls back
 *  to a moving target rather than to silence and the decision is noisier. */
export const SILENCE_MS = 1100
export const SILENCE_MS_PLAYING = 1500

/** How fast the floor follows the room while nobody is talking. Slow enough
 *  that a held note does not become the new floor; fast enough to keep up with
 *  a song. */
const FLOOR_FOLLOW = 0.02

/**
 * How long a level may stay up before it stops being speech and starts being
 * the room.
 *
 * Freezing the floor while somebody talks is right, and on its own it cannot
 * tell a sentence from a chorus arriving — both are "the level went up and
 * stayed up", so a drop landing would be heard as a very long word and the
 * floor would never catch up to the new section.
 *
 * What separates them is not loudness, it is SHAPE. Speech is gaps: between
 * words, between syllables, to breathe. The meter falls back below the bar
 * several times a second and any one of those dips is enough to say a person is
 * still there. Music does not do that — a mix sits up.
 *
 * So a level that stays up for two and a half seconds without ever dipping is
 * not a person talking, whatever its level. It is the new floor, and it is
 * treated as one.
 */
const SUSTAINED_MS = 2500

/**
 * One sample of the meter.
 *
 * Returns a new state rather than mutating, so a test can replay a whole take
 * and a caller cannot half-update it.
 */
export function vadStep(
  state: VadState,
  rms: number,
  now: number,
  opts: VadOptions = {},
): VadStep {
  // ── The first half-second is the room, whatever the room is ──────────────
  if (state.calibrated < CALIBRATION_SAMPLES) {
    const floor = (state.floor * state.calibrated + rms) / (state.calibrated + 1)
    return {
      state: { ...state, floor, calibrated: state.calibrated + 1 },
      speaking: false,
      ended: false,
      threshold: Infinity,
    }
  }

  const ratio = opts.playing ? RATIO_OVER_MUSIC : RATIO_QUIET
  const threshold = Math.max(MIN_SPEECH_LEVEL, state.floor * ratio)
  const above = rms > threshold

  if (above) {
    const aboveSince = state.aboveSince ?? now
    // Up for too long without a single dip: this is a section, not a sentence.
    // The level becomes the floor — quickly, because the longer this is left
    // the longer everything else is judged against a bar that belongs to a
    // quieter part of the song.
    if (now - aboveSince > SUSTAINED_MS) {
      return {
        state: {
          ...state,
          floor: state.floor * (1 - FLOOR_FOLLOW * 4) + rms * FLOOR_FOLLOW * 4,
          aboveSince,
        },
        speaking: false,
        ended: false,
        threshold,
      }
    }
    return {
      // The floor is deliberately NOT updated here. Following the level while
      // somebody is talking raises the bar under them until they fall below it,
      // and the symptom of that is a speaker being cut off mid-sentence.
      state: { ...state, heard: true, lastLoudAt: now, aboveSince },
      speaking: true,
      ended: false,
      threshold,
    }
  }

  const floor = state.floor * (1 - FLOOR_FOLLOW) + rms * FLOOR_FOLLOW
  const gap = opts.playing ? SILENCE_MS_PLAYING : SILENCE_MS
  const ended = state.heard && now - state.lastLoudAt > gap
  // A dip resets the clock: the next rise is a fresh word, not a continuation.
  return { state: { ...state, floor, aboveSince: null }, speaking: false, ended, threshold }
}
