'use client'
// ── Finding out what is actually wrong ──────────────────────────────────────
//
// Brae: "'Light, add a descending low pass filter to pad A' turned into 'I'd
// like to have some muscle pain'. Do we need a calibration system?"
//
// Yes — but not the kind that asks you to read three sentences so a model can
// learn your voice. The recogniser is a cloud service; it cannot be trained
// from here, and pretending otherwise would be a wizard that changes nothing.
//
// What is worth calibrating is everything BETWEEN the person and that service,
// because a sentence coming back as "muscle pain" has four quite different
// possible causes and they are fixed in four different places:
//
//   THE ROOM IS LOUD, so the bar sits above the voice. Measurable: listen to
//   the room for two seconds and see where the floor is.
//
//   THE VOICE IS QUIET AT THE MICROPHONE, so it arrives close to the room.
//   Measurable: ask for a sentence and compare it to the floor.
//
//   THE DEVICE IS IN A CALL PROFILE, so everything is 16 kHz mush. Already
//   reported by the recorder, and worth repeating here where somebody is
//   looking for an explanation.
//
//   THE WORDS ARE UNEXPECTED, so a general recogniser guesses. Measurable, and
//   the most useful test of all: say a known sentence and compare what comes
//   back to what was said.
//
// So this measures, and says which one it is. A calibration that ends in "your
// headphones are the problem" is worth ten that end in a progress bar.

/** What somebody is asked to say. Chosen to contain the words that go wrong:
 *  the studio's name, a swept filter, and a track-shaped noun. */
import { RATIO_QUIET, CONTINUOUS_STRICTNESS } from './vad'

export const CALIBRATION_PHRASE = 'Light, add a descending low pass filter to the pad'

export interface CalibrationResult {
  /** The room, with nobody talking. */
  floor: number
  /** The loudest the voice reached. */
  peak: number
  /** How far the voice sits above the room, as a multiple. */
  headroom: number
  /** What came back from the transcriber. */
  heard: string
  /** 0–1, how much of the asked-for phrase came back. */
  accuracy: number
  /** The recogniser's own confidence. */
  confidence: number
  /** What the microphone turned out to be. */
  micLabel: string
  sampleRate: number | null
  /** The sensitivity this measurement suggests. */
  suggested: number
  /** What to do about it, in one sentence. */
  verdict: string
}

/**
 * How much of what was asked for came back.
 *
 * Word overlap rather than exact match, because a transcript that gets nine
 * words out of eleven is working and one that gets two is not, and the
 * difference between them is the whole point of measuring.
 */
