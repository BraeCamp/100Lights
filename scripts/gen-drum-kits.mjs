#!/usr/bin/env node
// Generate the built-in drum kits' one-shot samples — every kit fully unique.
//
//   node scripts/gen-drum-kits.mjs           → public/drum-kits/<kit>/<pitch>.wav
//
// Each kit is a complete sound-design recipe (oscillator/noise layers, filters,
// drive, crush, room), not a tweak of a shared voice — so switching kits changes
// EVERY pad, not just a few (Brae 2026-08-18). License-clean by construction:
// all sounds are synthesized here, deterministically (seeded noise).
import { writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const SR = 44100
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'drum-kits')

// ── tiny DSP toolkit ─────────────────────────────────────────────────────
let _seed = 1
const srand = (s) => { _seed = s }
const rnd = () => { _seed = (_seed * 16807) % 2147483647; return _seed / 2147483647 * 2 - 1 }

// exponential decay envelope with optional attack
function env(n, { attack = 0.0005, decay = 0.2, curve = 6 } = {}) {
  const a = Math.max(1, attack * SR), out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const t = i / SR
    const at = i < a ? i / a : 1
    out[i] = at * Math.exp(-curve * t / decay)
  }
  return out
}
// sine with exponential pitch sweep f0→f1 over `sweep` seconds
function sweepSine(sec, f0, f1, sweep, { curve = 5, phase = 0 } = {}) {
  const n = Math.round(sec * SR), out = new Float32Array(n)
  let ph = phase
  for (let i = 0; i < n; i++) {
    const t = i / SR
    const k = Math.min(1, t / sweep)
    const f = f1 + (f0 - f1) * Math.exp(-curve * k)
    ph += (2 * Math.PI * f) / SR
    out[i] = Math.sin(ph)
  }
  return out
}
function noise(sec) { const n = Math.round(sec * SR), out = new Float32Array(n); for (let i = 0; i < n; i++) out[i] = rnd(); return out }
// metallic source: stack of detuned square partials (hat/cymbal body)
function metal(sec, base = 3200, partials) {
  partials = partials ?? [1, 1.42, 1.83, 2.21, 2.71, 3.37]
  const n = Math.round(sec * SR), out = new Float32Array(n)
  for (const m of partials) {
    let ph = rnd() * Math.PI
    const f = base * m
    for (let i = 0; i < n; i++) { ph += (2 * Math.PI * f) / SR; out[i] += Math.sign(Math.sin(ph)) / partials.length }
  }
  return out
}
// RBJ biquad — lp/hp/bp
function biquad(x, type, f0, Q = 0.707) {
  const w = 2 * Math.PI * f0 / SR, cw = Math.cos(w), sw = Math.sin(w), al = sw / (2 * Q)
  let b0, b1, b2
  if (type === 'lp') { b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0 }
  else if (type === 'hp') { b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0 }
  else { b0 = al; b1 = 0; b2 = -al }             // bp
  const a0 = 1 + al, a1 = -2 * cw, a2 = 1 - al
  const out = new Float32Array(x.length)
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0
  for (let i = 0; i < x.length; i++) {
    const y = (b0 / a0) * x[i] + (b1 / a0) * x1 + (b2 / a0) * x2 - (a1 / a0) * y1 - (a2 / a0) * y2
    x2 = x1; x1 = x[i]; y2 = y1; y1 = y
    out[i] = y
  }
  return out
}
const mul = (x, e) => { const out = new Float32Array(x.length); for (let i = 0; i < x.length; i++) out[i] = x[i] * (e[i] ?? 0); return out }
const gain = (x, g) => { const out = new Float32Array(x.length); for (let i = 0; i < x.length; i++) out[i] = x[i] * g; return out }
function mix(...xs) {
  const n = Math.max(...xs.map(x => x.length)), out = new Float32Array(n)
  for (const x of xs) for (let i = 0; i < x.length; i++) out[i] += x[i]
  return out
}
const drive = (x, amt) => { const out = new Float32Array(x.length); const k = 1 + amt * 12; for (let i = 0; i < x.length; i++) out[i] = Math.tanh(x[i] * k) / Math.tanh(k * 0.6); return out }
const crush = (x, bits) => { const L = Math.pow(2, bits); const out = new Float32Array(x.length); for (let i = 0; i < x.length; i++) out[i] = Math.round(x[i] * L) / L; return out }
// short room: a few decaying early-reflection taps (mono "glue")
function room(x, { taps = [[0.011, 0.4], [0.023, 0.28], [0.037, 0.18], [0.053, 0.1]], wet = 0.25 } = {}) {
  const extra = Math.round(0.08 * SR)
  const out = new Float32Array(x.length + extra)
  for (let i = 0; i < x.length; i++) out[i] += x[i]
  for (const [dt, g] of taps) {
    const d = Math.round(dt * SR)
    for (let i = 0; i < x.length; i++) out[i + d] += x[i] * g * wet
  }
  return out
}
// noise-tail "plate": bright noise burst shaped to a decay (rock snare / 909 clap)
function plate(sec, { decay = 0.25, lp = 6500, hp = 800, level = 0.5 } = {}) {
  return gain(biquad(biquad(mul(noise(sec), env(Math.round(sec * SR), { decay, curve: 5 })), 'hp', hp), 'lp', lp), level)
}
function normalize(x, peak = 0.94) {
  let m = 0; for (const v of x) m = Math.max(m, Math.abs(v))
  return m > 0 ? gain(x, peak / m) : x
}
function fadeTail(x, sec = 0.008) {
  const n = Math.round(sec * SR)
  for (let i = 0; i < n && i < x.length; i++) x[x.length - 1 - i] *= i / n
  return x
}
function writeWav(path, x) {
  const n = x.length
  const b = Buffer.alloc(44 + n * 2)
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8)
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22)
  b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34)
  b.write('data', 36); b.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(x[i] * 32767))), 44 + i * 2)
  writeFileSync(path, b)
}

