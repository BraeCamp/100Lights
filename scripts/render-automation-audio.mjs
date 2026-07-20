// Renders the audio demos for the automation article.
//
// Three files, all from the SAME notes — the only variable is whether
// anything moves. That's the article's whole argument, so the render has to
// be honest about it: no extra instruments in the "after", no different
// chords, nothing louder. Only motion.
import { writeFileSync } from 'fs'

const SR = 44100
const BPM = 128
const SPB = 60 / BPM              // seconds per beat
const BAR = SPB * 4
const BARS = 16
const DUR = BAR * BARS
const N = Math.round(DUR * SR)

// ── helpers ────────────────────────────────────────────────
const mtof = m => 440 * Math.pow(2, (m - 69) / 12)
const clamp = (v, a, b) => v < a ? a : v > b ? b : v

// Resonant lowpass (RBJ biquad), coefficients recomputed per block so cutoff
// can move without zipper noise.
function makeLP() {
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0, b0 = 1, b1 = 0, b2 = 0, a1 = 0, a2 = 0
  return {
    set(fc, q) {
      fc = clamp(fc, 30, SR * 0.45)
      const w = 2 * Math.PI * fc / SR
      const cs = Math.cos(w), sn = Math.sin(w)
      const alpha = sn / (2 * q)
      const a0 = 1 + alpha
      b0 = ((1 - cs) / 2) / a0
      b1 = (1 - cs) / a0
      b2 = b0
      a1 = (-2 * cs) / a0
      a2 = (1 - alpha) / a0
    },
    run(x) {
      const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
      x2 = x1; x1 = x; y2 = y1; y1 = y
      return y
    },
  }
}

// Schroeder-ish reverb: four combs into two allpasses. Cheap, and good enough
// to make a send move audible, which is all it's here for.
function makeReverb() {
  const combs = [1557, 1617, 1491, 1422].map(n => ({ buf: new Float32Array(n), i: 0, fb: 0.79 }))
  const aps = [225, 556].map(n => ({ buf: new Float32Array(n), i: 0, g: 0.5 }))
  return x => {
    let y = 0
    for (const c of combs) {
      const v = c.buf[c.i]
      y += v
      c.buf[c.i] = x + v * c.fb
      c.i = (c.i + 1) % c.buf.length
    }
    y *= 0.25
    for (const a of aps) {
      const v = a.buf[a.i]
      const out = -a.g * y + v
      a.buf[a.i] = y + a.g * out
      a.i = (a.i + 1) % a.buf.length
      y = out
    }
    return y
  }
}

// Deterministic noise so both renders are bit-identical where they should be.
let seed = 12345
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x3fffffff) - 1

// ── the music (identical for every render) ─────────────────
// Am – F – C – G, one bar each, four times through.
const PROG = [
  [57, 60, 64, 69], // Am
  [53, 57, 60, 65], // F
  [48, 55, 60, 64], // C
  [55, 59, 62, 67], // G
]

// Bass: root for three beats, then the fifth of the same chord on beat 4.
//
// ⚠️ THE RULE: every bass note must be a CHORD TONE of the chord sounding
// above it. Nothing else. No stepwise walks, and above all no "root + N
// semitones" arithmetic.
//
// Two previous attempts both failed, in different ways, and both were audible:
//   1. root + 3 semitones for every bar — lands on G#, D#, A# over F, C, G.
//      Straightforwardly off-key.
//   2. a diatonic step below each root (E under F, B under C) — in key, but a
//      minor 2nd against the chord's root. Down in the bass register a minor
//      2nd is mud, so "in key" was never a strong enough test.
//
// Root-and-fifth can't produce either failure: both notes are in the chord by
// definition, so consonance doesn't depend on getting an interval sum right.
// Octaves are picked so the line voice-leads smoothly (F's fifth goes up to C3
// so it lands on the C bar's root; the rest fall to the fifth below).
const BASS = [
  { root: 45, fifth: 40 }, // Am: A2 → E2
  { root: 41, fifth: 48 }, // F:  F2 → C3
  { root: 48, fifth: 43 }, // C:  C3 → G2
  { root: 43, fifth: 38 }, // G:  G2 → D2
]

