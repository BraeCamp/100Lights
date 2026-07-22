// Isomorphic DSP for the learn-article demo clips — runs in the browser (for
// the live admin tuner) and on the server (for the /api/demo-audio route that
// serves the clips). Pure math + Float32Array, no Node or Web Audio deps.
//
// The tunable knobs live in DemoSettings; the admin tuner writes them, and both
// the tuner preview and the served clips render from the same code + settings,
// so what Brae dials in by ear is exactly what ships.

export const SR = 44100

// ── Tunable settings ────────────────────────────────────────────────────────
export interface DemoSettings {
  stemDb: { drums: number; bass: number; pad: number; lead: number } // level trims (dB)
  comp: { threshDb: number; ratio: number; makeupDb: number }         // drum-bus compressor
  eq: { cutDb: number; boostDb: number; freq: number }                // low-mid cut/boost test
  reverb: { shortFb: number; longFb: number; send: number }           // short-vs-long reverb
  hats: { plusDb: number }                                            // hi-hat level test
  duck: { depth: number }                                             // sidechain depth 0..1
}

export const DEFAULT_SETTINGS: DemoSettings = {
  stemDb: { drums: 0, bass: 0, pad: 0, lead: 0 },
  comp: { threshDb: -28, ratio: 5, makeupDb: 6 },
  eq: { cutDb: -14, boostDb: 9, freq: 350 },
  reverb: { shortFb: 0.5, longFb: 0.92, send: 0.6 },
  hats: { plusDb: 5 },
  duck: { depth: 0.85 },
}

/** Merge partial/legacy settings onto the defaults so missing keys never crash. */
export function withDefaults(s?: Partial<DemoSettings> | null): DemoSettings {
  const d = DEFAULT_SETTINGS
  return {
    stemDb: { ...d.stemDb, ...(s?.stemDb ?? {}) },
    comp: { ...d.comp, ...(s?.comp ?? {}) },
    eq: { ...d.eq, ...(s?.eq ?? {}) },
    reverb: { ...d.reverb, ...(s?.reverb ?? {}) },
    hats: { ...d.hats, ...(s?.hats ?? {}) },
    duck: { ...d.duck, ...(s?.duck ?? {}) },
  }
}

const db = (dbv: number) => Math.pow(10, dbv / 20)
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v)
const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12)

// ── primitives ──────────────────────────────────────────────────────────────
let _seed = 987654321
const resetNoise = () => { _seed = 987654321 }
const noise = () => { _seed = (_seed * 1103515245 + 12345) & 0x7fffffff; return (_seed / 0x3fffffff) - 1 }

function biquad(kind: 'lowpass' | 'highpass' | 'peaking', fc: number, q: number, gainDb = 0) {
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0
  fc = clamp(fc, 20, SR * 0.45)
  const w = 2 * Math.PI * fc / SR, cs = Math.cos(w), sn = Math.sin(w), alpha = sn / (2 * q)
  const A = Math.pow(10, gainDb / 40)
  let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number
  if (kind === 'lowpass') { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = b0; a0 = 1 + alpha; a1 = -2 * cs; a2 = 1 - alpha }
  else if (kind === 'highpass') { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = b0; a0 = 1 + alpha; a1 = -2 * cs; a2 = 1 - alpha }
  else { b0 = 1 + alpha * A; b1 = -2 * cs; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * cs; a2 = 1 - alpha / A }
  b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0
  return (x: number) => { const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x; y2 = y1; y1 = y; return y }
}

function osc(type: 'sine' | 'square' | 'triangle' | 'sawtooth', phase: number) {
  const p = phase - Math.floor(phase)
  if (type === 'sine') return Math.sin(2 * Math.PI * p)
  if (type === 'square') return p < 0.5 ? 1 : -1
  if (type === 'triangle') return 4 * Math.abs(p - 0.5) - 1
  return 2 * p - 1
}

const ar = (t: number, on: number, dur: number, attack = 0.005, release = 0.08) => {
  const age = t - on
  if (age < 0 || age > dur + release) return 0
  return Math.min(1, age / attack) * (age > dur ? Math.max(0, 1 - (age - dur) / release) : 1)
}

