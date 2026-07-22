// Renders the audio demos embedded across the learn articles.
//
// Every A/B pair is rendered from the SAME source and differs only in the one
// variable under test, then loudness-matched (equal RMS, shared peak ceiling) —
// so a "before/after" is honest and never wins on volume or extra material.
// Output → public/learn-audio.
import { mkdirSync } from 'fs'
import {
  SR, mtof, clamp, resetNoise, biquad, osc, ar, drumSample, makeReverb, finalize, writeMp3Stereo, kloud,
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
    highpass = false, eqCut = false, reverbFb = 0, hatGainDb = 0,
    pan = false, duck = false, dropBar = -1,
  } = opts
  const N = Math.round(bars * BAR * SR) + Math.round(0.4 * SR)
  resetNoise()
  const L = new Float32Array(N), R = new Float32Array(N)

  const hpBass = biquad('highpass', 90, 0.7)
  const lpBass = biquad('lowpass', 600, 0.8) // tame the raw-sawtooth buzz into a bass tone
  const hpPad = biquad('highpass', 420, 0.7) // deeper high-pass so mud-vs-clear is obvious
  const hpLead = biquad('highpass', 480, 0.7)
  const busEqL = biquad('peaking', 350, 0.9, -14) // big low-mid scoop for the cut-or-boost test
  const busEqR = biquad('peaking', 350, 0.9, -14)
  const padLP = biquad('lowpass', 1600, 0.9)
  const verbL = makeReverb(reverbFb || 0.8), verbR = makeReverb(reverbFb || 0.8)
  const padPh = new Float64Array(12), leadPh = { p: 0 }, bassPh = { p: 0 }

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
      duckGain = 1 - 0.85 * Math.exp(-(posInBar - lastKick) * 7) // deep, obvious pump
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
      dry += lpBass(hpBass(osc('sawtooth', bassPh.p))) * 0.34 * duckGain
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
      if (pan) { sideL += p * 0.92; sideR += p * 0.18 } else dry += p
    }

    if (lead) {
      const arpNote = CHORDS[bar][stepInBar % CHORDS[bar].length] + 24
      leadPh.p += mtof(arpNote) / SR
      let l = osc('square', leadPh.p) * ar(t, Math.floor(t / STEP) * STEP, STEP * 0.5) * 0.11
      if (highpass) l = hpLead(l)
      if (pan) { sideR += l * 0.92; sideL += l * 0.18 } else dry += l
    }

    let busL = dry + sideL, busR = dry + sideR

    // Big low-mid cut across the whole mix (the cut-or-boost test).
    if (eqCut) { busL = busEqL(busL); busR = busEqR(busR) }

    if (reverbFb > 0) {
      const send = 0.9 // strong send so the tail — and its length — is obvious
      busL += verbL(wet) * send
      busR += verbR(wet * 0.97) * send
    }

    L[n] = Math.tanh(busL * 0.8)
    R[n] = Math.tanh(busR * 0.8)
  }
  return { L, R }
}

// ── mono demos (return {L, R} with identical channels) ─────────────────────
// R must be a SEPARATE array — matchPair scales L and R in place, so aliasing
// them would scale each sample twice (a squared gain), which quietly broke the
// level-matching of every mono demo.
const stereo = buf => ({ L: buf, R: buf.slice() })

// Clean drums-only loop for the compression test — no buzzy bass, headroom to
// spare, and NO tanh, so the compressed version can't pick up saturation grit.
function renderDrumLoop() {
  const M = Math.round(4 * BAR * SR) + Math.round(0.4 * SR)
  const buf = new Float32Array(M)
  resetNoise()
  for (let n = 0; n < M; n++) {
    const t = n / SR
    const barStart = Math.floor(t / BAR) * BAR
    let s = 0
    for (const k of KICK) s += drumSample('kick', t - (barStart + k * STEP)) * 0.85
    for (const sn of SNARE) s += drumSample('snare', t - (barStart + sn * STEP)) * 0.55
    for (const h of HATS) s += drumSample('hat', t - (barStart + h * STEP)) * 0.18
    buf[n] = s
  }
  let peak = 0
  for (let i = 0; i < M; i++) peak = Math.max(peak, Math.abs(buf[i]))
  const g = 0.7 / (peak || 1) // leave headroom; no limiter needed
  for (let i = 0; i < M; i++) buf[i] *= g
  return buf
}

