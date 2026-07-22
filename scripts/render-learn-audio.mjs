// Renders the audio demos embedded across the learn articles.
//
// Every A/B pair is rendered from the SAME source and differs only in the one
// variable under test, then loudness-matched (equal RMS, shared peak ceiling) —
// so a "before/after" is honest and never wins on volume or extra material.
// Output → public/learn-audio.
import { mkdirSync } from 'fs'
import {
  SR, mtof, clamp, resetNoise, biquad, osc, ar, drumSample, makeReverb, finalize, writeMp3Stereo,
} from './lib/audio-toolkit.mjs'

const OUT = 'public/learn-audio'
mkdirSync(OUT, { recursive: true })
const BPM = 120, SPB = 60 / BPM, BAR = SPB * 4, STEP = SPB / 4

// A-minor loop, one chord per bar: Am – F – C – G.
const CHORDS = [[57, 60, 64], [53, 57, 60], [52, 55, 60], [50, 55, 59]]
const BASSROOT = [33, 29, 36, 31] // A1 F1 C2 G1
const KICK = [0, 4, 8, 12]
const SNARE = [4, 12]
const HATS = [0, 2, 4, 6, 8, 10, 12, 14]
const KICK_TIMES = KICK.map(k => k * STEP)

// Stereo renderer. Builds `bars` bars sample-by-sample; opts toggle the one
// variable each A/B is testing. Returns {L, R}.
function renderMix(bars, opts = {}) {
  const {
    drums = true, bass = true, pad = false, lead = false,
    comp = false, highpass = false, eqCut = false, reverbDecay = 0, hatGainDb = 0,
    pan = false, duck = false, dropBar = -1,
  } = opts
  const N = Math.round(bars * BAR * SR) + Math.round(0.4 * SR)
  resetNoise()
  const L = new Float32Array(N), R = new Float32Array(N)

  const hpBass = biquad('highpass', 90, 0.7)
  const hpPad = biquad('highpass', 260, 0.7)
  const hpLead = biquad('highpass', 320, 0.7)
  const cutPad = biquad('peaking', 300, 1.0, -6)
  const padLP = biquad('lowpass', 1600, 0.9)
  const verbL = makeReverb(), verbR = makeReverb()
  const padPh = new Float64Array(12), leadPh = { p: 0 }, bassPh = { p: 0 }
  let compEnv = 0

  for (let n = 0; n < N; n++) {
    const t = n / SR
    const bar = Math.floor(t / BAR) % 4
    const barStart = Math.floor(t / BAR) * BAR
    const stepInBar = Math.floor((t % BAR) / STEP)
    const dropped = Math.floor(t / BAR) === dropBar

    // Sidechain duck: dip after the most recent kick, ~180 ms recovery.
    let duckGain = 1
    if (duck) {
      const posInBar = t % BAR
      let lastKick = KICK_TIMES[KICK_TIMES.length - 1] - BAR
      for (const kt of KICK_TIMES) if (kt <= posInBar) lastKick = Math.max(lastKick, kt)
      duckGain = 1 - 0.62 * Math.exp(-(posInBar - lastKick) * 6)
    }

    let dry = 0, wet = 0, sideL = 0, sideR = 0

    if (drums && !dropped) {
      for (const k of KICK) dry += drumSample('kick', t - (barStart + k * STEP)) * 0.9
      for (const s of SNARE) { const v = drumSample('snare', t - (barStart + s * STEP)) * 0.5; dry += v; wet += v }
      const hg = Math.pow(10, hatGainDb / 20)
      for (const h of HATS) dry += drumSample('hat', t - (barStart + h * STEP)) * 0.14 * hg
    }

    if (bass) {
      bassPh.p += mtof(BASSROOT[bar] + 12) / SR
      dry += hpBass(osc('sawtooth', bassPh.p) * 0.5) * duckGain
    }

    if (pad) {
      let p = 0
      const ch = CHORDS[bar]
      for (let v = 0; v < ch.length; v++) {
        const f = mtof(ch[v] + 12)
        padPh[v] += (f * 0.997) / SR; padPh[v + 6] += (f * 1.003) / SR
        p += osc('sawtooth', padPh[v]) + osc('sawtooth', padPh[v + 6])
      }
      p = padLP(p / (ch.length * 2)) * 0.5
      if (highpass) p = hpPad(p)
      if (eqCut) p = cutPad(p)
      if (pan) { sideL += p * 0.92; sideR += p * 0.18 } else dry += p
    }

    if (lead) {
      const arpNote = CHORDS[bar][stepInBar % CHORDS[bar].length] + 24
      leadPh.p += mtof(arpNote) / SR
      let l = osc('square', leadPh.p) * ar(t, Math.floor(t / STEP) * STEP, STEP * 0.5) * 0.16
      if (highpass) l = hpLead(l)
      if (pan) { sideR += l * 0.92; sideL += l * 0.18 } else dry += l
    }

    let busL = dry + sideL, busR = dry + sideR

    if (comp) {
      const level = Math.max(Math.abs(busL), Math.abs(busR))
      compEnv += (level - compEnv) * (level > compEnv ? 0.3 : 0.002)
      let gr = 1
      const thresh = 0.18
      if (compEnv > thresh) gr = Math.pow(thresh / compEnv, 0.6) // ~2.5:1
      busL *= gr * 1.9; busR *= gr * 1.9
    }

    if (reverbDecay > 0) {
      const send = 0.5 + reverbDecay * 0.28
      busL += verbL(wet) * send
      busR += verbR(wet * 0.97) * send
    }

    L[n] = Math.tanh(busL * 0.8)
    R[n] = Math.tanh(busR * 0.8)
  }
  return { L, R }
}

