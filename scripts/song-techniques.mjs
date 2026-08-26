// A shelf of optional techniques for adding flare to a piece.
//
//   import { roll, pedalPoint, hemiola, ghostNotes, ... } from './song-techniques.mjs'
//
// Brae: "Discover new techniques on your way. A LOT of them as optional
// techniques to add flare to music."
//
// Everything here is OPTIONAL and composable — each function takes notes and
// returns notes (or produces an FX-lane bar), so a part can be written plainly
// and then have character applied to it. Nothing here is required to write a
// song, and using all of it on one part would be a mess; the value is in having
// the vocabulary available so a choice is a choice rather than an omission.
//
// Each carries the same three things, because a technique you cannot place is
// no more useful than one you do not have:
//
//   WHAT it does, mechanically.
//   WHEN it helps.
//   WHEN it hurts — the failure mode, which is usually "used everywhere".
//
// Beats are relative to whatever the caller is working in; nothing assumes 4/4.

import { N } from './song-kit.mjs'

const clone = n => ({ ...n })
const sortByTime = ns => [...ns].sort((a, b) => a.startBeat - b.startBeat)
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const clampVel = v => Math.max(1, Math.min(127, Math.round(v)))

// ═══════════════════════════════════════════════════════════════════════════
// TIMING — where notes sit against the grid
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ROLL — spread a chord's notes into a quick upward (or downward) sweep.
 *
 * WHAT: staggers simultaneous notes by a few milliseconds each, low to high.
 * WHEN: the single most pianistic thing you can do to a block chord. Use it on
 *       an entrance, or on the one chord in a phrase that should feel weighted.
 * HURTS: on every chord, where it stops reading as expression and starts
 *       reading as a a sloppy player. And on anything percussive.
 */
export function roll(notes, { ms = 22, bpm = 90, down = false } = {}) {
  const step = (ms / 1000) * (bpm / 60)
  const order = [...notes].sort((a, b) => down ? b.pitch - a.pitch : a.pitch - b.pitch)
  return order.map((n, i) => ({ ...n, startBeat: +(n.startBeat + i * step).toFixed(4) }))
}

/**
 * PUSH / DRAG — play a whole phrase slightly ahead of or behind the beat.
 *
 * WHAT: a constant timing offset, in milliseconds.
 * WHEN: this is the difference between "in time" and "in the pocket". Drums and
 *       bass slightly late reads relaxed; a top line slightly early reads eager.
 *       Using OPPOSITE signs on two parts is what makes a groove breathe.
 * HURTS: past about 30ms it stops being feel and starts being wrong.
 */
export const push = (notes, ms, bpm = 90) =>
  notes.map(n => ({ ...n, startBeat: +Math.max(0, n.startBeat - (ms / 1000) * (bpm / 60)).toFixed(4) }))
export const drag = (notes, ms, bpm = 90) => push(notes, -ms, bpm)

/**
 * GHOST NOTES — very quiet hits between the loud ones.
 *
 * WHAT: adds low-velocity notes on the given subdivisions.
 * WHEN: the reason a real drummer's hi-hat sounds alive and a programmed one
 *       does not. Also works on bass, where a ghosted note between roots gives
 *       the line momentum without adding anything you consciously hear.
 * HURTS: if they are too loud they are not ghosts, they are extra notes.
 */
export function ghostNotes(notes, { pitch, every = 0.5, from = 0, to = 4, velocity = 22, skip = () => false }) {
  const out = [...notes]
  for (let b = from; b < to; b += every) {
    if (notes.some(n => Math.abs(n.startBeat - b) < 0.06)) continue   // never on top of a real hit
    if (skip(b)) continue
    out.push(N(pitch, b, every * 0.5, velocity))
  }
  return sortByTime(out)
}