const NOTE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const name = m => `${NOTE[m % 12]}${Math.floor(m / 12) - 1}`
// A natural minor / C major — the only pitch classes anything here may use.
const SCALE = new Set([0, 2, 4, 5, 7, 9, 11])

// Fail the render rather than quietly shipping a wrong note. Checks the weak
// condition (in key) AND the strong one (bass notes are chord tones), because
// attempt 2 above passed the weak check and still sounded bad.
function assertHarmony() {
  const bad = []
  for (const [i, ch] of PROG.entries())
    for (const n of ch) if (!SCALE.has(n % 12)) bad.push(`chord ${i}: ${name(n)} out of key`)

  for (const [i, b] of BASS.entries()) {
    const tones = new Set(PROG[i].map(n => n % 12))
    for (const [role, n] of [['root', b.root], ['fifth', b.fifth]]) {
      if (!SCALE.has(n % 12)) bad.push(`bass ${i} ${role}: ${name(n)} out of key`)
      else if (!tones.has(n % 12)) bad.push(`bass ${i} ${role}: ${name(n)} is not a chord tone`)
    }
  }
  if (bad.length) throw new Error(`Harmony check failed — ${bad.join('; ')}`)
}
assertHarmony()

function events() {
  const drums = [], bass = [], chords = []
  for (let bar = 0; bar < BARS; bar++) {
    const t0 = bar * BAR
    const ch = PROG[bar % 4]
    chords.push({ t: t0, notes: ch, dur: BAR })
    for (let b = 0; b < 4; b++) {
      const t = t0 + b * SPB
      drums.push({ t, kind: 'kick' })
      if (b === 1 || b === 3) drums.push({ t, kind: 'snare' })
      drums.push({ t: t + SPB / 2, kind: 'hat' })
      // Bass follows the kick — the article's own advice.
      const bl = BASS[bar % 4]
      bass.push({ t, note: b === 3 ? bl.fifth : bl.root, dur: SPB * 0.42 })
    }
  }
  return { drums, bass, chords }
}