// ── shared voice builders (heavily parameterized — recipes differ per kit) ──
function kick({ f0 = 120, f1 = 45, sweep = 0.035, decay = 0.35, click = 0.5, clickHz = 3000, drv = 0.15, lp = 0, sub = 0, len = 0.6 }) {
  const body = mul(sweepSine(len, f0, f1, sweep), env(Math.round(len * SR), { decay, curve: 5.5 }))
  const clk = gain(biquad(mul(noise(0.012), env(Math.round(0.012 * SR), { decay: 0.006, curve: 6 })), 'bp', clickHz, 1.2), click)
  let out = mix(body, clk)
  if (sub > 0) out = mix(out, gain(mul(sweepSine(len, f1 * 1.01, f1 * 0.96, len * 0.8, { curve: 2 }), env(Math.round(len * SR), { decay: decay * 1.4, curve: 4 })), sub))
  out = drive(out, drv)
  if (lp) out = biquad(out, 'lp', lp)
  return out
}
function snare({ tone = 195, toneDecay = 0.09, toneLvl = 0.8, nzDecay = 0.16, nzHp = 900, nzLp = 9000, nzLvl = 1.0, drv = 0.08, bits = 0, plateLvl = 0, plateDecay = 0.22, len = 0.4 }) {
  const n = Math.round(len * SR)
  const body = gain(mul(mix(sweepSine(len, tone * 1.6, tone, 0.02), gain(sweepSine(len, tone * 2.6, tone * 1.5, 0.02), 0.5)), env(n, { decay: toneDecay, curve: 6 })), toneLvl)
  const nz = gain(biquad(biquad(mul(noise(len), env(n, { decay: nzDecay, curve: 5 })), 'hp', nzHp), 'lp', nzLp), nzLvl)
  let out = mix(body, nz)
  if (plateLvl > 0) out = mix(out, plate(len, { decay: plateDecay, level: plateLvl }))
  out = drive(out, drv)
  if (bits) out = crush(out, bits)
  return out
}
function hat({ open = false, base = 3400, hp = 6800, lp = 15000, decay, lvl = 1, metallic = 0.85, nz = 0.35, len, partials }) {
  const d = decay ?? (open ? 0.35 : 0.045)
  const L = len ?? (open ? 0.7 : 0.14)
  const n = Math.round(L * SR)
  const m = gain(mul(metal(L, base, partials), env(n, { decay: d, curve: 5.5 })), metallic)
  const nzz = gain(mul(noise(L), env(n, { decay: d * 0.8, curve: 5.5 })), nz)
  return gain(biquad(biquad(mix(m, nzz), 'hp', hp), 'lp', lp), lvl)
}
function clap({ bursts = 4, gap = 0.011, bp = 1300, q = 1.1, decay = 0.15, tailLvl = 0.5, len = 0.45, bright = 0 }) {
  const n = Math.round(len * SR)
  let out = new Float32Array(n)
  for (let b = 0; b < bursts; b++) {
    const at = Math.round(b * gap * SR)
    const e = env(n - at, { decay: b === bursts - 1 ? decay : 0.008, curve: 6 })
    const nz = mul(noise((n - at) / SR), e)
    for (let i = 0; i < n - at; i++) out[at + i] += nz[i] * (b === bursts - 1 ? 1 : 0.7)
  }
  out = biquad(out, 'bp', bp, q)
  if (bright) out = mix(out, gain(biquad(mul(noise(len), env(n, { decay: decay * 0.8, curve: 6 })), 'hp', 5500), bright))
  if (tailLvl) out = mix(out, plate(len, { decay: decay * 1.3, lp: 5200, level: tailLvl * 0.4 }))
  return out
}
function tom({ f0 = 160, decay = 0.3, nz = 0.12, drv = 0.05, len = 0.55 }) {
  const n = Math.round(len * SR)
  const body = mul(sweepSine(len, f0 * 1.5, f0, 0.04), env(n, { decay, curve: 5 }))
  const skin = gain(biquad(mul(noise(len), env(n, { decay: 0.02, curve: 6 })), 'bp', f0 * 6, 1), nz)
  return drive(mix(body, skin), drv)
}
function crash({ base = 4600, decay = 1.6, hp = 3800, lvl = 0.9, len = 3.2, grit = 0.3 }) {
  const n = Math.round(len * SR)
  const m = mul(metal(len, base, [1, 1.19, 1.53, 1.97, 2.39, 2.87, 3.51, 4.31]), env(n, { attack: 0.001, decay, curve: 3.2 }))
  const nzz = gain(mul(noise(len), env(n, { decay: decay * 0.8, curve: 3 })), grit)
  return gain(biquad(mix(m, nzz), 'hp', hp), lvl)
}
function rim({ f = 830, decay = 0.035, woody = 0.5, len = 0.12, harm = 0, ring = 0, zap = 0, lp = 0 }) {
  const n = Math.round(len * SR)
  const ping = zap > 0
    ? mul(sweepSine(len, f * 3.2, f * 0.8, zap, { curve: 7 }), env(n, { decay, curve: 6 }))
    : mul(sweepSine(len, f, f * 0.97, 0.01), env(n, { decay, curve: 6 }))
  const parts = [ping]
  if (harm > 0) parts.push(gain(mul(sweepSine(len, f * 1.47, f * 1.47, 0.01), env(n, { decay: decay * 0.9, curve: 6 })), harm))
  if (ring > 0) parts.push(gain(mul(sweepSine(len, f * 0.48, f * 0.47, 0.01), env(n, { decay: decay * 2.4, curve: 5 })), ring))
  parts.push(gain(biquad(mul(noise(len), env(n, { decay: 0.01, curve: 6 })), 'bp', 2400, 2), woody))
  let out = mix(...parts)
  if (lp) out = biquad(out, 'lp', lp)
  return out
}

