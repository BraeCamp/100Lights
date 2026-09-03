// Named feels, as timing and accent rather than as a number.
//
// From the audit's "needs work" list: groove / shuffle / feel templates —
// "swing exists as a number. Named grooves would need a template store."
//
// ── Why a number was not enough ────────────────────────────────────────────
//
// The engine's swing delays every offbeat sixteenth by the same amount. That is
// one feel, and it is the least interesting one: real grooves are not uniform.
// A shuffle pushes the offbeat much further than swing does. A laid-back feel
// moves everything late, including the downbeats, which uniform swing cannot
// express at all. And the accent pattern is half of what makes a groove
// recognisable — a hat pattern with no dynamic shape reads as a machine
// whatever its timing.
//
// So a groove here is a 16-step table of offsets AND accents, applied by
// position in the bar. That covers everything the single number could do and
// the things it could not.
//
// ⚠️ These are BAKED INTO THE NOTES, unlike the engine's swing which is applied
// at scheduling time. That is deliberate: a baked groove is visible in the
// piano roll, survives export, and can be undone. A groove you can hear but
// cannot see is the kind of thing people spend an hour hunting for.

import type { MidiNote } from '@/lib/daw-types'

export interface Groove {
  id: string
  label: string
  /** What it feels like, for the library and the read-back. */
  note: string
  /** Offset per sixteenth of the bar, in beats. Positive is late. */
  offsets: number[]
  /** Velocity multiplier per sixteenth. 1 leaves it alone. */
  accents?: number[]
}

// A sixteenth is 0.25 beats, so an offset of 0.05 is a fifth of a sixteenth —
// clearly felt, nowhere near a different subdivision.
const S = 0.25

/** Every other sixteenth pushed late by `amount` of the way to the next one. */
const swingOffsets = (amount: number) =>
  Array.from({ length: 16 }, (_, i) => (i % 2 === 1 ? S * amount : 0))

export const GROOVES: Groove[] = [
  {
    id: 'straight',
    label: 'Straight',
    note: 'Back on the grid, with the accents evened out.',
    offsets: new Array(16).fill(0),
    accents: new Array(16).fill(1),
  },
  {
    id: 'swing-light',
    label: 'Light swing',
    note: 'A gentle lift on the offbeat sixteenths. The feel most people mean by "a bit of swing".',
    offsets: swingOffsets(0.18),
  },
  {
    id: 'swing',
    label: 'Swing',
    note: 'The classic offbeat delay, about a third of the way to the next sixteenth.',
    offsets: swingOffsets(0.33),
  },
  {
    id: 'shuffle',
    label: 'Shuffle',
    note: 'Hard triplet feel — the offbeat lands two thirds of the way across, which is where a shuffled eighth actually sits.',
    // Two thirds of a sixteenth puts the offbeat on the triplet, which is what
    // separates a shuffle from a swing rather than a matter of degree.
    offsets: swingOffsets(0.667),
  },
  {
    id: 'laid-back',
    label: 'Laid back',
    note: 'Everything a shade behind the beat, downbeats included. Uniform swing cannot do this — it only ever moves the offbeats.',
    offsets: new Array(16).fill(0.035),
  },
  {
    id: 'pushed',
    label: 'Pushed',
    note: 'Everything slightly early, which reads as urgency rather than as a mistake.',
    offsets: new Array(16).fill(-0.03),
  },
  {
    id: 'dilla',
    label: 'Off-grid',
    note: 'Snare late, hats loose, downbeat honest — the deliberately-unquantised feel. Uneven on purpose.',
    // Uneven BY DESIGN. A groove whose offsets repeat every two steps is a
    // swing; what makes this one recognisable is that no two bars' worth of
    // sixteenths are treated alike.
    offsets: [0, 0.04, -0.01, 0.05, 0.03, 0.02, 0.01, 0.06, 0, 0.05, -0.02, 0.04, 0.035, 0.01, 0.02, 0.055],
    accents: [1.05, 0.72, 0.86, 0.68, 1, 0.7, 0.9, 0.66, 1.02, 0.74, 0.84, 0.7, 0.98, 0.72, 0.88, 0.64],
  },
  {
    id: 'hard-accents',
    label: 'Hard accents',
    note: 'Timing left alone, dynamics sharpened — downbeats up, everything between them down.',
    offsets: new Array(16).fill(0),
    accents: [1.15, 0.7, 0.85, 0.7, 1.1, 0.7, 0.85, 0.7, 1.15, 0.7, 0.85, 0.7, 1.1, 0.7, 0.85, 0.7],
  },
]

const byId = new Map(GROOVES.map(g => [g.id, g]))

/** A groove from however somebody said its name. */
export function grooveNamed(spoken: string): Groove | null {
  const w = spoken.toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim()
  if (!w) return null
  const direct = byId.get(w.replace(/\s+/g, '-'))
  if (direct) return direct
  // The words people actually use, mapped to the feel they mean.
  if (/straight|quantiz|grid|tighten|even/.test(w)) return byId.get('straight')!
  if (/shuffle|triplet/.test(w)) return byId.get('shuffle')!
  if (/light|subtle|gentle|little|bit/.test(w) && /swing/.test(w)) return byId.get('swing-light')!
  if (/swing/.test(w)) return byId.get('swing')!
  if (/laid|lazy|behind|drag|relax/.test(w)) return byId.get('laid-back')!
  if (/push|ahead|urgent|rush/.test(w)) return byId.get('pushed')!
  if (/dilla|off grid|offgrid|loose|drunk|human/.test(w)) return byId.get('dilla')!
  if (/accent|dynamic|punch/.test(w)) return byId.get('hard-accents')!
  return null
}

/**
 * Apply a groove to notes.
 *
 * `amount` scales both timing and accents, so "a bit of swing" and "hard swing"
 * are the same template at different strengths rather than two templates.
 *
 * ⚠️ The step is taken from the note's position in the BAR, not its index in
 * the list. A groove is a property of where a note sits in the music; keying it
 * to the order notes happen to be stored in would make the same pattern feel
 * different depending on which note was edited last.
 */
export function applyGroove(
  notes: MidiNote[],
  groove: Groove,
  { amount = 1, beatsPerBar = 4 }: { amount?: number; beatsPerBar?: number } = {},
): { id: string; startBeat: number; velocity: number }[] {
  const k = Math.max(0, Math.min(2, amount))
  const stepsPerBar = Math.max(1, Math.round(beatsPerBar * 4))
  return notes.map(n => {
    const sixteenth = Math.round(n.startBeat * 4)
    const step = ((sixteenth % stepsPerBar) + stepsPerBar) % stepsPerBar
    const off = (groove.offsets[step % groove.offsets.length] ?? 0) * k
    const acc = groove.accents
      // Scaled toward 1 rather than multiplied by k, so half strength is half
      // as much accent and not half as loud.
      ? 1 + ((groove.accents[step % groove.accents.length] ?? 1) - 1) * k
      : 1
    return {
      id: n.id,
      // Never before the start of the clip: a pushed groove on the downbeat
      // would otherwise move the first note to a negative position, where it
      // simply never plays.
      startBeat: Math.max(0, n.startBeat + off),
      velocity: Math.max(1, Math.min(127, Math.round(n.velocity * acc))),
    }
  })
}