// ── render ─────────────────────────────────────────────────
// `auto` is the only difference between the two full mixes.
// `bassOnly` renders the bass in isolation. It ships nothing — it exists so
// the walk notes can be pitch-checked straight from audio, since in the full
// mix the kick sits on the same frequencies and swamps any detector.
function render({ auto, chordOnly = false, bassOnly = false }) {
  const L = new Float32Array(N), R = new Float32Array(N)
  const { drums, bass, chords } = events()
  const padFilt = [makeLP(), makeLP()]
  const bassFilt = makeLP()
  bassFilt.set(3000, 0.9)
  const verb = [makeReverb(), makeReverb()]
  const padPhase = new Float64Array(16)
  const bassPhase = { p: 0 }

  const BLOCK = 64
  for (let i = 0; i < N; i += BLOCK) {
    const t = i / SR
    const prog = t / DUR

    // --- the automation lanes, and the entire point of the article ---
    // Static render parks each one at a sensible fixed value.
    const padCut  = auto ? 260 * Math.pow(26, prog)      : 1500
    const padGain = auto ? 0.62 + 0.34 * prog            : 0.78
    const send    = auto ? 0.05 + 0.45 * Math.pow(prog, 2.2) : 0.15
    const hatGain = auto ? 0.05 + 0.07 * prog            : 0.09

    padFilt[0].set(padCut, 1.6)
    padFilt[1].set(padCut, 1.6)

    for (let k = 0; k < BLOCK && i + k < N; k++) {
      const n = i + k
      const tt = n / SR
      let dry = 0, wet = 0

      // pad: detuned saw stack through the moving filter
      const ch = chords[Math.min(chords.length - 1, Math.floor(tt / BAR))]
      let pad = 0
      for (let v = 0; v < ch.notes.length; v++) {
        const f = mtof(ch.notes[v])
        for (let d = 0; d < 2; d++) {
          const idx = v * 2 + d
          padPhase[idx] += (f * (d ? 1.004 : 0.997)) / SR
          if (padPhase[idx] > 1) padPhase[idx] -= 1
          pad += (padPhase[idx] * 2 - 1) * 0.5
        }
      }
      pad /= ch.notes.length * 2
      const padL = padFilt[0].run(pad) * padGain
      const padR = padFilt[1].run(pad) * padGain
      if (!bassOnly) {
        dry += padL
        wet += padL * send
      }

      if (!chordOnly) {
        // bass
        for (const b of bass) {
          if (tt < b.t || tt > b.t + b.dur) continue
          const e = Math.exp(-(tt - b.t) * 7) * (1 - Math.exp(-(tt - b.t) * 900))
          bassPhase.p += mtof(b.note) / SR
          if (bassPhase.p > 1) bassPhase.p -= 1
          dry += bassFilt.run(bassPhase.p * 2 - 1) * e * 0.42
        }
        // drums
        for (const d of bassOnly ? [] : drums) {
          const age = tt - d.t
          if (age < 0 || age > 0.5) continue
          if (d.kind === 'kick') {
            const f = 45 + 85 * Math.exp(-age * 45)
            dry += Math.sin(2 * Math.PI * f * age) * Math.exp(-age * 9) * 0.5
          } else if (d.kind === 'snare') {
            const e = Math.exp(-age * 24)
            dry += (rnd() * 0.7 + Math.sin(2 * Math.PI * 190 * age) * 0.35) * e * 0.2
          } else {
            const e = Math.exp(-age * 90)
            const h = rnd() * e * hatGain
            dry += h
            wet += h * send * 0.5
          }
        }
      }

      const rv = verb[0](wet)
      let l = dry + rv * 0.9
      let r = dry + verb[1](wet * 0.96) * 0.9
      // gentle limiting so the automated version can't simply be louder
      l = Math.tanh(l * 0.85)
      r = Math.tanh(r * 0.85)
      L[n] = l
      R[n] = r
    }
  }

  // Normalize both renders to the same peak — otherwise "after" wins by
  // loudness rather than by movement, and the demo lies.
  let peak = 0
  for (let n = 0; n < N; n++) peak = Math.max(peak, Math.abs(L[n]), Math.abs(R[n]))
  const g = 0.89 / (peak || 1)
  // short fades to avoid clicks at the edges
  const fade = Math.round(0.012 * SR)
  for (let n = 0; n < N; n++) {
    let f = 1
    if (n < fade) f = n / fade
    else if (n > N - fade) f = (N - n) / fade
    L[n] *= g * f
    R[n] *= g * f
  }
  return { L, R }
}

function wav({ L, R }) {
  const data = Buffer.alloc(N * 4)
  for (let n = 0; n < N; n++) {
    data.writeInt16LE(Math.round(clamp(L[n], -1, 1) * 32767), n * 4)
    data.writeInt16LE(Math.round(clamp(R[n], -1, 1) * 32767), n * 4 + 2)
  }
  const h = Buffer.alloc(44)
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8)
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20)
  h.writeUInt16LE(2, 22); h.writeUInt32LE(SR, 24); h.writeUInt32LE(SR * 4, 28)
  h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34)
  h.write('data', 36); h.writeUInt32LE(data.length, 40)
  return Buffer.concat([h, data])
}

const out = process.argv[2]
const DIAG = process.argv.includes('--diagnostic')
for (const [name, opts] of [
  ...(DIAG ? [['diagnostic-bass-only', { auto: false, bassOnly: true }]] : []),
  ['automation-before', { auto: false }],
  ['automation-after', { auto: true }],
  ['automation-filter-sweep', { auto: true, chordOnly: true }],
]) {
  writeFileSync(`${out}/${name}.wav`, wav(render(opts)))
  console.log(`${name}.wav`)
}
console.log(`${DUR.toFixed(1)}s each at ${BPM} BPM`)