function drum(kind: string, age: number) {
  if (age < 0) return 0
  if (kind === 'kick') { if (age > 0.4) return 0; const f = 45 + 90 * Math.exp(-age * 45); return Math.sin(2 * Math.PI * f * age) * Math.exp(-age * 8) * 0.9 }
  if (kind === 'snare') { if (age > 0.3) return 0; const e = Math.exp(-age * 22); return (noise() * 0.7 + Math.sin(2 * Math.PI * 190 * age) * 0.35) * e * 0.6 }
  if (kind === 'clap') { if (age > 0.3) return 0; return noise() * Math.exp(-age * 18) * 0.5 }
  if (age > 0.12) return 0; return noise() * Math.exp(-age * 90) * 0.4
}

function makeReverb(fb = 0.8) {
  const combs = [1557, 1617, 1491, 1422].map(n => ({ buf: new Float32Array(n), i: 0, fb }))
  const aps = [225, 556].map(n => ({ buf: new Float32Array(n), i: 0, g: 0.5 }))
  return (x: number) => {
    let y = 0
    for (const c of combs) { const v = c.buf[c.i]; y += v; c.buf[c.i] = x + v * c.fb; c.i = (c.i + 1) % c.buf.length }
    y *= 0.25
    for (const a of aps) { const v = a.buf[a.i]; const out = -a.g * y + v; a.buf[a.i] = y + a.g * out; a.i = (a.i + 1) % a.buf.length; y = out }
    return y
  }
}

// K-weighted gated loudness (linear).
function kloud(L: Float32Array, R: Float32Array) {
  const Rc = Math.exp(-2 * Math.PI * 100 / SR), sc = Math.exp(-2 * Math.PI * 2000 / SR), win = Math.round(0.4 * SR)
  let px = 0, po = 0, shy = 0, acc = 0, cnt = 0, g = 0, gc = 0
  for (let i = 0; i < L.length; i++) {
    const m = (L[i] + R[i]) / 2
    const hp = Rc * (po + m - px); px = m; po = hp
    shy = sc * shy + (1 - sc) * hp
    const kw = hp + (hp - shy) * 0.6
    acc += kw * kw; cnt++
    if (cnt === win) { const ms = acc / win; if (ms > 6.4e-5) { g += ms; gc++ } acc = 0; cnt = 0 }
  }
  if (cnt > 0) { const ms = acc / cnt; if (ms > 6.4e-5) { g += ms; gc++ } }
  return Math.sqrt(g / (gc || 1))
}

type Stereo = { L: Float32Array; R: Float32Array }
const finalizePeak = (x: Stereo[], ceil = 0.89) => {
  let peak = 0
  for (const s of x) for (let i = 0; i < s.L.length; i++) peak = Math.max(peak, Math.abs(s.L[i]), Math.abs(s.R[i]))
  const g = ceil / (peak || 1)
  for (const s of x) for (let i = 0; i < s.L.length; i++) { s.L[i] *= g; s.R[i] *= g }
}

// Match a pair on perceived loudness (or preserve their relative levels), then a
// shared peak ceiling, then an optional trim of the second clip.
function matchPair(a: Stereo, b: Stereo, trimBdb = 0, preserve = false) {
  if (!preserve) {
    const la = kloud(a.L, a.R), lb = kloud(b.L, b.R), target = Math.min(la, lb)
    const scale = (x: Stereo, l: number) => { const g = target / (l || 1); for (let i = 0; i < x.L.length; i++) { x.L[i] *= g; x.R[i] *= g } }
    scale(a, la); scale(b, lb)
  }
  finalizePeak([a, b])
  if (trimBdb) { const t = db(-trimBdb); for (let i = 0; i < b.L.length; i++) { b.L[i] *= t; b.R[i] *= t } }
}

// ── musical content ───────────────────────────────────────────────────────
const BPM = 120, SPB = 60 / BPM, BAR = SPB * 4, STEP = SPB / 4
const CHORDS = [[57, 60, 64], [53, 57, 60], [52, 55, 60], [50, 55, 59]]
const BASSROOT = [33, 29, 36, 31]
const KICK = [0, 4, 8, 12], SNARE = [4, 12], HATS = [0, 2, 4, 6, 8, 10, 12, 14]
const KICK_TIMES = KICK.map(k => k * STEP)