/**
 * FLAM — a grace note a hair before the main one.
 *
 * WHAT: duplicates a hit 15-30ms early and much quieter.
 * WHEN: on a snare or rim that wants weight without volume; on a piano bass
 *       note for a "thumb slightly early" feel.
 * HURTS: on fast passages, where the flams collide with the previous note.
 */
export const flam = (note, { ms = 20, bpm = 90, drop = 0.45 } = {}) => [
  N(note.pitch, Math.max(0, note.startBeat - (ms / 1000) * (bpm / 60)), 0.12, clampVel(note.velocity * drop)),
  clone(note),
]

/**
 * RATCHET — subdivide one hit into a burst of fast repeats.
 *
 * WHAT: replaces a note with n notes inside its length, rising in velocity.
 * WHEN: the last beat before a section change; a hi-hat stutter that signals
 *       something is about to happen. Cheap tension, immediately legible.
 * HURTS: more than once or twice in a song and it is a gimmick.
 */
export function ratchet(note, n = 3, { rise = 12 } = {}) {
  const step = note.durationBeats / n
  return Array.from({ length: n }, (_, i) =>
    N(note.pitch, note.startBeat + i * step, step * 0.9, clampVel((note.velocity ?? 90) - rise + i * rise)))
}

/**
 * HEMIOLA — regroup the beat so 3 feels like 2 (or the reverse).
 *
 * WHAT: re-times a figure onto a different subdivision across the same span —
 *       in 3/4, three groups of two against the bar's two groups of three.
 * WHEN: the classic way to lift a waltz without changing tempo or key. Put it
 *       in the bar before a section change and the arrival feels inevitable.
 * HURTS: if the rest of the arrangement keeps stating the original grouping
 *        loudly, it reads as a mistake rather than an intention.
 */
export function hemiola(notes, { barBeats = 3, groups = 2 } = {}) {
  const span = barBeats
  const unit = span / (span / groups)
  return notes.map((n, i) => ({
    ...n,
    startBeat: +clamp((i % (span / groups)) * unit + Math.floor(i / (span / groups)) * groups, 0, span - 0.1).toFixed(4),
  }))
}

/**
 * ACCELERANDO / RITARDANDO within a phrase — speed up or slow down across it.
 *
 * WHAT: warps note times toward the end (or the start) of a span.
 * WHEN: a fill that rushes into the downbeat; an outro that leans back into
 *       silence. Tempo automation does this globally; this does it to one part,
 *       which is how a player does it.
 * HURTS: against a locked drum part, where it just sounds out of time.
 */
export function bendTime(notes, { span, amount = 0.12, rush = true } = {}) {
  return notes.map(n => {
    const t = clamp(n.startBeat / span, 0, 1)
    const shaped = rush ? Math.pow(t, 1 - amount) : Math.pow(t, 1 + amount)
    return { ...n, startBeat: +(shaped * span).toFixed(4) }
  })
}

// ═══════════════════════════════════════════════════════════════════════════
// PITCH AND HARMONY — which notes, and where they sit
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ROOTLESS VOICING — drop the root from a keyboard chord.
 *
 * WHAT: removes the lowest chord tone.
 * WHEN: whenever a bass is playing the root anyway. The root doubled in the
 *       keys is the single most common cause of a muddy low-mid.
 * HURTS: with no bass present, where the chord loses its floor.
 */
export const rootless = stack => stack.slice(1)

/**
 * DROP-2 — take the second voice from the top down an octave.
 *
 * WHAT: re-spaces a close chord into an open one.
 * WHEN: close voicings stack into a narrow band and fight; drop-2 opens a gap
 *       in the middle for a vocal or a lead to sit in. Standard in jazz piano
 *       and big-band writing for exactly that reason.
 * HURTS: in a low register, where the dropped voice lands in the bass's way.
 */
export function drop2(stack) {
  const s = [...stack].sort((a, b) => a - b)
  const i = s.length - 2
  return [...s.slice(0, i), s[i] - 12, ...s.slice(i + 1)].sort((a, b) => a - b)
}