// ── mono demos (return {L, R} with identical channels) ─────────────────────
const stereo = buf => ({ L: buf, R: buf })

function renderMelody(midiPerBeat) {
  const M = Math.round((midiPerBeat.length * SPB + 0.4) * SR)
  const buf = new Float32Array(M)
  let ph = 0
  for (let n = 0; n < M; n++) {
    const t = n / SR
    const beat = Math.floor(t / SPB)
    const note = midiPerBeat[beat]
    if (note == null) continue
    ph += mtof(note) / SR
    const env = ar(t, beat * SPB, SPB * 0.9, 0.005, 0.06)
    buf[n] = (osc('triangle', ph) * 0.6 + osc('sine', ph * 2) * 0.2) * env * 0.5
  }
  return stereo(finalize(buf))
}

function renderPedal(withDrone) {
  const prog = [[57, 60, 64], [53, 57, 60], [55, 59, 62], [52, 56, 59]] // Am F G E
  const roots = [45, 41, 43, 40]
  const M = Math.round((4 * BAR + 0.4) * SR)
  const buf = new Float32Array(M)
  const lp = biquad('lowpass', 1800, 0.8)
  const ph = new Float64Array(4), dph = { p: 0 }, rph = { p: 0 }
  for (let n = 0; n < M; n++) {
    const t = n / SR
    const bar = Math.min(3, Math.floor(t / BAR))
    let s = 0
    for (let v = 0; v < prog[bar].length; v++) { ph[v] += mtof(prog[bar][v]) / SR; s += osc('triangle', ph[v]) * 0.18 }
    if (withDrone) { dph.p += mtof(45) / SR; s += osc('sawtooth', dph.p) * 0.3 }
    else { rph.p += mtof(roots[bar]) / SR; s += osc('sawtooth', rph.p) * 0.3 }
    buf[n] = lp(s)
  }
  return stereo(finalize(buf))
}

function renderSnareLayer(layered) {
  const M = Math.round((2 * BAR + 0.3) * SR)
  const buf = new Float32Array(M)
  resetNoise(4242)
  for (let n = 0; n < M; n++) {
    const t = n / SR
    const barStart = Math.floor(t / BAR) * BAR
    let s = 0
    for (const k of KICK) s += drumSample('kick', t - (barStart + k * STEP)) * 0.85
    for (const sn of SNARE) s += drumSample('snare', t - (barStart + sn * STEP)) * 0.6
    if (layered) for (const sn of SNARE) s += drumSample('clap', t - (barStart + sn * STEP + 0.012)) * 0.4
    buf[n] = s
  }
  return stereo(finalize(buf))
}