// A proper feed-forward compressor: smoothed peak envelope, dB-domain gain
// computer, clean makeup. Brings up the tails/room between hits — the audible
// "glue" — with no distortion. matchPair does the final loudness-match.
// Clean feed-forward compressor: smoothed peak envelope, dB-domain gain, modest
// makeup. No waveshaping, so nothing to saturate. It measurably reduces the
// medium-scale dynamics (the audible "glue"); the explicit RMS match at the
// call site guarantees the result is never louder than the dry clip.
function compress(dry, { thresh = -30, ratio = 8, attackMs = 4, releaseMs = 90, makeupDb = 10 } = {}) {
  const out = new Float32Array(dry.length)
  const aCoef = Math.exp(-1 / (attackMs / 1000 * SR))
  const rCoef = Math.exp(-1 / (releaseMs / 1000 * SR))
  let env = 1e-6
  for (let i = 0; i < dry.length; i++) {
    const x = Math.abs(dry[i])
    env = x > env ? aCoef * env + (1 - aCoef) * x : rCoef * env + (1 - rCoef) * x
    const envDb = 20 * Math.log10(env + 1e-9)
    const grDb = envDb > thresh ? (thresh - envDb) * (1 - 1 / ratio) : 0
    out[i] = dry[i] * Math.pow(10, (grDb + makeupDb) / 20)
  }
  return out
}

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
    if (layered) for (const sn of SNARE) s += drumSample('clap', t - (barStart + sn * STEP + 0.014)) * 0.7
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
  else bar[0] += 0.6 // discontinuity at the seam → obvious tick each loop
  for (let r = 0; r < reps; r++) buf.set(bar, r * oneBar)
  return stereo(finalize(buf))
}

// Loudness-match a stereo pair: equal RMS, then a shared peak ceiling.
// trimBdb (optional) shaves the SECOND clip by N dB after matching — used only
// for the compression pair, where a compressed signal reads a touch louder at
// equal RMS (density), so a small trim keeps it from giving itself away.
function matchPair(a, b, trimBdb = 0, preserve = false) {
  // Match PERCEIVED (K-weighted) loudness, not RMS — RMS-matching leaves a
  // denser/compressed/brighter clip sounding louder. UNLESS `preserve`, where
  // the difference under test IS a small level change on one element (hats
  // +1 dB): there we keep the pair's relative levels and only shared-normalise.
  if (!preserve) {
    const la = kloud(a.L, a.R), lb = kloud(b.L, b.R), target = Math.min(la, lb)
    const scale = (x, l) => { const g = target / (l || 1); for (let i = 0; i < x.L.length; i++) { x.L[i] *= g; x.R[i] *= g } }
    scale(a, la); scale(b, lb)
  }
  let peak = 0
  for (const x of [a, b]) for (let i = 0; i < x.L.length; i++) peak = Math.max(peak, Math.abs(x.L[i]), Math.abs(x.R[i]))
  const g = 0.89 / (peak || 1) // same factor for both, so preserved differences survive
  for (const x of [a, b]) for (let i = 0; i < x.L.length; i++) { x.L[i] *= g; x.R[i] *= g }
  if (trimBdb) { const t = Math.pow(10, -trimBdb / 20); for (let i = 0; i < b.L.length; i++) { b.L[i] *= t; b.R[i] *= t } }
}

function writePair(n1, n2, a, b, trimBdb = 0, preserve = false) { matchPair(a, b, trimBdb, preserve); writeMp3Stereo(`${OUT}/${n1}.mp3`, a.L, a.R); writeMp3Stereo(`${OUT}/${n2}.mp3`, b.L, b.R); console.log(`${n1} / ${n2}`) }
function writeOne(name, x) { writeMp3Stereo(`${OUT}/${name}.mp3`, x.L, x.R); console.log(name) }

// ── Stem-balance diagnostic (node render-learn-audio.mjs --diag) ────────────
if (process.argv.includes('--diag')) {
  const solo = opts => {
    const { L } = renderMix(4, { drums: false, bass: false, pad: false, lead: false, ...opts })
    let s = 0, p = 0
    for (let i = 0; i < L.length; i++) { s += L[i] * L[i]; p = Math.max(p, Math.abs(L[i])) }
    return { rms: +(20 * Math.log10(Math.sqrt(s / L.length) + 1e-9)).toFixed(1), peak: +(20 * Math.log10(p + 1e-9)).toFixed(1), kloud: +(20 * Math.log10(kloud(L, L) + 1e-9)).toFixed(1) }
  }
  console.log('drums:', JSON.stringify(solo({ drums: true })))
  console.log('bass :', JSON.stringify(solo({ bass: true })))
  console.log('pad  :', JSON.stringify(solo({ pad: true })))
  console.log('lead :', JSON.stringify(solo({ lead: true })))
  process.exit(0)
}

// ── Render everything ──────────────────────────────────────────────────────
// Compression: a clean drums-only loop, dry vs compressed. matchPair now
// K-weight-matches the pair (trim 0.3 dB so the compressed clip is a hair
// quieter, never louder).
{ const dry = renderDrumLoop(); writePair('hear-comp-off', 'hear-comp-on', stereo(dry.slice()), stereo(compress(dry)), 0.3) }
writePair('hear-eq-flat', 'hear-eq-cut', renderMix(4, { pad: true }), renderMix(4, { pad: true, eqCut: true }))
writePair('hear-verb-08', 'hear-verb-14', renderMix(4, { reverbFb: 0.5 }), renderMix(4, { reverbFb: 0.92 }))
// preserve=true: the whole test IS the +1 dB on the hats, so don't loudness-match it away.
writePair('hear-hats-0', 'hear-hats-plus1', renderMix(4, { pad: true }), renderMix(4, { pad: true, hatGainDb: 1 }), 0, true)
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