/** DROP-3 — same idea, third voice from the top. Wider still. */
export function drop3(stack) {
  const s = [...stack].sort((a, b) => a - b)
  const i = s.length - 3
  if (i < 0) return s
  return [...s.slice(0, i), s[i] - 12, ...s.slice(i + 1)].sort((a, b) => a - b)
}

/**
 * PEDAL POINT — hold one bass note while the chords move over it.
 *
 * WHAT: replaces a moving bass with a single sustained pitch.
 * WHEN: builds tension without adding density — the harmony pulls against a
 *       fixed floor. Especially strong under a rising progression, and the
 *       standard way to make the return to the tonic feel earned.
 * HURTS: over more than four bars it stops being tension and becomes stasis.
 */
export const pedalPoint = (pitch, bars, barBeats, velocity = 80) =>
  Array.from({ length: bars }, (_, i) => N(pitch, i * barBeats, barBeats * 0.98, velocity - i * 2))

/**
 * ANTICIPATION — the next chord arrives an eighth before the bar line.
 *
 * WHAT: shifts a chord's notes earlier across the barline.
 * WHEN: the single most effective way to stop a progression sounding like it is
 *       marching. Ubiquitous in gospel, soul and R&B piano.
 * HURTS: on every change, where the bar line stops existing.
 */
export const anticipate = (notes, by = 0.5) =>
  notes.map(n => ({ ...n, startBeat: +Math.max(0, n.startBeat - by).toFixed(4), durationBeats: +(n.durationBeats + by * 0.5).toFixed(4) }))

/**
 * NEIGHBOUR TONE — step away and back within one note's span.
 *
 * WHAT: splits a note into three: the note, its neighbour, the note again.
 * WHEN: turns a held note into a gesture. On a sustained top voice it reads as
 *       a singer's ornament.
 * HURTS: on anything already busy.
 */
export function neighbour(note, { step = 2, up = true } = {}) {
  const d = note.durationBeats / 4
  return [
    N(note.pitch, note.startBeat, d, note.velocity),
    N(note.pitch + (up ? step : -step), note.startBeat + d, d, clampVel(note.velocity * 0.85)),
    N(note.pitch, note.startBeat + 2 * d, note.durationBeats - 2 * d, clampVel(note.velocity * 0.95)),
  ]
}

/**
 * SUSPENSION — hold a tone from the old chord into the new one, then resolve.
 *
 * WHAT: keeps one voice put across a chord change and moves it a step late.
 * WHEN: the oldest tension device there is, and still the best. It makes a
 *       chord change feel like something happened to someone.
 * HURTS: unresolved, where it just sounds like a wrong note — the resolution is
 *        the technique, not the suspension.
 */
export function suspend(prevStack, nextStack, { voice = 2, holdBeats = 1, barBeats = 3, velocity = 62 } = {}) {
  const held = prevStack[voice]
  const target = nextStack[voice]
  return [
    N(held, 0, holdBeats, velocity),
    N(target, holdBeats, barBeats - holdBeats, clampVel(velocity * 0.9)),
  ]
}

/**
 * PASSING CHORD — a chromatic step between two chords.
 *
 * WHAT: transposes a stack to sit a semitone below (or above) the target,
 *       played briefly at the end of the bar before it.
 * WHEN: makes a slow progression feel intentional rather than merely slow.
 * HURTS: in sparse, still music, where it is simply busy.
 */
export const passingChord = (targetStack, { from = -1, at, beats = 0.5, velocity = 46 } = {}) =>
  targetStack.map(p => N(p + from, at, beats, velocity))

/**
 * MODAL BORROW — lift a chord from the parallel mode.
 *
 * WHAT: raises the third of a minor chord (or lowers a major's) by a semitone.
 * WHEN: one borrowed chord in an otherwise diatonic loop is the moment a
 *       listener looks up. A picardy third at the end of a minor piece is this.
 * HURTS: used repeatedly, where the key stops being established at all.
 */
