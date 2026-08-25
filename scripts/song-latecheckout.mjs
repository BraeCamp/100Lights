// "Late Checkout" — E♭ minor, 76 BPM. Slow, close, reverb-heavy alt-R&B.
//
// WRITTEN THE WAY BRAE ASKED, and the method is the point. Every previous song
// in this set wrote each instrument its own part, and that is exactly how you get
// parts that don't sit together: two players choosing notes independently will
// eventually choose ones that fight. Here there is ONE piano groove — one set of
// voicings, one rhythm — and the instruments are handed its notes.
//
//   voice 0 and 1 (the inner pair)  -> electric piano
//   voice 2        (upper middle)   -> a second, softer keyboard an octave up
//   voice 3        (the top)        -> choir, sparse, only where it lifts
//   the root                        -> sub, and bass an octave above it
//   the whole stack                 -> pad, sustained underneath as glue
//
// Nothing can clash, because nothing is choosing its own notes. Every part is
// the same chord seen from a different height, and the groove's rhythm is shared
// so the parts interlock instead of merely coexisting.
//
// THE RANGES are deliberately separated too, which is the other half of the
// complaint. Sub sits at 52–78Hz, bass an octave above it, the EP in the low
// mids, the second keyboard above that, choir on top. Two instruments in the
// same octave is how a mix turns to mud even when the notes are right.
//
// HARMONY: i – VI – iv – v in E♭ minor (E♭m9 – C♭maj7 – A♭m11 – B♭m7), two bars
// each, close voice leading so the stack barely moves between chords. It never
// resolves properly, which is what keeps it circling — right for music that is
// meant to feel like it is 3am and nothing is being decided.
//
// No lead line anywhere, per the standing rule. In this idiom that is the idiom.

import { writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { homedir } from 'os'
import { execFileSync } from 'child_process'
import { fileURLToPath } from 'url'
import { uid, rng, feel, N, assemble, bar } from './song-kit.mjs'
import { kick, tick, subBass, bass as bassVoice, warmEp, keys, choirish, pad } from './apollo-voices.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = join(homedir(), 'Desktop', '100lights-ai-renders')
mkdirSync(OUT_DIR, { recursive: true })
const argv = process.argv.slice(2)
const flagOf = (n, d) => { const a = argv.find(x => x.startsWith(`--${n}=`)); return a ? a.split('=')[1] : d }

const BPM = 76, BPB = 4
const rand = rng(90210)
const { jitter, vary, chance } = feel(rand, BPM)

// ── The chords, as a stack ──────────────────────────────────────────────────
// `stack` is low→high: the four voices the groove plays. `sub` is the root down
// where a sub belongs, `bass` an octave above it. Voice leading is close on
// purpose — between chords the stack moves by a step or two, never leaps.
// REGISTER MATTERS AS MUCH AS THE NOTES. The first version put this stack at
// F#3–F#4 with the pad an octave below it, so nearly the whole arrangement lived
// under 250Hz and the mix measured 80% sub, 3% mid — mud, and exactly the "these
// don't go together" complaint. The chord is unchanged; it just sits where a
// piano actually sits now, which leaves the bottom two octaves to the bass and
// the sub alone.
const Ebm9  = { name: 'E♭m9',    stack: [66, 70, 73, 77], sub: 39, bass: 51 }
const Cbmj7 = { name: 'C♭maj7',  stack: [66, 71, 75, 78], sub: 35, bass: 47 }
const Abm11 = { name: 'A♭m11',   stack: [68, 71, 75, 78], sub: 32, bass: 44 }
const Bbm7  = { name: 'B♭m7',    stack: [68, 70, 73, 77], sub: 34, bass: 46 }

const LOOP = [Ebm9, Ebm9, Cbmj7, Cbmj7, Abm11, Abm11, Bbm7, Bbm7]

// ── THE PIANO GROOVE ────────────────────────────────────────────────────────
// One bar, written as if for two hands. [voice, beat, duration, velocity].
// Syncopated against a slow tempo so it leans rather than marches: almost
// nothing lands on the downbeat except the low voice.
const GROOVE = [
  [0, 0.00, 1.30, 74],
  [2, 0.50, 0.85, 60],
  [1, 1.25, 0.70, 55],
  [3, 1.75, 1.05, 66],
  [0, 2.50, 0.80, 58],
  [2, 3.00, 0.60, 52],
  [1, 3.50, 1.10, 63],
]
// The same groove with its middle removed — used where the arrangement thins.
const GROOVE_BARE = [GROOVE[0], GROOVE[3], GROOVE[6]]

/**
 * Hand the groove's notes for `voices` to whoever is playing them.
 *
 * `last` clamps a note to the bar line. The groove's final event starts on the
 * "and of four" and rings 0.6 beats into the next bar, which is what gives it
 * its lean — but in the LAST bar of a clip there is no next bar, so the note
 * gets cut at the boundary and clicks. check-notes.mjs flagged all four of them
 * before this ever reached a render.
 */
const fromGroove = (ch, voices, { pattern = GROOVE, octave = 0, vel = 0, last = false } = {}) =>
  pattern
    .filter(([v]) => voices.includes(v))
    .map(([v, b, d, velocity]) => {
      const dur = last ? Math.min(d, Math.max(0.12, BPB - b - 0.02)) : d
      return N(ch.stack[v] + octave, b + jitter(14), dur, vary(velocity + vel, 8))
    })

// ── The parts that are not the groove ───────────────────────────────────────
// The pad holds the whole stack under everything as glue, an octave down so it
// sits beneath the keyboards rather than among them.
// The note stops just short of the bar line. Held for the FULL bar, humanising
// pushes it a few milliseconds past, so bar N is still gated when bar N+1 starts
// and the pad asks for seven notes at once instead of four — 21 voices against a
// limit of 16, which is stealing, which is stuttering. The 2.6s release still
// carries it across the join, so it sounds continuous and costs four voices.
const padBar = (ch, velocity = 26) =>
  ch.stack.map((p, i) => N(p - 12, 0 + jitter(8), BPB - 0.2, vary(velocity - i * 2, 4)))

const subBar = (ch, secondBar, velocity = 88) =>
  secondBar ? [] : [N(ch.sub, 0 + jitter(6), BPB * 1.35, vary(velocity, 4))]

// Bass follows the groove's LOW voice so it locks to the piano instead of
// running its own line.
const bassBar = (ch, { sparse = false } = {}) =>
  (sparse ? [GROOVE[0]] : [GROOVE[0], GROOVE[4]])
    .map(([, b, d, v]) => N(ch.bass, b + jitter(10), Math.max(0.5, d), vary(v + 14, 7)))

// ── Drums: barely there ─────────────────────────────────────────────────────
const KICK = 24, RIM = 60

const kickBar = ({ ghost = false } = {}) => {
  const out = [N(KICK, 0 + jitter(4), 0.5, vary(102, 4))]
  if (ghost) out.push(N(KICK, 2.75 + jitter(5), 0.4, vary(72, 6)))
  return out
}
/** A finger-snap on three, dragging behind the beat the way the genre does. */
const rimBar = ({ extra = false } = {}) => {
  const out = [N(RIM, 2 + 0.018 + jitter(6), 0.18, vary(74, 5))]
  if (extra && chance(0.5)) out.push(N(RIM, 3.75 + jitter(6), 0.14, vary(52, 8)))
  return out
}

function section(bars, layers) {
  const parts = { kick: [], rim: [], sub: [], bass: [], ep: [], keys2: [], choir: [], pad: [] }
  for (let i = 0; i < bars; i++) {
    const ch = LOOP[i % LOOP.length]
    const secondBar = i % 2 === 1
    const at = (notes, target) => notes.forEach(n => parts[target].push({ ...n, startBeat: i * BPB + n.startBeat }))
    const ctx = { i, ch, secondBar, last: i === bars - 1 }
    for (const key of Object.keys(parts)) if (layers[key]) at(layers[key](ctx), key)
  }
  return parts
}

export function build() {
  // Each track occupies its own height. Nothing shares an octave with anything
  // else, which is the other half of "these don't go together".
  const tracks = [
    { key: 'kick',  id: uid(), name: 'Kick',  presetId: null, volume: 0.40, color: '#a78bfa',
      instrument: { type: 'apollo', params: kick() } },
    { key: 'rim',   id: uid(), name: 'Snap',  presetId: null, volume: 0.18, pan: 0.14, color: '#c4b5fd',
      instrument: { type: 'apollo', params: tick() } },
    { key: 'sub',   id: uid(), name: 'Sub',   presetId: null, volume: 0.11, color: '#8b5cf6',
      instrument: { type: 'apollo', params: subBass() } },
    { key: 'bass',  id: uid(), name: 'Bass',  presetId: null, volume: 0.26, color: '#7c3aed',
      instrument: { type: 'apollo', params: bassVoice() } },
    { key: 'ep',    id: uid(), name: 'Piano', presetId: null, volume: 0.46, pan: -0.12, color: '#ddd6fe',
      instrument: { type: 'apollo', params: warmEp() } },
    { key: 'keys2', id: uid(), name: 'Upper', presetId: null, volume: 0.30, pan: 0.20, color: '#e9d5ff',
      instrument: { type: 'apollo', params: keys() } },
    { key: 'choir', id: uid(), name: 'Air',   presetId: null, volume: 0.26, color: '#f5f3ff',
      instrument: { type: 'apollo', params: choirish() } },
    { key: 'pad',   id: uid(), name: 'Pad',   presetId: null, volume: 0.17, color: '#ede9fe',
      instrument: { type: 'apollo', params: pad() } },
  ]

  const sections = [
    // 1. Checkout — the piano alone, filtered down, as if through a wall.
    { name: 'Checkout', bars: 8, parts: section(8, {
        ep:   ({ ch, i, last }) => fromGroove(ch, [0, 1], { pattern: i < 4 ? GROOVE_BARE : GROOVE, last }),
        pad:  ({ ch }) => padBar(ch, 20),
      }) },

    // 2. Room — the low end arrives underneath it.
    { name: 'Room', bars: 12, parts: section(12, {
        kick: ({ i }) => i >= 2 ? kickBar({ ghost: i % 4 === 3 }) : [],
        rim:  ({ i }) => i >= 4 ? rimBar() : [],
        sub:  ({ ch, secondBar }) => subBar(ch, secondBar),
        bass: ({ ch, i }) => i >= 2 ? bassBar(ch, { sparse: i < 6 }) : [],
        ep:   ({ ch, last }) => fromGroove(ch, [0, 1], { last }),
        keys2:({ ch, i }) => i >= 6 ? fromGroove(ch, [2], { vel: -10 }) : [],
        pad:  ({ ch }) => padBar(ch, 24),
      }) },

    // 3. Lift — the top of the stack finally speaks.
    { name: 'Lift', bars: 8, parts: section(8, {
        kick: ({ i }) => kickBar({ ghost: i % 2 === 1 }),
        rim:  ({ last }) => rimBar({ extra: !last }),
        sub:  ({ ch, secondBar }) => subBar(ch, secondBar),
        bass: ({ ch }) => bassBar(ch),
        ep:   ({ ch, last }) => fromGroove(ch, [0, 1], { last }),
        keys2:({ ch }) => fromGroove(ch, [2], { vel: -8 }),
        choir:({ ch, i }) => i % 2 === 0 ? fromGroove(ch, [3], { vel: -14 }) : [],
        pad:  ({ ch }) => padBar(ch, 30),
      }) },

    // 4. Empty — everything but the room itself drops away.
    { name: 'Empty', bars: 6, parts: section(6, {
        ep:   ({ ch, i, last }) => i % 2 === 0 ? fromGroove(ch, [0, 1], { pattern: GROOVE_BARE, last }) : [],
        choir:({ ch }) => fromGroove(ch, [3], { vel: -18 }),
        pad:  ({ ch }) => padBar(ch, 32),
        sub:  ({ ch, secondBar, i }) => i >= 3 ? subBar(ch, secondBar, 74) : [],
      }) },

    // 5. Return — back in, fuller, the upper keyboard doubling the groove.
    { name: 'Return', bars: 10, parts: section(10, {
        kick: () => kickBar({ ghost: true }),
        rim:  ({ i }) => rimBar({ extra: i % 2 === 1 }),
        sub:  ({ ch, secondBar }) => subBar(ch, secondBar),
        bass: ({ ch }) => bassBar(ch),
        ep:   ({ ch, last }) => fromGroove(ch, [0, 1], { last }),
        keys2:({ ch }) => fromGroove(ch, [2], { vel: -6 }),
        choir:({ ch, i }) => i % 2 === 0 ? fromGroove(ch, [3], { vel: -12 }) : [],
        pad:  ({ ch }) => padBar(ch, 30),
      }) },

    // 6. Door — it leaves the way it came.
    { name: 'Door', bars: 4, parts: section(4, {
        ep:   ({ ch, i, last }) => i < 2 ? fromGroove(ch, [0, 1], { pattern: GROOVE_BARE, last }) : [],
        pad:  ({ ch, i }) => padBar(ch, Math.max(10, 26 - i * 5)),
        sub:  ({ ch, secondBar, i }) => i < 2 ? subBar(ch, secondBar, 68) : [],
      }) },
  ]

  const at = {}
  let b = 0
  for (const s of sections) { at[s.name] = b; b += s.bars * BPB }
  const W = n => n * BPB

  const fxBars = [
    // ── The sub has to translate ────────────────────────────────────────────
    // Drive across the whole song. A pure low sine is inaudible on a laptop or a
    // phone; its harmonics at 2x and 3x land where small speakers live, and the
    // ear infers the fundamental from them. Learned the hard way on Undertow.
    bar('sub', 0, W(48), { drive: 0.16 }, [[0, 1], [W(48), 1]], 5),

    // ── Through a wall, then into the room ──────────────────────────────────
    bar('ep',   at['Checkout'], W(8), { filterHz: 620, gain: 0.95 }, [[0, 1], [W(6), 0.4], [W(8), 0]], 1),
    bar('pad',  at['Checkout'], W(8), { filterHz: 500 }, [[0, 1], [W(8), 0.2]], 1),

    // ── Empty: the whole room ducks under one filter and comes back ─────────
    // Four tracks, one shape — that is what makes it read as a single gesture
    // rather than four separate effects.
    bar('ep',    at['Empty'], W(6), { filterHz: 700, gain: 0.86 }, [[0, 0], [W(2), 1], [W(4), 1], [W(6), 0.1]], 1),
    bar('pad',   at['Empty'], W(6), { filterHz: 640 }, [[0, 0], [W(2), 1], [W(4), 1], [W(6), 0.1]], 1),
    bar('choir', at['Empty'], W(6), { reverbWet: 0.5 }, [[0, 0.3], [W(3), 1], [W(6), 0.4]], 2),
    bar('sub',   at['Empty'], W(6), { gain: 0.55 }, [[0, 1], [W(4), 0.5], [W(6), 0]], 4),

    // ── Space, opening as the song opens ────────────────────────────────────
    bar('ep',    at['Room'],   W(12), { reverbWet: 0.26 }, [[0, 0.2], [W(12), 1]], 2),
    bar('keys2', at['Lift'],   W(8),  { reverbWet: 0.38, delayWet: 0.22 }, [[0, 0], [W(3), 1], [W(8), 0.6]], 2),
    bar('choir', at['Lift'],   W(8),  { reverbWet: 0.46 }, [[0, 0.4], [W(8), 1]], 2),

    // ── The upper keyboard drifts right as it enters, and settles ───────────
    bar('keys2', at['Room'] + W(6), W(6), { pan: 0.55 }, [[0, 0], [W(6), 1]], 0),
    bar('keys2', at['Lift'],  W(8),  { pan: 0.45 }, [[0, 1], [W(8), 1]], 0),
    bar('keys2', at['Return'], W(10), { pan: 0.40 }, [[0, 1], [W(10), 1]], 0),

    // ── Return is the loudest thing, and Door lets go ───────────────────────
    bar('ep',   at['Return'], W(10), { gain: 1.08 }, [[0, 0.4], [W(3), 1], [W(10), 1]], 4),
    bar('bass', at['Return'], W(10), { gain: 1.06, drive: 0.04 }, [[0, 0.3], [W(3), 1], [W(10), 1]], 4),

    bar('pad',  at['Door'], W(4), { filterHz: 460, gain: 0.4 }, [[0, 0], [W(4), 1]], 1),
    bar('ep',   at['Door'], W(4), { filterHz: 520, reverbWet: 0.5 }, [[0, 0], [W(4), 1]], 1),
    bar('sub',  at['Door'], W(4), { gain: 0.3 }, [[0, 0], [W(4), 1]], 4),
  ]

  return assemble({
    name: 'Late Checkout', bpm: BPM, bpb: BPB, key: 'D#', scale: 'minor', swing: 0,
    tracks, sections, bars: fxBars, masterVolume: 0.44,
  })
}

const out = build()
const label = 'Late Checkout'
const cfPath = join(OUT_DIR, `${label}.cfproj`)
writeFileSync(cfPath, JSON.stringify(out.project))
console.log(`▸ "${label}" · ${BPM} BPM · E♭ minor · ${out.songBeats / BPB} bars · ${out.seconds.toFixed(1)}s (${Math.floor(out.seconds / 60)}:${String(Math.round(out.seconds % 60)).padStart(2, '0')})`)
for (const t of out.project.dawProject.tracks) {
  const clips = out.project.dawProject.arrangementClips.filter(c => c.trackId === t.id)
  console.log(`  ${t.name.padEnd(7)} ${String(clips.length).padStart(2)} clips / ${String(clips.reduce((n, c) => n + c.notes.length, 0)).padStart(4)} notes`)
}
console.log(`  ${out.project.dawProject.clipEffects.length} effect bars in the FX lane`)
if (argv.includes('--dry')) process.exit(0)

const url = flagOf('url', 'http://localhost:4618')
console.log('▸ rendering through the studio engine…')
execFileSync('node', ['scripts/hear-ai.mjs', `--project=${cfPath}`, `--url=${url}`,
  `--out=${join(OUT_DIR, label + '.mp3')}`, '--keep'], { cwd: ROOT, stdio: 'inherit' })
console.log('▸ mastering to -14 LUFS…')
try {
  execFileSync('ffmpeg', ['-y', '-i', join(OUT_DIR, label + '.wav'),
    '-af', 'loudnorm=I=-14:TP=-1.2:LRA=11', '-codec:a', 'libmp3lame', '-b:a', '256k',
    join(OUT_DIR, `${label} (master).mp3`)], { stdio: ['ignore', 'ignore', 'pipe'] })
  console.log(`  → ${join(OUT_DIR, label + ' (master).mp3')}`)
} catch (e) { console.log('  (mastering failed — raw bounce still valid)', e.message.slice(0, 90)) }
