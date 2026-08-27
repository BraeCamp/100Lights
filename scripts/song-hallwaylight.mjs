// "Hallway Light" — C# minor, 92 BPM, 3/4. A slow waltz that never quite lands.
//
// SAME METHOD AS LATE CHECKOUT, deliberately: there is ONE piano figure, and the
// instruments are handed its notes. Nothing chooses its own pitches, so nothing
// can disagree — every part is the same chord seen from a different height.
//
//   voice 0 and 1 (the inner pair)  -> warm electric piano
//   voice 2        (upper middle)   -> keys, an octave up
//   voice 3        (the top)        -> choir, only where the music lifts
//   the root                        -> sub, and bass an octave above it
//   the whole stack                 -> pad, an octave down, as glue
//   (section D only)                -> organ, the one part with its own line
//
// WHAT IS DIFFERENT from Late Checkout, on purpose — the point was a new piece,
// not the same piece transposed:
//
//   3/4 rather than 4/4. A waltz has a built-in lean; the figure can fall
//   across the bar line in a way 4/4 does not invite. It also changes what the
//   drums can be — there is no backbeat to put a snare on, so the kit is a kick
//   on 1 and a rim on 3, and the space between them is the groove.
//
//   92 rather than 76. Faster, but in 3 it FEELS slower, because you count
//   fewer bars per minute. That gap between the tempo and the feel is most of
//   the character here.
//
//   A rising loop (i - VI - III - VII) rather than a falling one. Late Checkout
//   sinks; this climbs and then starts again from the bottom, which is a
//   different kind of not-resolving.
//
// HARMONY: C#m9 - Amaj7 - Emaj9 - Bsus2, two bars each. Close voice leading —
// between chords the stack moves a step or two, never leaps. The top voice is
// the exception and climbs 75 -> 73 -> 76 -> 78 across the loop, which is the
// only thing in the piece that goes anywhere.
//
// REGISTER is kept separate on purpose, which is the other half of "these don't
// go together": sub 55-82Hz, bass an octave above, EP in the low mids, keys
// above that, choir on top. Two instruments in one octave is how a mix turns to
// mud even when every note is right.
//
// No lead line, per the standing rule.

import { writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { homedir } from 'os'
import { execFileSync } from 'child_process'
import { fileURLToPath } from 'url'
import { uid, rng, feel, N, assemble, bar, dipInto, eq3, reverb, compressor } from './song-kit.mjs'
import { kick, tick, subBass, bass as bassVoice, warmEp, keys, choirish, pad, organ } from './apollo-voices.mjs'
import {
  roll, drag, ghostNotes, flam, ratchet, anticipate, pedalPoint, drop2,
  octaveDouble, thin, bloom, sweepIn, airLift, widthPull, breath, suspend,
} from './song-techniques.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = join(homedir(), 'Desktop', '100lights-ai-renders')
mkdirSync(OUT_DIR, { recursive: true })

const BPM = 92, BPB = 3          // three beats to the bar
const rand = rng(4417)
const { jitter, vary } = feel(rand, BPM)

// ── The chords, as a stack ──────────────────────────────────────────────────
// low -> high, in the register a piano's right hand actually occupies.
const CSm9  = { name: 'C#m9',   stack: [64, 68, 71, 75], sub: 37, bass: 49 }
const Amaj7 = { name: 'Amaj7',  stack: [64, 68, 69, 73], sub: 33, bass: 45 }
const Emaj9 = { name: 'Emaj9',  stack: [66, 68, 71, 76], sub: 40, bass: 52 }
const Bsus2 = { name: 'Bsus2',  stack: [66, 69, 73, 78], sub: 35, bass: 47 }

/** Two bars each, so the loop is eight bars long. */
const LOOP = [CSm9, CSm9, Amaj7, Amaj7, Emaj9, Emaj9, Bsus2, Bsus2]
const chordAt = i => LOOP[i % LOOP.length]

// ── THE PIANO FIGURE ────────────────────────────────────────────────────────
// One bar of 3, written as if for two hands. [voice, beat, duration, velocity].
// The low voice takes beat one; everything else falls between the beats, so the
// bar leans forward instead of counting itself out. The last event starts on the
// last half-beat and rings past the bar line — which is where the lilt comes
// from, and which has to be clamped in the final bar of a clip or it clicks.
const FIGURE = [
  [0, 0.00, 0.95, 74],
  [2, 0.48, 0.52, 56],
  [1, 0.95, 0.48, 52],
  [3, 1.42, 0.78, 66],
  [2, 1.95, 0.45, 50],
  [0, 2.40, 0.62, 58],
  [3, 2.72, 0.50, 60],
]
/** The same figure with its middle removed, for where the arrangement thins. */
const FIGURE_BARE = [FIGURE[0], FIGURE[3], FIGURE[5]]

/**
 * Hand the figure's notes for `voices` to whoever is playing them.
 *
 * `last` clamps to the bar line: in the final bar of a clip there is no next bar
 * for the overhang to ring into, so the note would be cut at the boundary and
 * click. check-notes catches these, but it is cheaper not to write them.
 */
const fromFigure = (ch, voices, { pattern = FIGURE, octave = 0, vel = 0, last = false } = {}) =>
  pattern
    .filter(([v]) => voices.includes(v))
    .map(([v, b, d, velocity]) => {
      const dur = last ? Math.min(d, Math.max(0.12, BPB - b - 0.02)) : d
      return N(ch.stack[v] + octave, b + jitter(13), dur, vary(velocity + vel, 7))
    })

// ── The parts that are not the figure ───────────────────────────────────────

// The pad holds the whole stack an octave down. It stops 0.2 beats short of the
// bar line: held for the full bar, humanising pushes it a few milliseconds past,
// so bar N is still sounding when bar N+1 starts and the pad asks for eight
// notes at once instead of four. That is 24 voices against a limit of 16, which
// means the allocator steals active ones, which is audible as stuttering. The
// long release carries it across the join anyway.
const padBar = (ch, velocity = 27) =>
  ch.stack.map((p, i) => N(p - 12, 0 + jitter(7), BPB - 0.2, vary(velocity - i * 2, 4)))

// The sub takes the root and holds it across both bars of the chord, so it
// changes half as often as everything else — the floor of the piece.
const subBar = (ch, secondBar, velocity = 86) =>
  secondBar ? [] : [N(ch.sub, 0 + jitter(6), BPB * 1.9, vary(velocity, 4))]

// The bass follows the figure's LOW voice rather than writing a line, so it
// locks to the piano instead of running alongside it.
const bassBar = (ch, { sparse = false } = {}) =>
  (sparse ? [FIGURE[0]] : [FIGURE[0], FIGURE[5]])
    .map(([, b, d, v]) => N(ch.bass, b + jitter(9), Math.max(0.55, d), vary(v + 12, 6)))

// ── Drums: almost nothing ───────────────────────────────────────────────────
// In 3/4 there is no backbeat, so there is no snare. A kick on one and a rim on
// three, and the two beats of air between them do the work.
const KICK = 24, RIM = 60
const kickBar = ({ extra = false } = {}) => [
  N(KICK, 0 + jitter(8), 0.5, vary(92, 5)),
  ...(extra ? [N(KICK, 2.45 + jitter(8), 0.4, vary(64, 6))] : []),
]
const rimBar = ({ ghost = false } = {}) => {
  const hits = [N(RIM, 2.0 + jitter(11), 0.3, vary(58, 7))]
  // Ghost notes are why a real player's time sounds alive: quiet hits you do not
  // consciously hear, which stop the bar from being two events and silence.
  return ghost ? ghostNotes(hits, { pitch: RIM, every: 1, from: 0, to: BPB, velocity: 17 }) : hits
}

// ── Sections ────────────────────────────────────────────────────────────────
// The arc: two instruments, then five, then everything with an organ line over
// it, then almost nothing again. The last A is deliberately THINNER than the
// first — the same music with less of it, so the piece ends by subtraction
// rather than by fading.
const SECTIONS = [
  { name: 'Intro',   bars: 4,  cast: ['pad', 'sub'] },
  { name: 'A',       bars: 12, cast: ['pad', 'sub', 'bass', 'ep', 'rim'] },
  { name: 'B',       bars: 12, cast: ['pad', 'sub', 'bass', 'ep', 'keys', 'kick', 'rim'] },
  { name: 'C',       bars: 12, cast: ['pad', 'sub', 'bass', 'ep', 'keys', 'choir', 'kick', 'rim'] },
  { name: 'D',       bars: 12, cast: ['pad', 'sub', 'bass', 'ep', 'keys', 'choir', 'organ', 'kick', 'rim'] },
  { name: 'A2',      bars: 8,  cast: ['pad', 'sub', 'ep', 'keys'] },
  { name: 'Outro',   bars: 4,  cast: ['pad', 'sub'] },
]

const sections = []
let barCursor = 0
const fxBars = []
let absBeat = 0

for (const sec of SECTIONS) {
  const parts = { pad: [], sub: [], bass: [], ep: [], keys: [], choir: [], organ: [], kick: [], rim: [] }
  const has = k => sec.cast.includes(k)

  for (let b = 0; b < sec.bars; b++) {
    const ch = chordAt(barCursor + b)
    const at = b * BPB
    const lastBar = b === sec.bars - 1
    const secondBarOfChord = (barCursor + b) % 2 === 1
    const shift = ns => ns.map(n => ({ ...n, startBeat: +(n.startBeat + at).toFixed(4) }))

    if (has('pad')) {
      let p = padBar(ch, sec.name === 'D' ? 31 : 27)
      // BLOOM across D: the pad leans into the section rather than holding a
      // level. Dynamics are the thing most obviously missing from programmed
      // music and this is the cheapest place to put some.
      if (sec.name === 'D') p = bloom(p, { from: 0.85, to: 1.12 })
      parts.pad.push(...shift(p))
    }

    if (has('sub')) parts.sub.push(...shift(subBar(ch, secondBarOfChord, sec.name === 'Outro' ? 74 : 86)))

    if (has('bass')) {
      // PEDAL POINT through the second half of C: the bass stops following the
      // chords and holds B while the harmony keeps moving over it. Tension
      // without density, and it makes the return to C#m at D feel earned.
      const pedal = sec.name === 'C' && b >= 6
      parts.bass.push(...shift(pedal
        ? [N(47, 0 + jitter(8), BPB * 0.95, vary(76, 5))]
        : bassBar(ch, { sparse: sec.name === 'A' && b < 4 })))
    }

    if (has('ep')) {
      const bare = sec.name === 'A' && b < 4
      let e = fromFigure(ch, [0, 1], { pattern: bare ? FIGURE_BARE : FIGURE, last: lastBar })
      // ROLL the first chord of each section entrance — the most pianistic
      // thing available, and it marks an arrival without adding a part.
      if (b === 0 && sec.name !== 'Intro') e = roll(e, { ms: 26, bpm: BPM })
      // A2 is the same music with less of it.
      if (sec.name === 'A2') e = thin(e, 0.6)
      // DRAG the EP a few milliseconds behind the beat everywhere. Against a
      // kick that is dead on, that is the difference between "in time" and "in
      // the pocket" — and it is only ~12ms, felt rather than heard.
      parts.ep.push(...shift(drag(e, 12, BPM)))
    }

    if (has('keys')) {
      let k = fromFigure(ch, [2], { octave: 12, vel: -4, last: lastBar })
      // DROP-2 in C opens the voicing so the choir has somewhere to sit.
      if (sec.name === 'C') k = k.map((n, i) => ({ ...n, pitch: i === 0 ? drop2(ch.stack)[2] + 12 : n.pitch }))
      // OCTAVE DOUBLE in D — one part sounding like a section, for the biggest
      // moment in the piece, without writing a new one.
      if (sec.name === 'D') k = octaveDouble(k, { dir: 1, drop: 0.55 })
      parts.keys.push(...shift(k))
    }

    if (has('choir')) {
      // The top voice only, and only on the bars where it climbs — a voice that
      // sings every bar is an instrument; one that appears is an event.
      if (b % 2 === 0) parts.choir.push(...shift(fromFigure(ch, [3], { vel: -12, last: lastBar })))
    }

    if (has('organ')) {
      // The one part in the piece with a line of its own, and it is a
      // SUSPENSION: hold a tone from the previous chord across the change and
      // resolve it late. The oldest tension device there is, and it is what
      // makes a chord change feel like something happened to someone.
      const prev = chordAt(barCursor + b - 1)
      parts.organ.push(...shift(suspend(prev.stack, ch.stack, {
        voice: 2, holdBeats: 1.2, barBeats: BPB, velocity: vary(52, 5),
      }).map(n => N(n.pitch - 12, n.startBeat + jitter(10), n.durationBeats, n.velocity))))
    }

    if (has('kick')) parts.kick.push(...shift(kickBar({ extra: sec.name === 'D' && b % 2 === 1 })))
    if (has('rim')) {
      let r = rimBar({ ghost: sec.name === 'C' || sec.name === 'D' })
      // FLAM the rim as D arrives: weight without volume.
      if (sec.name === 'D' && b === 0) r = [...flam(r[0], { ms: 22, bpm: BPM }), ...r.slice(1)]
      // RATCHET the last bar before D — three fast hits that say something is
      // about to happen. Used exactly once in the piece, which is the point.
      if (sec.name === 'C' && lastBar) r = ratchet(N(RIM, 2.0, 1.0, 70), 3, { rise: 14 })
      parts.rim.push(...shift(r))
    }
  }

  // ANTICIPATION: the first chord of B, C and D arrives half a beat early, so
  // the section does not so much start as get pulled in.
  if (['B', 'C', 'D'].includes(sec.name)) {
    for (const k of ['ep', 'keys']) {
      if (!parts[k].length) continue
      const firstBar = parts[k].filter(n => n.startBeat < BPB)
      const rest = parts[k].filter(n => n.startBeat >= BPB)
      parts[k] = [...anticipate(firstBar, 0.35), ...rest]
    }
  }

  sections.push({ name: sec.name, bars: sec.bars, parts })

  // ── Motion, per section ───────────────────────────────────────────────────
  const secBeats = sec.bars * BPB
  if (sec.name === 'Intro') {
    // A long filter opening across the whole intro: slow enough to be felt
    // rather than heard as an effect.
    fxBars.push(sweepIn('pad', absBeat, secBeats, { from: 380 }))
  }
  if (sec.name === 'D') {
    // The last time round is the same arrangement, bigger — brightness reads as
    // "more" without anything being added.
    fxBars.push(airLift('ep', absBeat, secBeats, { gain: 1.06 }))
    fxBars.push(airLift('keys', absBeat, secBeats, { gain: 1.05 }))
  }
  if (sec.name === 'A2') {
    // And then it closes down again, so the piece ends by subtraction.
    fxBars.push(sweepIn('pad', absBeat, secBeats, { from: 900 }))
  }
  // A breath before each new section, and the low-pass dip Brae asked for so an
  // arrival lands rather than merely occurring.
  if (absBeat > 0) {
    fxBars.push(dipInto('pad', absBeat, 2))
    fxBars.push(breath('ep', absBeat, { beats: 1.2, depth: 0.7 }))
  }
  // Narrow then wide, just before the biggest section. A size change nobody can
  // point at.
  if (sec.name === 'D') fxBars.push(widthPull('pad', absBeat, 3))

  absBeat += secBeats
  barCursor += sec.bars
}

// ── Instruments ─────────────────────────────────────────────────────────────
// Every one is an Apollo patch, and the registers are kept apart deliberately.
// Open a patch's filter, for this song only.
//
// The shared voices are all quite dark — cutoffHz is 8 * 2500^norm, so the pad
// sits at 293Hz, the choir and rim at 1.4kHz, the EP at 1.9kHz and the keys at
// 2.6kHz. Nothing in the arrangement had ANY energy above 2kHz, and the first
// bounce measured exactly that: 0% air, "dull/dark". Raising an EQ shelf did
// nothing, because a shelf can only lift what is there.
//
// Done here rather than in apollo-voices because darkness is the right default
// for those voices — this piece just needs a window open. The rim matters most:
// with no hats and no cymbals it is the only source of top end in the piece.
const brighter = (patch, cutoff) => {
  if (patch.filters?.[0]) patch.filters[0].cutoff = cutoff
  return patch
}

const T = (key, name, instrument, extra = {}) => ({
  key, name, id: uid(), instrument: { type: 'apollo', params: instrument },
  volume: extra.volume ?? 0.8, pan: extra.pan ?? 0, color: extra.color, isDrum: extra.isDrum,
  effects: extra.effects ?? [],
})

const tracks = [
  // LEVELS AND TOP END, set from a measured bounce rather than by eye.
  //
  // The first version measured -19.9 LUFS with 0% of its energy above 2kHz:
  // quiet AND dark, which together is not intimacy, it is a muffled recording.
  // A piece can be soft without being dull — the two get confused because a
  // quiet mix usually also loses its top.
  //
  // So every part came up about 2.5dB, and the high shelves went from +2 to
  // +4/+5. The rim is the biggest single change (0.30 -> 0.44 with a real
  // presence lift): in an arrangement with no hats and no cymbals it is the
  // ONLY source of anything above 2kHz, so it carries the whole top of the
  // piece on its own.
  T('sub',   'Sub',   subBass(),  { volume: 0.46, color: '#7c3aed', effects: [eq3(1, -3, -12, 90, 700, 4000)] }),
  T('kick',  'Kick',  kick(),     { volume: 0.70, color: '#ef4444', isDrum: true }),
  T('rim',   'Rim',   brighter(tick(), 0.80),     { volume: 0.44, color: '#f97316', isDrum: true, pan: 0.18,
                                    effects: [eq3(-6, 0, 6, 300, 1200, 7000), reverb(0.20, 1.1)] }),
  T('bass',  'Bass',  bassVoice(), { volume: 0.60, color: '#22c55e', effects: [eq3(2, 0, -6, 120, 800, 5000), compressor(-18, 3, 2)] }),
  T('pad',   'Pad',   pad(),      { volume: 0.44, color: '#38bdf8', effects: [eq3(-2, 0, 3, 200, 900, 6000), reverb(0.40, 3.4)] }),
  T('ep',    'EP',    brighter(warmEp(), 0.82),   { volume: 0.72, color: '#a78bfa', pan: -0.12,
                                    effects: [eq3(-3, 1, 4, 220, 1000, 6500), reverb(0.26, 2.2), compressor(-20, 2.5, 1.5)] }),
  T('keys',  'Keys',  brighter(keys(), 0.88),     { volume: 0.58, color: '#facc15', pan: 0.16,
                                    effects: [eq3(-6, 0, 5, 300, 1200, 7000), reverb(0.30, 2.6)] }),
  T('choir', 'Choir', brighter(choirish(), 0.76), { volume: 0.40, color: '#f472b6', effects: [eq3(-8, -1, 5, 300, 1100, 7000), reverb(0.44, 3.8)] }),
  T('organ', 'Organ', organ(),    { volume: 0.34, color: '#2dd4bf', pan: -0.22,
                                    effects: [eq3(-5, 1, 2, 260, 1000, 6000), reverb(0.30, 2.4)] }),
]

const built = assemble({
  name: 'Hallway Light',
  bpm: BPM, bpb: BPB, key: 'C#', scale: 'minor', swing: 0,
  tracks, sections, bars: fxBars, masterVolume: 0.84,   // 0.92 peaked at 0.0dBFS and clipped one sample
})

const outPath = join(OUT_DIR, 'Hallway Light.cfproj')
writeFileSync(outPath, JSON.stringify(built.project))

const mins = Math.floor(built.seconds / 60), secs = Math.round(built.seconds % 60)
console.log(`Hallway Light — C# minor, ${BPM} BPM, 3/4`)
console.log(`  ${SECTIONS.length} sections, ${barCursor} bars, ${mins}:${String(secs).padStart(2, '0')}`)
console.log(`  ${built.project.dawProject.arrangementClips.length} clips across ${tracks.length} tracks`)
console.log(`  ${built.project.dawProject.clipEffects.length} effect bars`)
console.log(`  → ${outPath}`)

if (process.argv.includes('--check')) {
  console.log('')
  execFileSync('node', [join(ROOT, 'scripts/check-notes.mjs'), outPath], { stdio: 'inherit' })
}