export function borrowThird(stack, root, { major = true } = {}) {
  return stack.map(p => {
    const interval = ((p - root) % 12 + 12) % 12
    if (major && interval === 3) return p + 1
    if (!major && interval === 4) return p - 1
    return p
  })
}

/**
 * OCTAVE DOUBLE — reinforce a line an octave away.
 *
 * WHAT: copies notes up or down an octave, quieter.
 * WHEN: the cheapest way to make one part sound like a section. Down for
 *       weight, up for shine.
 * HURTS: down, into a register the bass already occupies.
 */
export const octaveDouble = (notes, { dir = 1, drop = 0.7 } = {}) =>
  sortByTime([...notes, ...notes.map(n => ({ ...n, id: undefined, pitch: n.pitch + 12 * dir, velocity: clampVel(n.velocity * drop) }))
    .map(n => N(n.pitch, n.startBeat, n.durationBeats, n.velocity))])

// ═══════════════════════════════════════════════════════════════════════════
// TEXTURE — how parts sit together
// ═══════════════════════════════════════════════════════════════════════════

/**
 * INTERLOCK — split one figure between two parts so neither plays it alone.
 *
 * WHAT: hands alternate notes to A and B.
 * WHEN: two instruments playing the same line in unison is one thick
 *       instrument; two instruments playing alternate notes of it is a
 *       conversation. This is what makes marimba and gamelan writing move.
 * HURTS: if the two timbres are too similar to tell apart, where it just
 *        sounds like one part with an inconsistent tone.
 */
export function interlock(notes, { phase = 0 } = {}) {
  const s = sortByTime(notes)
  return {
    a: s.filter((_, i) => (i + phase) % 2 === 0),
    b: s.filter((_, i) => (i + phase) % 2 === 1),
  }
}

/**
 * CALL AND RESPONSE — a phrase, then an answer in the gap.
 *
 * WHAT: places `answer` in the space after `call` ends.
 * WHEN: gives an arrangement the shape of a dialogue. The answer should be
 *       shorter and quieter than the call, or it is not an answer.
 * HURTS: when both play through each other, which is not a conversation.
 */
export const respond = (call, answer, { gap = 0.25 } = {}) => {
  const end = Math.max(...call.map(n => n.startBeat + n.durationBeats))
  return sortByTime([...call, ...answer.map(n => N(n.pitch, end + gap + n.startBeat, n.durationBeats, clampVel(n.velocity * 0.8)))])
}

/**
 * THIN — keep only the structurally important notes.
 *
 * WHAT: keeps the loudest `keep` fraction, always keeping the first.
 * WHEN: the second time a section comes round, so it is recognisably the same
 *       music with less of it. Subtraction is the most underused arrangement
 *       tool there is.
 * HURTS: if it removes the notes that made the figure recognisable.
 */
export function thin(notes, keep = 0.5) {
  const s = sortByTime(notes)
  const n = Math.max(1, Math.round(s.length * keep))
  const byVel = [...s].sort((a, b) => (b.velocity ?? 0) - (a.velocity ?? 0)).slice(0, n)
  const ids = new Set(byVel.map(x => x.startBeat + ':' + x.pitch))
  return s.filter((x, i) => i === 0 || ids.has(x.startBeat + ':' + x.pitch))
}

/**
 * BLOOM — a velocity swell across a phrase.
 *
 * WHAT: scales velocity along a curve from start to end.
 * WHEN: a held pad or a repeated figure that should feel like it is being
 *       leaned into. Dynamics are the thing most obviously missing from
 *       programmed music, and this is the cheapest way to add them.
 * HURTS: on a part whose job is to be steady.
 */
