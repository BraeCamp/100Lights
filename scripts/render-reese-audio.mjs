// Renders the before/after audio for "Build a Reese Bass From Scratch".
//
// Both files play the SAME riff, the same root, normalized to the same peak —
// so "after" wins on timbre, never on loudness. The only differences are the
// two things the article is about:
//   before → one plain sawtooth, filter open. Raw material.
//   after  → two sawtooths 9 cents apart, low-pass at 620 Hz, resonance 6.
//
// The oscillators are FREE-RUNNING (their phase is never reset between notes),
// because that drift is the growl. Reset the phase per note and you kill the
// exact thing this article exists to demonstrate.
import { writeFileSync } from 'fs'

const SR = 44100
const BPM = 172
const STEP = 60 / BPM / 2          // eighth note
const mtof = m => 440 * Math.pow(2, (m - 69) / 12)
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)

// Resonant low-pass (RBJ biquad) — same design as the automation renderer.
function makeLP(fc, q) {
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0
  const w = 2 * Math.PI * clamp(fc, 30, SR * 0.45) / SR
  const cs = Math.cos(w), sn = Math.sin(w), alpha = sn / (2 * q)
  const a0 = 1 + alpha
  const b0 = ((1 - cs) / 2) / a0, b1 = (1 - cs) / a0, b2 = b0
  const a1 = (-2 * cs) / a0, a2 = (1 - alpha) / a0
  return x => { const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x; y2 = y1; y1 = y; return y }
}

// The article's riff: root, root, fifth, root | octave, root, root, root.
const ROOT = 28 // E1
const RIFF = [0, 0, 7, 0, 12, 0, 0, 0]
const BARS = 4
const STEPS = RIFF.length * BARS
const DUR = STEPS * STEP + 0.4      // small tail
const N = Math.round(DUR * SR)

function render({ voices, detune, cutoff, q }) {
  const buf = new Float32Array(N)
  const lp = makeLP(cutoff, q)
  // One continuous phase per oscillator — never reset.
  const phase = Array.from({ length: voices }, () => 0)
  const ratio = i => (voices === 1 ? 1 : Math.pow(2, (i === 0 ? -detune / 2 : detune / 2) / 1200))

  for (let n = 0; n < N; n++) {
    const t = n / SR
    const stepIndex = Math.floor(t / STEP)
    const midi = ROOT + (RIFF[stepIndex % RIFF.length] ?? 0)
    const f = mtof(midi)

    // Per-note amp envelope: 6 ms attack, hold, release over the last of the note.
    const age = t - stepIndex * STEP
    const noteLen = STEP * 0.85
    const attack = Math.min(1, age / 0.006)
    const release = age > noteLen ? Math.exp(-(age - noteLen) * 45) : 1
    const env = attack * release * 0.85

    let s = 0
    for (let i = 0; i < voices; i++) {
      phase[i] += (f * ratio(i)) / SR
      if (phase[i] > 1) phase[i] -= 1
      s += phase[i] * 2 - 1        // sawtooth
    }
    s /= voices
    buf[n] = lp(s) * env
  }

  // Normalize to a common peak so neither file is louder than the other.
  let peak = 0
  for (let n = 0; n < N; n++) peak = Math.max(peak, Math.abs(buf[n]))
  const g = 0.89 / (peak || 1)
  const fade = Math.round(0.012 * SR)
  for (let n = 0; n < N; n++) {
    let fdev = 1
    if (n < fade) fdev = n / fade
    else if (n > N - fade) fdev = (N - n) / fade
    buf[n] *= g * fdev
  }
  return buf
}

function wav(mono) {
  const data = Buffer.alloc(N * 4)         // 16-bit stereo (same value both channels)
  for (let n = 0; n < N; n++) {
    const v = Math.round(clamp(mono[n], -1, 1) * 32767)
    data.writeInt16LE(v, n * 4)
    data.writeInt16LE(v, n * 4 + 2)
  }
  const h = Buffer.alloc(44)
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8)
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20)
  h.writeUInt16LE(2, 22); h.writeUInt32LE(SR, 24); h.writeUInt32LE(SR * 4, 28)
  h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34)
  h.write('data', 36); h.writeUInt32LE(data.length, 40)
  return Buffer.concat([h, data])
}

const out = process.argv[2] || 'public/learn-audio'
for (const [name, opts] of [
  ['reese-before', { voices: 1, detune: 0, cutoff: 2600, q: 0.9 }],  // plain saw, open filter
  ['reese-after', { voices: 2, detune: 9, cutoff: 620, q: 6 }],      // the Reese
]) {
  writeFileSync(`${out}/${name}.wav`, wav(render(opts)))
  console.log(`${name}.wav`)
}
console.log(`${DUR.toFixed(1)}s each at ${BPM} BPM`)
