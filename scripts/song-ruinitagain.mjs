// "i'd ruin it again" — B♭ minor, 148 BPM. Written to sit inside the measured
// Artemas space (styles/artemas.json), as an ORIGINAL song in that manner —
// not a recreation of any of theirs. None of their melodies, chords or parts are
// here; what is borrowed is the shape the measurements describe.
//
// THE SHAPE CHOSEN, from CRAFT.md §7. Five references, five different kinds of
// record. This one takes the "driving" shape — the 132–152 BPM family, balanced
// sub against bass, harmony well down, most sectional of that group — because
// the half-time shape is what "Cold Signal" already did and the point of a range
// is to pick different points in it.
//
// WHAT THE MEASUREMENTS DICTATED, and it is most of the arrangement:
//
//   · THE BASS IS THE LOUDEST THING. In all five references the bass sits above
//     both drums and voice (−2.4 to −6.5 dB under the summed stems). So the
//     bassline is the song and everything else is staging for it.
//   · THE MIDRANGE IS LEFT EMPTY. Brae sings over these. Separating the
//     references showed the voice IS the midrange — take it away and mid falls
//     to 4.3%, highMid to 1.7%. So the harmony here is deliberately thin, short
//     and quiet: stabs rather than pads, ~10 dB under the bass, which is exactly
//     where the references put theirs (−8.5 dB on the track this shape follows).
//   · IT DOES NOT TRAVEL FAR. These records move 3–15.6 dB; ours have been
//     moving 17.7. So the quiet sections here are thinner but not much quieter —
//     the dynamic scale is 0.72–1.0 rather than the 0.42–1.0 used before.
//   · STRAIGHT. Every reference swings 49.5–50.0%. No swing anywhere.
//   · MINOR, FLAT KEY. All five are. B♭ minor, and the loop is the archetype:
//     i – ♭VII – ♭VI – ♭VII, which circles rather than resolves.
//
// The one device is the bass itself: oscillator sync opened by an envelope on
// every note, so the timbre moves even when the note does not.

import { writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { homedir } from 'os'
import { execFileSync } from 'child_process'
import { fileURLToPath } from 'url'
import { uid, N, assemble, dipInto, lift, bar } from './song-kit.mjs'
import { groove, play, voice, parseChord, intoSlot, checkSlots, stagger, densityArc, thin, pump, rng } from './lib/craft.mjs'
import { kick, snare, gritHats, subBass, growlBass, coldKeys, pad as darkPad } from './apollo-voices.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = join(homedir(), 'Desktop', '100lights-ai-renders')
const argv = process.argv.slice(2)
const flagOf = (n, d) => { const a = argv.find(x => x.startsWith(`--${n}=`)); return a ? a.split('=')[1] : d }

const BPM = 148, BPB = 4
const g = groove({ bpm: BPM, feel: 'straight', swing: 0, seed: 8814 })
const rand = rng(8814)

// ── Harmony ─────────────────────────────────────────────────────────────────
// Four bars, one chord each. Simple on purpose: in this idiom the harmony is a
// bed for a voice, and complexity here would compete with the singer as surely
// as loudness would.
const LOOP = ['Bbm9', 'Ab', 'Gbmaj7', 'Ab']
const ROOTS = { Bbm9: 46, Ab: 44, 'Gbmaj7': 42 }

const VOICED = []
let prev = null
for (const sym of LOOP) {
  const v = voice(sym, { style: 'rootless', centre: 63, spread: 9, near: prev }).slice(0, 3)
  VOICED.push(v)
  prev = v
}

const SLOT = { sub: 'sub', bass: 'bass', keys: 'upper', pad: 'lowChord' }
const clash = checkSlots(SLOT)
if (clash.length) throw new Error('register collision: ' + clash.join('; '))

// ── Parts ───────────────────────────────────────────────────────────────────
const KICK = 24, CLAP = 48, HAT = 60

/** Four on the floor — the driving shape. */
const kickBar = ({ on = true } = {}) => on
  ? Array.from({ length: 4 }, (_, b) => ({ pitch: KICK, beat: b, durationBeats: 0.35, velocity: b === 0 ? 108 : 100 }))
  : []

const clapBar = ({ fill = false } = {}) => {
  const out = [1, 3].map(b => ({ pitch: CLAP, beat: b, durationBeats: 0.25, velocity: 100 }))
  if (fill) for (const b of [3.5, 3.75]) out.push({ pitch: CLAP, beat: b, durationBeats: 0.15, velocity: 68 + (b - 3.5) * 90 })
  return out
}

/** Closed on the beat, open on the offbeat — what stops four-on-the-floor
 *  stamping, and the only part carrying anything above 2 kHz. */
const hatBar = ({ sixteenths = false } = {}) => {
  const out = []
  for (let i = 0; i < 8; i++) {
    const b = i * 0.5
    const off = i % 2 === 1
    out.push({ pitch: HAT, beat: b, durationBeats: off ? 0.26 : 0.05, velocity: off ? 66 : 48 })
  }
  if (sixteenths) for (let i = 0; i < 8; i++) if (rand() < 0.45) out.push({ pitch: HAT, beat: i * 0.5 + 0.25, durationBeats: 0.04, velocity: 32 })
  return out
}

const subBar = (i) => {
  const root = intoSlot(ROOTS[LOOP[i % 4]] - 12, 'sub')
  return [{ pitch: root, beat: 0, durationBeats: BPB - 0.25, velocity: 90 }]
}

/**
 * The song. Sixteenth syncopation with an octave pop, resting across the second
 * half of beat two so the four-four kick has somewhere to breathe.
 */
const bassBar = (i, { lean = false } = {}) => {
  const c = LOOP[i % 4]
  const root = intoSlot(ROOTS[c], 'bass')
  const tones = parseChord(c).tones
  const fifth = root + (tones.find(t => t === 7) ?? 7)
  const seventh = root + (tones.find(t => t === 10 || t === 11) ?? 10)
  const fig = lean
    ? [[root, 0, 0.55, 106], [root, 1.5, 0.3, 88], [fifth, 2.5, 0.5, 92]]
    : [[root, 0, 0.28, 108], [root, 0.5, 0.18, 84], [root + 7, 0.75, 0.22, 96],
       [root, 1.5, 0.26, 100], [seventh, 2.25, 0.2, 86], [root, 2.5, 0.24, 102],
       [fifth, 3.25, 0.3, 92], [root + 7, 3.75, 0.2, 80]]
  return fig.map(([p, b, d, v]) => ({ pitch: intoSlot(p, 'bass'), beat: b, durationBeats: d, velocity: v }))
}

/** Stabs, not a pad: short, off the downbeat, and quiet. The harmonic layer in
 *  these records sits 8–20 dB under the bass, and this is how you get there
 *  without simply turning a sustained part down until it is mush. */
const keysBar = (i, { sparse = false } = {}) => {
  const v = VOICED[i % 4]
  const hits = sparse ? [[2.5, 0.3, 58]] : [[0.75, 0.22, 66], [2.5, 0.3, 62]]
  const out = []
  for (const [b, d, vel] of hits) {
    v.forEach((p, k) => out.push({ pitch: intoSlot(p, 'upper'), beat: b + k * 0.005, durationBeats: d, velocity: vel - k * 4 }))
  }
  return out
}

/** One held chord low and very quiet — the floor under everything, not a voice. */
const padBar = (i) => VOICED[i % 4].map(p => ({
  pitch: intoSlot(p, [52, 64]), beat: 0, durationBeats: BPB - 0.2, velocity: 34,
}))

// ── Form ────────────────────────────────────────────────────────────────────
// Five sections, matching the shape this follows. The break thins rather than
// empties: these records do not drop to nothing.
const FORM = [
  { name: 'Open',   bars: 8,  energy: 0.30, want: ['sub', 'bass', 'pad'] },
  { name: 'Drive',  bars: 16, energy: 0.80, want: ['sub', 'bass', 'pad', 'kick', 'hats'] },
  { name: 'Turn',   bars: 8,  energy: 1.00, want: ['sub', 'bass', 'pad', 'kick', 'hats', 'clap', 'keys'] },
  { name: 'Thin',   bars: 8,  energy: 0.42, want: ['sub', 'bass', 'pad', 'hats'] },
  { name: 'Drive 2', bars: 16, energy: 0.96, want: ['sub', 'bass', 'pad', 'kick', 'hats', 'clap', 'keys'] },
  { name: 'Close',  bars: 8,  energy: 0.34, want: ['sub', 'bass', 'pad'] },
]
const { sections: staggered, unresolved } = stagger(FORM, { maxChurn: 2 })
if (unresolved.length) console.warn('arrangement:\n  ' + unresolved.join('\n  '))
const DENSITY = densityArc(FORM.map(s => s.energy))

export function build() {
  const tracks = [
    { key: 'kick', id: uid(), name: 'Kick', presetId: null, volume: 0.72, color: '#f0abfc', instrument: { type: 'apollo', params: kick() } },
    { key: 'clap', id: uid(), name: 'Clap', presetId: null, volume: 0.92, color: '#f472b6', instrument: { type: 'apollo', params: snare() } },
    { key: 'hats', id: uid(), name: 'Hats', presetId: null, volume: 0.30, pan: 0.18, color: '#fda4af', instrument: { type: 'apollo', params: gritHats() } },
    { key: 'sub',  id: uid(), name: 'Sub',  presetId: null, volume: 0.52, color: '#c084fc', instrument: { type: 'apollo', params: subBass() } },
    // The loudest fader in the song, because that is what the references do.
    { key: 'bass', id: uid(), name: 'Bass', presetId: null, volume: 0.53, color: '#a78bfa',
      instrument: { type: 'apollo', params: (() => {
        const p = growlBass()
        // A sync'd saw through a resonant ladder has a WEAK fundamental — its
        // energy sits in the harmonics, which is why the bass measured 76% low-mid
        // at a 247 Hz centroid while the 60-120 Hz band, where a bass actually
        // lives, read empty. Faders could not fix that; only the sound could.
        // growlBass's second oscillator is a sine an octave DOWN, which doubles
        // the Sub. Moved to unison with the fundamental and turned up, it becomes
        // the body of the note instead.
        p.oscs[1].octave = 0
        p.oscs[1].level = 0.62
        return p
      })() } },
    { key: 'keys', id: uid(), name: 'Keys', presetId: null, volume: 0.18, pan: -0.20, color: '#7dd3fc', instrument: { type: 'apollo', params: coldKeys() } },
    { key: 'pad',  id: uid(), name: 'Pad',  presetId: null, volume: 0.05, pan: 0.12, color: '#94a3b8', instrument: { type: 'apollo', params: darkPad() } },
  ]

  const sections = staggered.map((sec, si) => {
    const on = new Set(sec.layers)
    const density = DENSITY[si]
    const parts = {}
    const push = (k, ns) => { (parts[k] ??= []).push(...ns) }

    for (let i = 0; i < sec.bars; i++) {
      const at = i * BPB
      const last = i === sec.bars - 1
      const busy = density > 0.7
      const shift = ns => ns.map(n => ({ ...n, beat: n.beat + at }))

      if (on.has('sub')) push('sub', shift(subBar(i)))
      if (on.has('bass')) push('bass', shift(bassBar(i, { lean: density < 0.5 })))
      if (on.has('pad')) push('pad', shift(padBar(i)))
      if (on.has('kick')) push('kick', shift(kickBar()))
      if (on.has('clap')) push('clap', shift(clapBar({ fill: last && busy })))
      if (on.has('hats')) push('hats', shift(hatBar({ sixteenths: busy })))
      if (on.has('keys')) push('keys', shift(keysBar(i, { sparse: !busy })))
    }

    if (density < 0.5 && parts.hats) parts.hats = thin(parts.hats, 0.55, { bpb: BPB })

    // Narrow on purpose. These records travel 3–15.6 dB and ours were moving
    // 17.7; a section here is thinner in texture without dropping much in level.
    const dyn = 0.72 + 0.28 * density

    const ROLE = { kick: 'kick', clap: 'clap', hats: 'hats', sub: 'sub', bass: 'bass', keys: 'keys', pad: 'pad' }
    const played = {}
    for (const [k, ns] of Object.entries(parts)) {
      played[k] = play(ns, ROLE[k] ?? 'default', g, { bpb: BPB })
        .map(n => N(n.pitch, n.beat, n.durationBeats, Math.max(1, Math.round(n.velocity * dyn))))
    }
    return { name: sec.name, bars: sec.bars, parts: played }
  })

  // ── Dynamics in the FX lane ───────────────────────────────────────────────
  const at = {}
  let acc = 0
  for (const s of staggered) { at[s.name] = acc; acc += s.bars * BPB }
  const W = b => b * BPB

  const bars = [
    // Standing filters, not gestures: the pad is a floor under the record and
    // has no business in the singer's octave, and the bass's sync harmonics were
    // landing in the low mids instead of the bass band.
    bar('pad', 0, acc, { filterHz: 460 }, [[0, 1], [acc, 1]], 3),
    bar('bass', 0, acc, { filterHz: 520 }, [[0, 1], [acc, 1]], 3),
    // The pump is the four-four signature — everything harmonic ducks on the
    // kick. Written as a curve so it stays visible and editable.
    pump('pad', at['Drive'], W(16), { depth: 0.55, recover: 0.62 }),
    pump('pad', at['Turn'], W(8), { depth: 0.52, recover: 0.62 }),
    pump('pad', at['Drive 2'], W(16), { depth: 0.52, recover: 0.62 }),
    pump('keys', at['Drive 2'], W(16), { depth: 0.7, recover: 0.5 }),

    // Close the filter into each arrival so it lands without needing more level.
    dipInto('bass', at['Turn'], 2),
    dipInto('bass', at['Drive 2'], 2),
    dipInto('keys', at['Drive 2'], 3, 1),

    // Drive across the peaks — the bass gets grittier rather than louder.
    lift('bass', at['Turn'], W(8), { drive: 0.07, gain: 1.08 }),
    lift('bass', at['Drive 2'], W(16), { drive: 0.06, gain: 1.06 }),

    // The thin section sits behind a filter and opens on the way out of it.
    bar('bass', at['Thin'], W(8), { filterHz: 900 }, [[0, 0.85], [W(6), 0.85], [W(8), 0]], 1),
    bar('pad', at['Thin'], W(8), { reverbWet: 0.4 }, [[0, 0], [W(2), 1], [W(8), 1]], 1),

    // Outro: parts leave, tails ring.
    bar('bass', at['Close'] + W(4), W(4), { gain: 0.25, filterHz: 700 }, [[0, 0], [W(4), 1]], 2),
    bar('sub', at['Close'] + W(5), W(3), { gain: 0.3 }, [[0, 0], [W(3), 1]], 0),
  ]

  return assemble({
    name: "i'd ruin it again", bpm: BPM, bpb: BPB, key: 'Bb', scale: 'minor',
    swing: 0, tracks, sections, bars, masterVolume: 0.34,
  })
}

// ── Run ─────────────────────────────────────────────────────────────────────
const built = build()
mkdirSync(OUT_DIR, { recursive: true })
const label = flagOf('label', "i'd ruin it again")
const outFile = join(flagOf('out', OUT_DIR), `${label}.cfproj`)
writeFileSync(outFile, JSON.stringify(built.project))

const clips = built.project.dawProject.arrangementClips
console.log(`${label} — ${BPM} BPM, Bb minor, ${built.seconds.toFixed(0)}s, ${clips.length} clips, ` +
  `${clips.reduce((a, c) => a + c.notes.length, 0)} notes, ${built.project.dawProject.clipEffects.length} fx bars`)
for (const s of staggered) console.log(`  ${s.name.padEnd(8)} ${String(s.bars).padStart(2)} bars  ${s.layers.join(' ')}`)
console.log(`→ ${outFile}`)

if (argv.includes('--listen')) {
  execFileSync('node', ['--experimental-strip-types', join(ROOT, 'scripts/listen.mjs'), outFile, '--style=artemas'],
    { cwd: ROOT, stdio: 'inherit' })
}