interface MixOpts { drums?: boolean; bass?: boolean; pad?: boolean; lead?: boolean; highpass?: boolean; eqCut?: boolean; eqBoost?: boolean; reverbFb?: number; hatGainDb?: number; pan?: boolean; duck?: boolean; dropBar?: number }

function renderMix(bars: number, opts: MixOpts, S: DemoSettings): Stereo {
  const { drums = true, bass = true, pad = false, lead = false, highpass = false, eqCut = false, eqBoost = false, reverbFb = 0, hatGainDb = 0, pan = false, duck = false, dropBar = -1 } = opts
  const N = Math.round(bars * BAR * SR) + Math.round(0.4 * SR)
  resetNoise()
  const L = new Float32Array(N), R = new Float32Array(N)
  const hpBass = biquad('highpass', 90, 0.7), lpBass = biquad('lowpass', 600, 0.8)
  const hpPad = biquad('highpass', 420, 0.7), hpLead = biquad('highpass', 480, 0.7)
  const eqG = eqBoost ? S.eq.boostDb : S.eq.cutDb
  const busEqL = biquad('peaking', S.eq.freq, 0.9, eqG), busEqR = biquad('peaking', S.eq.freq, 0.9, eqG)
  const padLP = biquad('lowpass', 1600, 0.9)
  const verbL = makeReverb(reverbFb || 0.8), verbR = makeReverb(reverbFb || 0.8)
  const padPh = new Float64Array(12); const leadPh = { p: 0 }, bassPh = { p: 0 }
  const gD = db(S.stemDb.drums), gB = db(S.stemDb.bass), gP = db(S.stemDb.pad), gLd = db(S.stemDb.lead)

  for (let n = 0; n < N; n++) {
    const t = n / SR
    const bar = Math.floor(t / BAR) % 4, barStart = Math.floor(t / BAR) * BAR
    const stepInBar = Math.floor((t % BAR) / STEP)
    const dropped = Math.floor(t / BAR) === dropBar
    let duckGain = 1
    if (duck) {
      const posInBar = t % BAR
      let lastKick = KICK_TIMES[KICK_TIMES.length - 1] - BAR
      for (const kt of KICK_TIMES) if (kt <= posInBar) lastKick = Math.max(lastKick, kt)
      duckGain = 1 - S.duck.depth * Math.exp(-(posInBar - lastKick) * 7)
    }
    let dry = 0, wet = 0, sideL = 0, sideR = 0
    if (drums && !dropped) {
      for (const k of KICK) dry += drum('kick', t - (barStart + k * STEP)) * 0.9 * gD
      for (const s of SNARE) { const v = drum('snare', t - (barStart + s * STEP)) * 0.55 * gD; dry += v; wet += v }
      const hg = db(hatGainDb)
      for (const h of HATS) dry += drum('hat', t - (barStart + h * STEP)) * 0.18 * hg * gD
    }
    if (bass) { bassPh.p += mtof(BASSROOT[bar] + 12) / SR; dry += lpBass(hpBass(osc('sawtooth', bassPh.p))) * 0.34 * gB * duckGain }
    if (pad) {
      let p = 0; const ch = CHORDS[bar]
      for (let v = 0; v < ch.length; v++) { const f = mtof(ch[v] + 12); padPh[v] += (f * 0.997) / SR; padPh[v + 6] += (f * 1.003) / SR; p += osc('sawtooth', padPh[v]) + osc('sawtooth', padPh[v + 6]) }
      p = padLP(p / (ch.length * 2)) * 0.5 * gP
      if (highpass) p = hpPad(p)
      if (pan) { sideL += p * 0.92; sideR += p * 0.18 } else dry += p
    }
    if (lead) {
      const arpNote = CHORDS[bar][stepInBar % CHORDS[bar].length] + 24
      leadPh.p += mtof(arpNote) / SR
      let l = osc('square', leadPh.p) * ar(t, Math.floor(t / STEP) * STEP, STEP * 0.5) * 0.11 * gLd
      if (highpass) l = hpLead(l)
      if (pan) { sideR += l * 0.92; sideL += l * 0.18 } else dry += l
    }
    let busL = dry + sideL, busR = dry + sideR
    if (eqCut || eqBoost) { busL = busEqL(busL); busR = busEqR(busR) }
    if (reverbFb > 0) { const send = S.reverb.send; busL += verbL(wet) * send; busR += verbR(wet * 0.97) * send }
    L[n] = Math.tanh(busL * 0.8); R[n] = Math.tanh(busR * 0.8)
  }
  return { L, R }
}