function renderLoopClick(clean) {
  const oneBar = Math.round(BAR * SR)
  const reps = 4
  const buf = new Float32Array(oneBar * reps + Math.round(0.2 * SR))
  resetNoise(99)
  const bar = new Float32Array(oneBar)
  let ph = 0
  for (let n = 0; n < oneBar; n++) {
    const t = n / SR
    let s = 0
    for (const k of KICK) s += drumSample('kick', t - k * STEP) * 0.8
    for (const sn of SNARE) s += drumSample('snare', t - sn * STEP) * 0.5
    for (const h of HATS) s += drumSample('hat', t - h * STEP) * 0.12
    ph += mtof(45) / SR; s += osc('sawtooth', ph) * 0.28
    bar[n] = s
  }
  const fade = Math.round(0.004 * SR)
  if (clean) { for (let i = 0; i < fade; i++) { bar[i] *= i / fade; bar[oneBar - 1 - i] *= i / fade } }
  else bar[0] += 0.35 // discontinuity at the seam → audible tick each loop
  for (let r = 0; r < reps; r++) buf.set(bar, r * oneBar)
  return stereo(finalize(buf))
}

// Loudness-match a stereo pair: equal RMS, then a shared peak ceiling.
function matchPair(a, b) {
  const rms = ({ L, R }) => { let s = 0; for (let i = 0; i < L.length; i++) s += L[i] * L[i] + R[i] * R[i]; return Math.sqrt(s / (L.length * 2)) }
  const ra = rms(a), rb = rms(b), target = Math.min(ra, rb)
  const scale = (x, r) => { const g = target / (r || 1); for (let i = 0; i < x.L.length; i++) { x.L[i] *= g; x.R[i] *= g } }
  scale(a, ra); scale(b, rb)
  let peak = 0
  for (const x of [a, b]) for (let i = 0; i < x.L.length; i++) peak = Math.max(peak, Math.abs(x.L[i]), Math.abs(x.R[i]))
  const g = 0.89 / (peak || 1)
  for (const x of [a, b]) for (let i = 0; i < x.L.length; i++) { x.L[i] *= g; x.R[i] *= g }
}

function writePair(n1, n2, a, b) { matchPair(a, b); writeMp3Stereo(`${OUT}/${n1}.mp3`, a.L, a.R); writeMp3Stereo(`${OUT}/${n2}.mp3`, b.L, b.R); console.log(`${n1} / ${n2}`) }
function writeOne(name, x) { writeMp3Stereo(`${OUT}/${name}.mp3`, x.L, x.R); console.log(name) }

// ── Render everything ──────────────────────────────────────────────────────
writePair('hear-comp-off', 'hear-comp-on', renderMix(4, {}), renderMix(4, { comp: true }))
writePair('hear-eq-flat', 'hear-eq-cut', renderMix(4, { pad: true }), renderMix(4, { pad: true, eqCut: true }))
writePair('hear-verb-08', 'hear-verb-14', renderMix(4, { reverbDecay: 0.8 }), renderMix(4, { reverbDecay: 1.4 }))
writePair('hear-hats-0', 'hear-hats-plus1', renderMix(4, { pad: true }), renderMix(4, { pad: true, hatGainDb: 1 }))
writePair('duck-off', 'duck-on', renderMix(4, {}), renderMix(4, { duck: true }))
writePair('mix-mud', 'mix-hp', renderMix(4, { pad: true, lead: true }), renderMix(4, { pad: true, lead: true, highpass: true }))
writePair('mix-pan-center', 'mix-pan-wide', renderMix(4, { pad: true, lead: true }), renderMix(4, { pad: true, lead: true, pan: true }))
writePair('eight-static', 'eight-developed', renderMix(16, { pad: true, lead: true }), renderMix(16, { pad: true, lead: true, dropBar: 7 }))
writePair('gear-competing', 'gear-rebalanced', renderMix(4, { pad: true, lead: true }), renderMix(4, { pad: true, lead: true, highpass: true }))
writePair('loop-click', 'loop-clean', renderLoopClick(false), renderLoopClick(true))
writePair('snare-clean', 'snare-layered', renderSnareLayer(false), renderSnareLayer(true))
writePair('hook-identical', 'hook-moved', renderMelody([60, 61, 63, 64, 60, 61, 63, 64]), renderMelody([60, 61, 63, 64, 62, 63, 65, 66]))
writePair('pedal-roots', 'pedal-drone', renderPedal(false), renderPedal(true))
writeOne('daw-loop', renderMix(8, { pad: true }))

console.log('\nDone.')