// ── the eight kits — every pad its own recipe ────────────────────────────
// pads: 36 kick · 38 snare · 39 clap · 41 tom-lo · 42 hat · 45 tom-mid · 46 open-hat · 48 tom-hi · 49 crash · 51 rim
const KITS = {
  // clean, balanced acoustic — natural tones, a touch of room
  studio: {
    36: () => room(kick({ f0: 95, f1: 47, sweep: 0.03, decay: 0.36, click: 0.35, clickHz: 3400, drv: 0.06, len: 0.7 }), { wet: 0.12 }),
    38: () => room(snare({ tone: 200, toneLvl: 0.75, nzDecay: 0.15, nzHp: 1100, nzLp: 10500, drv: 0.05 }), { wet: 0.16 }),
    39: () => room(clap({ bursts: 3, gap: 0.009, bp: 1550, decay: 0.1, tailLvl: 0.15 }), { wet: 0.22 }),
    41: () => room(tom({ f0: 98, decay: 0.34 }), { wet: 0.12 }),
    42: () => hat({ base: 3600, hp: 7200, decay: 0.04, partials: [1, 1.34, 1.78, 2.16, 2.62, 3.05] }),
    45: () => room(tom({ f0: 140, decay: 0.3 }), { wet: 0.12 }),
    46: () => hat({ open: true, base: 3600, hp: 6800, decay: 0.32, partials: [1, 1.34, 1.78, 2.16, 2.62, 3.05] }),
    48: () => room(tom({ f0: 190, decay: 0.26 }), { wet: 0.12 }),
    49: () => crash({ base: 4400, decay: 1.7, grit: 0.22 }),
    51: () => room(rim({ f: 1700, decay: 0.05, woody: 0.6, len: 0.18 }), { wet: 0.1 }),
  },
  // dusty hip-hop — saturated, crushed, dark tops
  boombap: {
    36: () => kick({ f0: 82, f1: 44, sweep: 0.028, decay: 0.18, click: 0.2, clickHz: 2200, drv: 0.4, lp: 3600, len: 0.45 }),
    38: () => snare({ tone: 238, toneDecay: 0.07, nzDecay: 0.13, nzHp: 700, nzLp: 6800, drv: 0.3, bits: 12 }),
    39: () => crush(biquad(clap({ bursts: 4, gap: 0.016, bp: 1000, decay: 0.13, tailLvl: 0.35, len: 0.5 }), 'lp', 5600), 11),
    41: () => crush(drive(tom({ f0: 82, decay: 0.18, nz: 0.2, len: 0.4 }), 0.3), 11),
    42: () => hat({ base: 2900, hp: 5200, lp: 11000, decay: 0.055, nz: 0.55, partials: [1, 1.5, 1.9, 2.4] }),
    45: () => drive(tom({ f0: 128, decay: 0.22, nz: 0.18 }), 0.25),
    46: () => hat({ open: true, base: 2900, hp: 4800, lp: 10500, decay: 0.28, nz: 0.55, partials: [1, 1.5, 1.9, 2.4] }),
    48: () => drive(tom({ f0: 172, decay: 0.2, nz: 0.18 }), 0.25),
    49: () => crush(crash({ base: 4100, decay: 1.2, hp: 3200, grit: 0.4, len: 2.2 }), 12),
    51: () => crush(rim({ f: 480, decay: 0.07, woody: 1.1, len: 0.16, lp: 3800 }), 11),
  },
  // big room — long, loud, roomy; gated-plate snare
  rock: {
    36: () => room(kick({ f0: 100, f1: 42, sweep: 0.035, decay: 0.42, click: 0.5, clickHz: 4000, drv: 0.18, sub: 0.3, len: 0.8 }), { wet: 0.2 }),
    38: () => snare({ tone: 215, toneLvl: 0.9, nzDecay: 0.2, nzHp: 900, nzLp: 11500, drv: 0.15, plateLvl: 0.7, plateDecay: 0.3, len: 0.55 }),
    39: () => clap({ bursts: 5, gap: 0.012, bp: 1300, q: 1.4, decay: 0.26, tailLvl: 0.7, len: 0.65 }),
    41: () => room(tom({ f0: 88, decay: 0.5, nz: 0.16, drv: 0.12, len: 0.8 }), { wet: 0.22 }),
    42: () => hat({ base: 4100, hp: 7600, decay: 0.05, nz: 0.3, partials: [1, 1.23, 1.57, 2.03, 2.51, 3.13, 3.77] }),
    45: () => room(tom({ f0: 126, decay: 0.45, nz: 0.16, drv: 0.12, len: 0.75 }), { wet: 0.22 }),
    46: () => hat({ open: true, base: 4100, hp: 7000, decay: 0.42, len: 0.9, partials: [1, 1.23, 1.57, 2.03, 2.51, 3.13, 3.77] }),
    48: () => room(tom({ f0: 175, decay: 0.4, nz: 0.16, drv: 0.12, len: 0.7 }), { wet: 0.22 }),
    49: () => crash({ base: 4800, decay: 2.4, lvl: 1, len: 4.5, grit: 0.35 }),
    51: () => room(rim({ f: 420, decay: 0.12, woody: 0.8, ring: 0.7, len: 0.35 }), { wet: 0.2 }),
  },
  // crisp modern pop — tight lows, sparkly tops, clap-forward
  pop: {
    36: () => kick({ f0: 105, f1: 50, sweep: 0.022, decay: 0.14, click: 0.6, clickHz: 5600, drv: 0.1, len: 0.4 }),
    38: () => snare({ tone: 205, toneDecay: 0.06, toneLvl: 0.6, nzDecay: 0.12, nzHp: 1400, nzLp: 12500, drv: 0.08, plateLvl: 0.25, plateDecay: 0.14 }),
    39: () => clap({ bursts: 4, gap: 0.0095, bp: 1650, q: 1.3, decay: 0.16, tailLvl: 0.45, bright: 0.4 }),
    41: () => tom({ f0: 105, decay: 0.24, nz: 0.1 }),
    42: () => hat({ base: 4500, hp: 8600, decay: 0.03, len: 0.1, partials: [1, 1.41, 2.05, 2.92, 3.6] }),
    45: () => tom({ f0: 150, decay: 0.22, nz: 0.1 }),
    46: () => hat({ open: true, base: 4500, hp: 8000, decay: 0.26, len: 0.6, partials: [1, 1.41, 2.05, 2.92, 3.6] }),
    48: () => tom({ f0: 200, decay: 0.2, nz: 0.1 }),
    49: () => crash({ base: 5200, decay: 1.3, hp: 4400, len: 2.6, grit: 0.18 }),
    51: () => rim({ f: 2400, decay: 0.02, woody: 0.25, len: 0.08 }),
  },
  // four-on-the-floor — 909 lineage: thumpy kick, noisy snare, big open hats
  house: {
    36: () => kick({ f0: 150, f1: 55, sweep: 0.018, decay: 0.27, click: 0.4, clickHz: 2800, drv: 0.24 }),
    38: () => snare({ tone: 165, toneDecay: 0.07, toneLvl: 0.65, nzDecay: 0.2, nzHp: 650, nzLp: 8600, drv: 0.14, plateLvl: 0.45, plateDecay: 0.2, len: 0.45 }),
    39: () => clap({ bursts: 5, gap: 0.014, bp: 1050, q: 0.8, decay: 0.28, tailLvl: 1.0, len: 0.75 }),
    41: () => tom({ f0: 100, decay: 0.36, nz: 0.04, drv: 0.12, len: 0.65 }),
    42: () => hat({ base: 3200, hp: 7400, decay: 0.038, metallic: 1, nz: 0.15, partials: [1, 1.32, 1.68, 2.0, 2.42] }),
    45: () => tom({ f0: 135, decay: 0.28, nz: 0.05, drv: 0.15 }),
    46: () => hat({ open: true, base: 3200, hp: 6600, decay: 0.5, metallic: 1, nz: 0.15, len: 1.0, partials: [1, 1.32, 1.68, 2.0, 2.42] }),
    48: () => tom({ f0: 185, decay: 0.25, nz: 0.05, drv: 0.15 }),
    49: () => crash({ base: 4900, decay: 1.9, len: 3.6, grit: 0.28 }),
    51: () => rim({ f: 1000, decay: 0.06, woody: 0.15, harm: 0.7, len: 0.16 }),
  },
  // soft, dark, laid-back — muffled, crushed, everything rounded off
  lofi: {
    36: () => kick({ f0: 75, f1: 42, sweep: 0.03, decay: 0.22, click: 0.1, clickHz: 1800, drv: 0.2, lp: 2400 }),
    38: () => snare({ tone: 178, toneDecay: 0.07, nzDecay: 0.11, nzHp: 500, nzLp: 4200, drv: 0.16, bits: 10 }),
    39: () => crush(biquad(clap({ bursts: 2, gap: 0.014, bp: 850, decay: 0.11, tailLvl: 0.2 }), 'lp', 3600), 10),
    41: () => biquad(tom({ f0: 85, decay: 0.22, nz: 0.08 }), 'lp', 2800),
    42: () => hat({ base: 2600, hp: 4300, lp: 7800, decay: 0.04, nz: 0.65, lvl: 0.8, partials: [1, 1.62, 2.3] }),
    45: () => biquad(tom({ f0: 120, decay: 0.2, nz: 0.08 }), 'lp', 3200),
    46: () => hat({ open: true, base: 2600, hp: 4000, lp: 7200, decay: 0.24, nz: 0.65, lvl: 0.8, len: 0.55, partials: [1, 1.62, 2.3] }),
    48: () => biquad(tom({ f0: 160, decay: 0.18, nz: 0.08 }), 'lp', 3600),
    49: () => crush(crash({ base: 3800, decay: 1.0, hp: 2800, lvl: 0.7, len: 1.8, grit: 0.5 }), 10),
    51: () => biquad(rim({ f: 350, decay: 0.08, woody: 0.5, len: 0.16 }), 'lp', 2200),
  },
  // deep 808 sub kick, bright crack, ticky hats; 808-style tom sweeps
  trap808: {
    36: () => kick({ f0: 68, f1: 31, sweep: 0.05, decay: 0.55, click: 0.25, clickHz: 2600, drv: 0.3, sub: 0.5, len: 0.9 }),
    38: () => snare({ tone: 210, toneDecay: 0.05, toneLvl: 0.55, nzDecay: 0.14, nzHp: 1800, nzLp: 13500, drv: 0.18, len: 0.35 }),
    39: () => clap({ bursts: 4, gap: 0.008, bp: 1500, q: 1.4, decay: 0.14, tailLvl: 0.4, bright: 0.5 }),
    41: () => drive(mul(sweepSine(0.4, 160, 74, 0.05), env(Math.round(0.4 * SR), { decay: 0.22, curve: 5 })), 0.25),
    42: () => hat({ base: 6200, hp: 10500, decay: 0.018, len: 0.06, metallic: 1.1, nz: 0.08, partials: [1, 1.87, 2.64, 3.9] }),
    45: () => drive(mul(sweepSine(0.38, 220, 104, 0.05), env(Math.round(0.38 * SR), { decay: 0.2, curve: 5 })), 0.25),
    46: () => hat({ open: true, base: 5000, hp: 8600, decay: 0.2, len: 0.45, metallic: 1.1, nz: 0.1, partials: [1, 1.87, 2.64, 3.9] }),
    48: () => drive(mul(sweepSine(0.35, 300, 148, 0.05), env(Math.round(0.35 * SR), { decay: 0.18, curve: 5 })), 0.25),
    49: () => crash({ base: 5100, decay: 1.4, hp: 4600, len: 2.8, grit: 0.2 }),
    51: () => rim({ f: 900, decay: 0.03, woody: 0.1, zap: 0.015, len: 0.09 }),
  },
  // hard driving, raw and minimal — clipped kick with rumble, industrial tops
  techno: {
    36: () => drive(mix(kick({ f0: 118, f1: 44, sweep: 0.018, decay: 0.3, click: 0.3, clickHz: 3200, drv: 0.5 }), gain(biquad(mul(noise(0.35), env(Math.round(0.35 * SR), { decay: 0.25, curve: 4 })), 'lp', 300), 0.4)), 0.3),
    38: () => snare({ tone: 150, toneDecay: 0.03, toneLvl: 0.25, nzDecay: 0.08, nzHp: 2500, nzLp: 8200, drv: 0.5, len: 0.24 }),
    39: () => drive(clap({ bursts: 2, gap: 0.006, bp: 1900, q: 2.0, decay: 0.07, tailLvl: 0.1, len: 0.3 }), 0.35),
    41: () => drive(tom({ f0: 112, decay: 0.13, nz: 0.02, drv: 0.35, len: 0.3 }), 0.25),
    42: () => hat({ base: 2400, hp: 6200, decay: 0.02, len: 0.07, metallic: 1.2, nz: 0.05, partials: [1, 1.11, 1.29, 1.44] }),
    45: () => drive(tom({ f0: 145, decay: 0.18, nz: 0.02, drv: 0.3 }), 0.2),
    46: () => hat({ open: true, base: 3300, hp: 7400, decay: 0.16, len: 0.4, metallic: 1.2, nz: 0.05, partials: [1, 1.11, 1.29, 1.44] }),
    48: () => drive(tom({ f0: 200, decay: 0.16, nz: 0.02, drv: 0.3 }), 0.2),
    49: () => crush(drive(crash({ base: 4000, decay: 0.8, hp: 3000, len: 1.6, grit: 0.6 }), 0.25), 12),
    51: () => hat({ base: 5600, hp: 5000, decay: 0.015, len: 0.05, metallic: 1.2, nz: 0.05, partials: [1, 1.13, 1.31] }),
  },
}

// ── render everything, deterministic per pad ─────────────────────────────
const report = []
for (const [kit, pads] of Object.entries(KITS)) {
  const dir = join(OUT, kit)
  mkdirSync(dir, { recursive: true })
  for (const [pitch, make] of Object.entries(pads)) {
    srand(([...`${kit}:${pitch}`].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7) >>> 0) || 7)
    const x = fadeTail(normalize(make()))
    writeWav(join(dir, `${pitch}.wav`), x)
    report.push({ kit, pitch: +pitch, sec: +(x.length / SR).toFixed(3) })
  }
}
console.log(`rendered ${report.length} one-shots → public/drum-kits/`)
for (const kit of Object.keys(KITS)) {
  const rows = report.filter(r => r.kit === kit)
  console.log(` ${kit.padEnd(8)} ${rows.map(r => `${r.pitch}:${r.sec}s`).join(' ')}`)
}