const stereo = (buf: Float32Array): Stereo => ({ L: buf, R: buf.slice() })

function renderDrumLoop(S: DemoSettings): Float32Array {
  const M = Math.round(4 * BAR * SR) + Math.round(0.4 * SR)
  const buf = new Float32Array(M)
  resetNoise()
  const gD = db(S.stemDb.drums)
  for (let n = 0; n < M; n++) {
    const t = n / SR, barStart = Math.floor(t / BAR) * BAR
    let s = 0
    for (const k of KICK) s += drum('kick', t - (barStart + k * STEP)) * 0.85
    for (const sn of SNARE) s += drum('snare', t - (barStart + sn * STEP)) * 0.55
    for (const h of HATS) s += drum('hat', t - (barStart + h * STEP)) * 0.18
    buf[n] = s * gD
  }
  let peak = 0; for (let i = 0; i < M; i++) peak = Math.max(peak, Math.abs(buf[i]))
  const g = 0.7 / (peak || 1); for (let i = 0; i < M; i++) buf[i] *= g
  return buf
}

function compress(dry: Float32Array, S: DemoSettings): Float32Array {
  const { threshDb: thresh, ratio, makeupDb } = S.comp
  const out = new Float32Array(dry.length)
  const aCoef = Math.exp(-1 / (5 / 1000 * SR)), rCoef = Math.exp(-1 / (110 / 1000 * SR))
  let env = 1e-6
  for (let i = 0; i < dry.length; i++) {
    const x = Math.abs(dry[i])
    env = x > env ? aCoef * env + (1 - aCoef) * x : rCoef * env + (1 - rCoef) * x
    const envDb = 20 * Math.log10(env + 1e-9)
    const grDb = envDb > thresh ? (thresh - envDb) * (1 - 1 / ratio) : 0
    out[i] = dry[i] * db(grDb + makeupDb)
  }
  return out
}

function renderMelody(midi: (number | null)[]): Stereo {
  const M = Math.round((midi.length * SPB + 0.4) * SR); const buf = new Float32Array(M); let ph = 0
  for (let n = 0; n < M; n++) { const t = n / SR, beat = Math.floor(t / SPB), note = midi[beat]; if (note == null) continue; ph += mtof(note) / SR; buf[n] = (osc('triangle', ph) * 0.6 + osc('sine', ph * 2) * 0.2) * ar(t, beat * SPB, SPB * 0.9, 0.005, 0.06) * 0.5 }
  let pk = 0; for (let i = 0; i < M; i++) pk = Math.max(pk, Math.abs(buf[i])); const g = 0.89 / (pk || 1); for (let i = 0; i < M; i++) buf[i] *= g
  return stereo(buf)
}

function renderPedal(withDrone: boolean): Stereo {
  const prog = [[57, 60, 64], [53, 57, 60], [55, 59, 62], [52, 56, 59]], roots = [45, 41, 43, 40]
  const M = Math.round((4 * BAR + 0.4) * SR); const buf = new Float32Array(M); const lp = biquad('lowpass', 1800, 0.8)
  const ph = new Float64Array(4); const dph = { p: 0 }, rph = { p: 0 }
  for (let n = 0; n < M; n++) { const t = n / SR, bar = Math.min(3, Math.floor(t / BAR)); let s = 0; for (let v = 0; v < prog[bar].length; v++) { ph[v] += mtof(prog[bar][v]) / SR; s += osc('triangle', ph[v]) * 0.18 } if (withDrone) { dph.p += mtof(45) / SR; s += osc('sawtooth', dph.p) * 0.3 } else { rph.p += mtof(roots[bar]) / SR; s += osc('sawtooth', rph.p) * 0.3 } buf[n] = lp(s) }
  let pk = 0; for (let i = 0; i < M; i++) pk = Math.max(pk, Math.abs(buf[i])); const g = 0.89 / (pk || 1); for (let i = 0; i < M; i++) buf[i] *= g
  return stereo(buf)
}