export function phraseAccuracy(asked: string, heard: string): number {
  const norm = (t: string) => String(t ?? '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean)
  const want = norm(asked)
  if (!want.length) return 0
  const got = new Set(norm(heard))
  let hit = 0
  for (const w of want) if (got.has(w)) hit++
  return hit / want.length
}

/**
 * What the measurements mean, and what to do.
 *
 * Ordered by how much difference it makes. A device in a call profile swamps
 * everything else, so it is said first and alone — telling somebody to speak up
 * while their headset is resampling them to 16 kHz is advice that cannot work.
 */
/**
 * Where to put the bar, as a fraction of the way from this room to this voice.
 *
 * A seventh, having been a third. Brae: "make calibration make it more
 * sensitive than it does."
 *
 * A third was chosen to clear a word's onset comfortably, and "comfortably" was
 * the mistake: it is aiming for the middle of a person's dynamic range when it
 * should be aiming just above the room. "Check" opens on a hard transient and
 * clears any bar; "start" opens on a sibilant and closes on a soft t, and never
 * goes near one. Aiming for the average word loses every quiet one.
 *
 * It can sit this low because being wrong is cheap now: the bar no longer
 * decides whether audio reaches the recogniser, only when the take is cut. The
 * worst case is a clip that comes back empty.
 */
export const AIM = 0.15

/** The clamp. Outside this the answer is not a sensitivity setting, it is a
 *  room or a microphone problem, and the verdict says so in words. */
export const SENSITIVITY_MIN = 0.1
export const SENSITIVITY_MAX = 4

/**
 * The sensitivity that puts the bar where this person's voice actually is.
 *
 * Brae: "I think the volume sensitivity needs to be higher, or even better we
 * have a sensitivity calibration that the user can use to calibrate to their
 * volume."
 *
 * The second one, because the first cannot be right for everybody: the correct
 * bar is a property of a room, a microphone and a voice, and no default chosen
 * here knows any of the three. Calibration already measured all three — it just
 * threw the numbers away and picked one of four preset multipliers, which is a
 * strange thing to do with a measurement.
 *
 * So it is solved rather than guessed. The detector's bar is
 *
 *     floor * (1 + (ratio - 1) * strictness)
 *
 * and what we want is a bar sitting AIM of the way from the measured room to
 * the measured voice. Rearranged for the one unknown, that is the sensitivity
 * to store. Solved for the HELD-OPEN case, which applies the extra strictness
 * and is therefore the harder of the two: a setting that works there works
 * push-to-talk as well.
 */
export function sensitivityFor(floor: number, peak: number, opts: {
  ratio?: number; continuousStrictness?: number
} = {}): number {
  // Imported, not restated. The first version wrote 2.5 and 1.6 here as its own
  // defaults, and they were correct for exactly as long as nobody changed the
  // detector — which happened the same afternoon. Two copies of one number are
  // two numbers, and the failure is silent: calibration goes on solving an
  // equation the detector has stopped using, so the bar lands somewhere nobody
  // chose.
  const ratio = opts.ratio ?? RATIO_QUIET
  const strict = opts.continuousStrictness ?? CONTINUOUS_STRICTNESS
  if (!(floor > 0) || !(peak > floor)) return 1
  const want = AIM * (peak - floor)
  const per = floor * (ratio - 1) * strict
  if (!(per > 0)) return 1
  return Math.max(SENSITIVITY_MIN, Math.min(SENSITIVITY_MAX, +(want / per).toFixed(2)))
}

export function verdictFor(m: {
  floor: number
  peak: number
  accuracy: number
  confidence: number
  sampleRate: number | null
  micLabel: string
}): { verdict: string; suggested: number } {
  const headroom = m.floor > 0 ? m.peak / m.floor : m.peak > 0 ? 99 : 0
  // Measured, not chosen. Every branch below returns this: the verdicts differ
  // because they diagnose different problems, but none of them knows the right
  // bar better than the arithmetic on the numbers just taken from this room.
  const measured = sensitivityFor(m.floor, m.peak)

  if (m.sampleRate != null && m.sampleRate < 24_000) {
    return {
      suggested: measured,
      verdict: `${m.micLabel || 'That microphone'} is running at ${Math.round(m.sampleRate / 100) / 10} kHz — a call profile. Nothing else will help much until the monitoring and the microphone are different devices.`,
    }
  }

  if (m.peak < 0.02) {
    return {
      suggested: measured,
      verdict: 'Barely anything reached the microphone. Check it is the right input, and move closer.',
    }
  }

  if (headroom < 2) {
    return {
      suggested: measured,
      verdict: `Your voice is only ${headroom.toFixed(1)}x the room. Move closer to the microphone, or quieten the room — at this distance the studio cannot tell you apart from it.`,
    }
  }

  if (m.accuracy < 0.5) {
    return {
      suggested: measured,
      verdict: `The level is fine (${headroom.toFixed(1)}x the room) but only ${Math.round(m.accuracy * 100)}% of the words came back. That is the recogniser struggling, not the microphone — speak a little more deliberately, and keep track names short and distinct.`,
    }
  }

  if (headroom > 8) {
    return {
      suggested: measured,
      verdict: `Clear and loud — ${headroom.toFixed(1)}x the room, ${Math.round(m.accuracy * 100)}% of the words. You can afford the strictest setting, which will ignore most of the room.`,
    }
  }

  return {
    suggested: measured,
    verdict: `Good — ${headroom.toFixed(1)}x the room and ${Math.round(m.accuracy * 100)}% of the words came back.`,
  }
}