export const bloom = (notes, { from = 0.7, to = 1.15, curve = 1 } = {}) => {
  const span = Math.max(...notes.map(n => n.startBeat)) || 1
  return notes.map(n => {
    const t = Math.pow(clamp(n.startBeat / span, 0, 1), curve)
    return { ...n, velocity: clampVel((n.velocity ?? 90) * (from + (to - from) * t)) }
  })
}

/**
 * UNISON HIT — everything lands together, once.
 *
 * WHAT: one accented note per part at the same instant.
 * WHEN: the arrival of a section; the end of a piece. After a passage where
 *       parts have been interlocking, a unison is a full stop.
 * HURTS: often, where it flattens the arrangement into one instrument.
 */
export const unisonHit = (pitchesByPart, at, { beats = 1, velocity = 104 } = {}) =>
  Object.fromEntries(Object.entries(pitchesByPart).map(([k, pitches]) =>
    [k, pitches.map(p => N(p, at, beats, velocity))]))

// ═══════════════════════════════════════════════════════════════════════════
// MOTION — FX-lane gestures. These return effect bars, not notes.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * FILTER SWEEP IN — open a low-pass across a whole section.
 *
 * WHAT: a long filter ramp from closed to open.
 * WHEN: the standard way to make a section feel like it is arriving rather than
 *       simply starting. Slow enough (8+ bars) it is felt rather than heard.
 * HURTS: fast, where it becomes an effect rather than a shape.
 */
export const sweepIn = (trackKey, startBeat, beats, { from = 420, row = 2 } = {}) => ({
  trackKey, startBeat, durationBeats: beats, row,
  fx: { filterHz: from },
  graph: [[0, 1], [beats * 0.75, 0.25], [beats, 0]].map(([t, v]) => ({ t, v })),
})

/**
 * AIR LIFT — a high-shelf uncovering for the last time round.
 *
 * WHAT: a gentle top-end and level lift held across a section.
 * WHEN: the final chorus, where the arrangement is the same but should feel
 *       bigger. Brightness reads as "more" without anything being added.
 * HURTS: applied to everything, which is just turning the song up.
 */
export const airLift = (trackKey, startBeat, beats, { gain = 1.06, row = 3 } = {}) => ({
  trackKey, startBeat, durationBeats: beats, row,
  fx: { gain, drive: 0.03 },
  graph: [[0, 0], [beats * 0.2, 1], [beats * 0.85, 1], [beats, 0.4]].map(([t, v]) => ({ t, v })),
})

/**
 * WIDTH PULL — collapse to the middle, then reopen.
 *
 * WHAT: narrows the stereo image briefly.
 * WHEN: just before a chorus. Narrow then wide is heard as a size change even
 *       when nothing gets louder — the oldest trick in mastering, used
 *       deliberately as an arrangement move.
 * HURTS: on a mono-ish part, where there is no width to pull.
 */
export const widthPull = (trackKey, atBeat, beats = 2, { row = 4 } = {}) => ({
  trackKey, startBeat: Math.max(0, atBeat - beats), durationBeats: beats, row,
  fx: { width: 0.25 },
  graph: [[0, 0], [beats * 0.7, 1], [beats, 0]].map(([t, v]) => ({ t, v })),
})

/**
 * BREATH — a fast duck and recover, on one beat.
 *
 * WHAT: a short dip in level.
 * WHEN: where a phrase should inhale — before a repeat, or under a hit. Also
 *       the honest version of sidechain pumping when there is no kick to duck
 *       against.
 * HURTS: repeated on a grid, where it becomes a tremolo nobody asked for.
 */
export const breath = (trackKey, atBeat, { beats = 0.75, depth = 0.72, row = 5 } = {}) => ({
  trackKey, startBeat: Math.max(0, atBeat - beats * 0.5), durationBeats: beats, row,
  fx: { gain: depth },
  graph: [[0, 0], [beats * 0.35, 1], [beats, 0]].map(([t, v]) => ({ t, v })),
})