function renderSnareLayer(layered: boolean): Stereo {
  const M = Math.round((2 * BAR + 0.3) * SR); const buf = new Float32Array(M); resetNoise()
  for (let n = 0; n < M; n++) { const t = n / SR, barStart = Math.floor(t / BAR) * BAR; let s = 0; for (const k of KICK) s += drum('kick', t - (barStart + k * STEP)) * 0.85; for (const sn of SNARE) s += drum('snare', t - (barStart + sn * STEP)) * 0.6; if (layered) for (const sn of SNARE) s += drum('clap', t - (barStart + sn * STEP + 0.014)) * 0.7; buf[n] = s }
  let pk = 0; for (let i = 0; i < M; i++) pk = Math.max(pk, Math.abs(buf[i])); const g = 0.89 / (pk || 1); for (let i = 0; i < M; i++) buf[i] *= g
  return stereo(buf)
}

function renderLoopClick(clean: boolean): Stereo {
  const oneBar = Math.round(BAR * SR), reps = 4; const buf = new Float32Array(oneBar * reps + Math.round(0.2 * SR)); resetNoise()
  const bar = new Float32Array(oneBar); let ph = 0
  for (let n = 0; n < oneBar; n++) { const t = n / SR; let s = 0; for (const k of KICK) s += drum('kick', t - k * STEP) * 0.8; for (const sn of SNARE) s += drum('snare', t - sn * STEP) * 0.5; for (const h of HATS) s += drum('hat', t - h * STEP) * 0.12; ph += mtof(45) / SR; s += osc('sawtooth', ph) * 0.28; bar[n] = s }
  const fade = Math.round(0.004 * SR)
  if (clean) { for (let i = 0; i < fade; i++) { bar[i] *= i / fade; bar[oneBar - 1 - i] *= i / fade } } else bar[0] += 0.6
  for (let r = 0; r < reps; r++) buf.set(bar, r * oneBar)
  let pk = 0; for (let i = 0; i < buf.length; i++) pk = Math.max(pk, Math.abs(buf[i])); const g = 0.89 / (pk || 1); for (let i = 0; i < buf.length; i++) buf[i] *= g
  return stereo(buf)
}

// ── clips ─────────────────────────────────────────────────────────────────
// Each PAIR renders two clips + a matcher; single clips render one. renderClip
// returns exactly the named clip.
export const CLIP_IDS = [
  'hear-comp-off', 'hear-comp-on', 'hear-eq-cut', 'hear-eq-boost', 'hear-verb-08', 'hear-verb-14',
  'hear-hats-0', 'hear-hats-plus1', 'duck-off', 'duck-on', 'mix-mud', 'mix-hp', 'mix-pan-center', 'mix-pan-wide',
  'loop-clean', 'loop-click', 'pedal-roots', 'pedal-drone', 'hook-identical', 'hook-moved',
  'eight-static', 'eight-developed', 'snare-clean', 'snare-layered', 'gear-competing', 'gear-rebalanced', 'daw-loop',
] as const
export type ClipId = typeof CLIP_IDS[number]

function pair(a: Stereo, b: Stereo, trim = 0, preserve = false): [Stereo, Stereo] { matchPair(a, b, trim, preserve); return [a, b] }

/** Render one clip's stereo buffers from the current settings. */
export function renderClip(id: string, s?: Partial<DemoSettings> | null): Stereo {
  const S = withDefaults(s)
  switch (id) {
    case 'hear-comp-off': case 'hear-comp-on': { const dry = renderDrumLoop(S); const [off, on] = pair(stereo(dry.slice()), stereo(compress(dry, S)), 0.3); return id === 'hear-comp-off' ? off : on }
    case 'hear-eq-cut': case 'hear-eq-boost': { const [c, b] = pair(renderMix(4, { pad: true, eqCut: true }, S), renderMix(4, { pad: true, eqBoost: true }, S)); return id === 'hear-eq-cut' ? c : b }
    case 'hear-verb-08': case 'hear-verb-14': { const [sh, lo] = pair(renderMix(4, { pad: true, reverbFb: S.reverb.shortFb }, S), renderMix(4, { pad: true, reverbFb: S.reverb.longFb }, S)); return id === 'hear-verb-08' ? sh : lo }
    case 'hear-hats-0': case 'hear-hats-plus1': { const [z, p] = pair(renderMix(4, { pad: true }, S), renderMix(4, { pad: true, hatGainDb: S.hats.plusDb }, S), 0, true); return id === 'hear-hats-0' ? z : p }
    case 'duck-off': case 'duck-on': { const [o, on] = pair(renderMix(4, {}, S), renderMix(4, { duck: true }, S)); return id === 'duck-off' ? o : on }
    case 'mix-mud': case 'mix-hp': { const [m, h] = pair(renderMix(4, { pad: true, lead: true }, S), renderMix(4, { pad: true, lead: true, highpass: true }, S)); return id === 'mix-mud' ? m : h }
    case 'mix-pan-center': case 'mix-pan-wide': { const [c, w] = pair(renderMix(4, { pad: true, lead: true }, S), renderMix(4, { pad: true, lead: true, pan: true }, S)); return id === 'mix-pan-center' ? c : w }
    case 'loop-clean': case 'loop-click': { const [c, k] = pair(renderLoopClick(false), renderLoopClick(true)); return id === 'loop-clean' ? c : k }
    case 'pedal-roots': case 'pedal-drone': { const [r, d] = pair(renderPedal(false), renderPedal(true)); return id === 'pedal-roots' ? r : d }
    case 'hook-identical': case 'hook-moved': { const [i, m] = pair(renderMelody([60, 61, 63, 64, 60, 61, 63, 64]), renderMelody([60, 61, 63, 64, 62, 63, 65, 66])); return id === 'hook-identical' ? i : m }
    case 'eight-static': case 'eight-developed': { const [st, dv] = pair(renderMix(16, { pad: true, lead: true }, S), renderMix(16, { pad: true, lead: true, dropBar: 7 }, S)); return id === 'eight-static' ? st : dv }
    case 'snare-clean': case 'snare-layered': { const [c, l] = pair(renderSnareLayer(false), renderSnareLayer(true)); return id === 'snare-clean' ? c : l }
    case 'gear-competing': case 'gear-rebalanced': { const [c, r] = pair(renderMix(4, { pad: true, lead: true }, S), renderMix(4, { pad: true, lead: true, highpass: true }, S)); return id === 'gear-competing' ? c : r }
    case 'daw-loop': { const x = renderMix(8, { pad: true }, S); finalizePeak([x]); return x }
    default: { const x = renderMix(4, { pad: true }, S); finalizePeak([x]); return x }
  }
}

/** Encode stereo buffers to a 16-bit WAV (Uint8Array). */
export function toWav({ L, R }: Stereo): Uint8Array {
  const N = L.length, data = new DataView(new ArrayBuffer(44 + N * 4))
  const w = (o: number, str: string) => { for (let i = 0; i < str.length; i++) data.setUint8(o + i, str.charCodeAt(i)) }
  w(0, 'RIFF'); data.setUint32(4, 36 + N * 4, true); w(8, 'WAVE'); w(12, 'fmt '); data.setUint32(16, 16, true)
  data.setUint16(20, 1, true); data.setUint16(22, 2, true); data.setUint32(24, SR, true); data.setUint32(28, SR * 4, true)
  data.setUint16(32, 4, true); data.setUint16(34, 16, true); w(36, 'data'); data.setUint32(40, N * 4, true)
  for (let i = 0; i < N; i++) { data.setInt16(44 + i * 4, clamp(L[i], -1, 1) * 32767, true); data.setInt16(44 + i * 4 + 2, clamp(R[i], -1, 1) * 32767, true) }
  return new Uint8Array(data.buffer)
}
