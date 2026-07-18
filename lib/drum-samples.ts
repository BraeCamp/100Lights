/**
 * Acoustic-style drum synthesis using layered Web Audio techniques.
 * Each sound uses transient + body + texture layers to approximate real drums.
 */

import type { BeatType } from './beat-analyzer'

export type PackId = 'synth' | '808'

export interface DrumPack {
  id: PackId
  name: string
}

export const DRUM_PACKS: DrumPack[] = [
  { id: 'synth', name: 'Acoustic' },
]

// ── Kick ──────────────────────────────────────────────────────────────────────

function synthKick(ctx: AudioContext, when: number, v: number, maxDur: number, dest: AudioNode) {
  const dur = Math.max(0.18, Math.min(0.55, maxDur))

  // Body — sine sweep from ~160 Hz down to ~42 Hz (the "whomp")
  const body = ctx.createOscillator()
  const bodyGain = ctx.createGain()
  body.type = 'sine'
  body.frequency.setValueAtTime(160, when)
  body.frequency.exponentialRampToValueAtTime(42, when + 0.065)
  bodyGain.gain.setValueAtTime(v * 1.0, when)
  bodyGain.gain.exponentialRampToValueAtTime(0.001, when + dur)
  body.connect(bodyGain); bodyGain.connect(dest)
  body.start(when); body.stop(when + dur + 0.05)

  // Click — high-to-mid pitch sweep (the beater "thwack")
  const click = ctx.createOscillator()
  const clickGain = ctx.createGain()
  click.type = 'sine'
  click.frequency.setValueAtTime(650, when)
  click.frequency.exponentialRampToValueAtTime(100, when + 0.028)
  clickGain.gain.setValueAtTime(v * 0.85, when)
  clickGain.gain.exponentialRampToValueAtTime(0.001, when + 0.048)
  click.connect(clickGain); clickGain.connect(dest)
  click.start(when); click.stop(when + 0.055)

  // Noise transient — beater impact texture, low-passed
  const nLen = Math.floor(ctx.sampleRate * 0.022)
  const nBuf = ctx.createBuffer(1, nLen, ctx.sampleRate)
  const nd = nBuf.getChannelData(0)
  for (let i = 0; i < nLen; i++) nd[i] = (Math.random() * 2 - 1) * (1 - i / nLen)
  const nSrc = ctx.createBufferSource(); nSrc.buffer = nBuf
  const nFilt = ctx.createBiquadFilter(); nFilt.type = 'lowpass'; nFilt.frequency.value = 180
  const nGain = ctx.createGain(); nGain.gain.value = v * 0.45
  nSrc.connect(nFilt); nFilt.connect(nGain); nGain.connect(dest)
  nSrc.start(when)
}

// ── Snare ─────────────────────────────────────────────────────────────────────

function synthSnare(ctx: AudioContext, when: number, v: number, dest: AudioNode) {
  // Wire buzz — the snare wire rattle (bandpass noise 1–8 kHz)
  const wireLen = Math.floor(ctx.sampleRate * 0.19)
  const wireBuf = ctx.createBuffer(1, wireLen, ctx.sampleRate)
  const wd = wireBuf.getChannelData(0)
  for (let i = 0; i < wireLen; i++) wd[i] = Math.random() * 2 - 1
  const wireSrc = ctx.createBufferSource(); wireSrc.buffer = wireBuf
  const wireHp = ctx.createBiquadFilter(); wireHp.type = 'highpass'; wireHp.frequency.value = 1100
  const wireBp = ctx.createBiquadFilter(); wireBp.type = 'bandpass'; wireBp.frequency.value = 4500; wireBp.Q.value = 0.5
  const wireGain = ctx.createGain()
  wireGain.gain.setValueAtTime(v * 0.72, when)
  wireGain.gain.exponentialRampToValueAtTime(0.001, when + 0.17)
  wireSrc.connect(wireHp); wireHp.connect(wireBp); wireBp.connect(wireGain); wireGain.connect(dest)
  wireSrc.start(when)

  // Head tone — drum shell resonance (triangle sweep ~280→180 Hz)
  const head = ctx.createOscillator()
  const headGain = ctx.createGain()
  head.type = 'triangle'
  head.frequency.setValueAtTime(280, when)
  head.frequency.exponentialRampToValueAtTime(185, when + 0.035)
  headGain.gain.setValueAtTime(v * 0.5, when)
  headGain.gain.exponentialRampToValueAtTime(0.001, when + 0.07)
  head.connect(headGain); headGain.connect(dest)
  head.start(when); head.stop(when + 0.08)

  // Stick crack — very short broadband burst
  const cLen = Math.floor(ctx.sampleRate * 0.004)
  const cBuf = ctx.createBuffer(1, cLen, ctx.sampleRate)
  const cd = cBuf.getChannelData(0)
  for (let i = 0; i < cLen; i++) cd[i] = (Math.random() * 2 - 1) * (1 - i / cLen)
  const cSrc = ctx.createBufferSource(); cSrc.buffer = cBuf
  const cBp = ctx.createBiquadFilter(); cBp.type = 'bandpass'; cBp.frequency.value = 7000; cBp.Q.value = 0.4
  const cGain = ctx.createGain(); cGain.gain.value = v * 0.65
  cSrc.connect(cBp); cBp.connect(cGain); cGain.connect(dest)
  cSrc.start(when)
}

// ── Hi-hat (closed) ───────────────────────────────────────────────────────────
// Uses 6 metallic oscillators at cymbal-like frequency ratios — same technique
// as the classic TR-808 which is the most realistic achievable in Web Audio.

const HAT_FREQS = [205.3, 304.4, 369.9, 522.8, 635.4, 831.7]

function synthHihat(ctx: AudioContext, when: number, v: number, dest: AudioNode) {
  const dur = 0.062
  const mix = ctx.createGain(); mix.gain.value = v * 0.07; mix.connect(dest)
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7800; hp.connect(mix)
  const env = ctx.createGain(); env.connect(hp)
  env.gain.setValueAtTime(1, when)
  env.gain.exponentialRampToValueAtTime(0.001, when + dur)
  for (const f of HAT_FREQS) {
    const osc = ctx.createOscillator(); osc.type = 'square'; osc.frequency.value = f
    osc.connect(env); osc.start(when); osc.stop(when + dur + 0.005)
  }
}

// ── Hi-hat (open) ─────────────────────────────────────────────────────────────

function synthOpenHihat(ctx: AudioContext, when: number, v: number, dest: AudioNode) {
  const dur = 0.42
  const mix = ctx.createGain(); mix.gain.value = v * 0.065; mix.connect(dest)
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7200; hp.connect(mix)
  const env = ctx.createGain(); env.connect(hp)
  env.gain.setValueAtTime(1, when)
  env.gain.exponentialRampToValueAtTime(0.001, when + dur)
  for (const f of HAT_FREQS) {
    const osc = ctx.createOscillator(); osc.type = 'square'; osc.frequency.value = f
    osc.connect(env); osc.start(when); osc.stop(when + dur + 0.01)
  }
}

// ── Clap ──────────────────────────────────────────────────────────────────────
// Real claps are 3–5 closely-spaced broadband noise bursts.

function synthClap(ctx: AudioContext, when: number, v: number, dest: AudioNode) {
  const bursts: [number, number][] = [[0, 1.0], [0.011, 0.85], [0.024, 0.75], [0.042, 0.60]]
  for (const [off, amp] of bursts) {
    const t = when + off
    const len = Math.floor(ctx.sampleRate * 0.065)
    const buf = ctx.createBuffer(1, len, ctx.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
    const src = ctx.createBufferSource(); src.buffer = buf
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 900
    const g = ctx.createGain()
    g.gain.setValueAtTime(v * amp * 0.68, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.065)
    src.connect(hp); hp.connect(g); g.connect(dest)
    src.start(t)
  }
}

// ── Tom ───────────────────────────────────────────────────────────────────────

function synthTom(ctx: AudioContext, when: number, v: number, note: number, dest: AudioNode) {
  const fundamental = 440 * Math.pow(2, (note - 69) / 12)
  const f0 = Math.max(60, Math.min(180, fundamental))
  const dur = 0.26

  // Body sine — pitched and decaying
  const body = ctx.createOscillator()
  const bodyGain = ctx.createGain()
  body.type = 'sine'
  body.frequency.setValueAtTime(f0 * 3.2, when)
  body.frequency.exponentialRampToValueAtTime(f0, when + 0.04)
  bodyGain.gain.setValueAtTime(v * 0.88, when)
  bodyGain.gain.exponentialRampToValueAtTime(0.001, when + dur)
  body.connect(bodyGain); bodyGain.connect(dest)
  body.start(when); body.stop(when + dur + 0.02)

  // Stick transient
  const cLen = Math.floor(ctx.sampleRate * 0.018)
  const cBuf = ctx.createBuffer(1, cLen, ctx.sampleRate)
  const cd = cBuf.getChannelData(0)
  for (let i = 0; i < cLen; i++) cd[i] = (Math.random() * 2 - 1) * (1 - i / cLen)
  const cSrc = ctx.createBufferSource(); cSrc.buffer = cBuf
  const cLp = ctx.createBiquadFilter(); cLp.type = 'lowpass'; cLp.frequency.value = 300
  const cGain = ctx.createGain(); cGain.gain.value = v * 0.4
  cSrc.connect(cLp); cLp.connect(cGain); cGain.connect(dest)
  cSrc.start(when)
}

// ── Crash cymbal ──────────────────────────────────────────────────────────────

const CRASH_FREQS = [205.3, 304.4, 369.9, 522.8, 635.4, 831.7, 1024.5, 1312.8]

function synthCrash(ctx: AudioContext, when: number, v: number, dest: AudioNode) {
  const dur = 1.5

  // Metallic oscillator cluster
  const mix = ctx.createGain(); mix.gain.value = v * 0.052; mix.connect(dest)
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3800; hp.connect(mix)
  const env = ctx.createGain(); env.connect(hp)
  env.gain.setValueAtTime(1, when)
  env.gain.exponentialRampToValueAtTime(0.001, when + dur)
  for (const f of CRASH_FREQS) {
    const osc = ctx.createOscillator(); osc.type = 'square'; osc.frequency.value = f
    osc.connect(env); osc.start(when); osc.stop(when + dur + 0.02)
  }

  // Broadband noise wash underneath
  const nLen = Math.floor(ctx.sampleRate * 0.7)
  const nBuf = ctx.createBuffer(1, nLen, ctx.sampleRate)
  const nd = nBuf.getChannelData(0)
  for (let i = 0; i < nLen; i++) nd[i] = Math.random() * 2 - 1
  const nSrc = ctx.createBufferSource(); nSrc.buffer = nBuf
  const nHp = ctx.createBiquadFilter(); nHp.type = 'highpass'; nHp.frequency.value = 5000
  const nGain = ctx.createGain()
  nGain.gain.setValueAtTime(v * 0.12, when)
  nGain.gain.exponentialRampToValueAtTime(0.001, when + 0.7)
  nSrc.connect(nHp); nHp.connect(nGain); nGain.connect(dest)
  nSrc.start(when)
}

// ── Rim shot ──────────────────────────────────────────────────────────────────

function synthRim(ctx: AudioContext, when: number, v: number, dest: AudioNode) {
  // Sharp pitched click with quick decay
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = 'square'
  osc.frequency.setValueAtTime(1400, when)
  osc.frequency.exponentialRampToValueAtTime(600, when + 0.008)
  gain.gain.setValueAtTime(v * 0.55, when)
  gain.gain.exponentialRampToValueAtTime(0.001, when + 0.032)
  osc.connect(gain); gain.connect(dest)
  osc.start(when); osc.stop(when + 0.038)

  // Short noise burst for texture
  const nLen = Math.floor(ctx.sampleRate * 0.006)
  const nBuf = ctx.createBuffer(1, nLen, ctx.sampleRate)
  const nd = nBuf.getChannelData(0)
  for (let i = 0; i < nLen; i++) nd[i] = (Math.random() * 2 - 1) * (1 - i / nLen)
  const nSrc = ctx.createBufferSource(); nSrc.buffer = nBuf
  const nBp = ctx.createBiquadFilter(); nBp.type = 'bandpass'; nBp.frequency.value = 2500; nBp.Q.value = 1.2
  const nGain = ctx.createGain(); nGain.gain.value = v * 0.45
  nSrc.connect(nBp); nBp.connect(nGain); nGain.connect(dest)
  nSrc.start(when)
}

function synthOther(ctx: AudioContext, when: number, v: number, dest: AudioNode) {
  synthClap(ctx, when, v, dest)
}

// ── 808 sub kick ──────────────────────────────────────────────────────────────
// Long booming 808 — a sine that drops to a low sustained tone with a soft click.
function synth808(ctx: AudioContext, when: number, v: number, dest: AudioNode) {
  const dur = 0.75
  const body = ctx.createOscillator()
  const g = ctx.createGain()
  body.type = 'sine'
  body.frequency.setValueAtTime(120, when)
  body.frequency.exponentialRampToValueAtTime(46, when + 0.09)
  g.gain.setValueAtTime(0.0001, when)
  g.gain.exponentialRampToValueAtTime(v * 1.05, when + 0.006)
  g.gain.exponentialRampToValueAtTime(0.0008, when + dur)
  // gentle drive for the 808 "growl"
  const shaper = ctx.createWaveShaper()
  const curve = new Float32Array(256)
  for (let i = 0; i < 256; i++) { const x = (i / 128) - 1; curve[i] = Math.tanh(x * 1.8) }
  shaper.curve = curve
  body.connect(g); g.connect(shaper); shaper.connect(dest)
  body.start(when); body.stop(when + dur + 0.05)
  // click transient
  const click = ctx.createOscillator(); const cg = ctx.createGain()
  click.type = 'triangle'
  click.frequency.setValueAtTime(420, when)
  click.frequency.exponentialRampToValueAtTime(90, when + 0.02)
  cg.gain.setValueAtTime(v * 0.5, when)
  cg.gain.exponentialRampToValueAtTime(0.001, when + 0.03)
  click.connect(cg); cg.connect(dest); click.start(when); click.stop(when + 0.04)
}

// ── Ride cymbal ───────────────────────────────────────────────────────────────
// A sustained metallic ping — inharmonic partials with a long shimmering tail.
const RIDE_FREQS = [312, 419, 527, 663, 841, 1021, 1279]
function synthRide(ctx: AudioContext, when: number, v: number, dest: AudioNode) {
  const dur = 0.85
  const mix = ctx.createGain(); mix.gain.value = v * 0.055; mix.connect(dest)
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 5200; bp.Q.value = 0.4; bp.connect(mix)
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3000; hp.connect(bp)
  const env = ctx.createGain(); env.connect(hp)
  env.gain.setValueAtTime(1, when)
  env.gain.exponentialRampToValueAtTime(0.28, when + 0.05)
  env.gain.exponentialRampToValueAtTime(0.001, when + dur)
  for (const f of RIDE_FREQS) {
    const osc = ctx.createOscillator(); osc.type = 'square'; osc.frequency.value = f
    osc.connect(env); osc.start(when); osc.stop(when + dur + 0.02)
  }
  // bell "ping" fundamental
  const ping = ctx.createOscillator(); const pg = ctx.createGain()
  ping.type = 'sine'; ping.frequency.value = 1180
  pg.gain.setValueAtTime(v * 0.12, when); pg.gain.exponentialRampToValueAtTime(0.001, when + 0.4)
  ping.connect(pg); pg.connect(dest); ping.start(when); ping.stop(when + 0.45)
}

// ── Shaker ────────────────────────────────────────────────────────────────────
// Tight high-passed noise with a fast swell — the classic shaker "tss".
function synthShaker(ctx: AudioContext, when: number, v: number, dest: AudioNode) {
  const dur = 0.09
  const len = Math.floor(ctx.sampleRate * (dur + 0.02))
  const buf = ctx.createBuffer(1, len, ctx.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
  const src = ctx.createBufferSource(); src.buffer = buf
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 6500
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 9000; bp.Q.value = 0.7
  const g = ctx.createGain()
  g.gain.setValueAtTime(0.0001, when)
  g.gain.linearRampToValueAtTime(v * 0.5, when + 0.02)
  g.gain.exponentialRampToValueAtTime(0.001, when + dur)
  src.connect(hp); hp.connect(bp); bp.connect(g); g.connect(dest)
  src.start(when)
}

// ── Unified API ───────────────────────────────────────────────────────────────

const DEFAULT_NOTE: Record<BeatType, number> = {
  kick:              40,
  snare:             57,
  hihat:             67,
  'open-hihat':      67,
  clap:              55,
  tom:               50,
  crash:             65,
  rim:               62,
  '808':             28,
  ride:              70,
  shaker:            75,
  'guitar-acoustic': 64,
  'guitar-electric': 64,
  'guitar-nylon':    64,
  'piano-grand':     60,
  'piano-electric':  60,
  'piano-rhodes':    60,
  'synth-lead':      60,
  'synth-pad':       60,
  'synth-bass':      48,
  'synth-arp':       72,
  'synth-strings':   60,
  'synth-organ':     60,
  'synth-choir':     60,
  'synth-dark':      55,
  'synth-drone':     48,
  'synth-pluck':     60,
  violin:            69,
  viola:             57,
  other:             60,
}

export function playDrumHit(
  ctx: AudioContext,
  pack: PackId,
  type: BeatType,
  when: number,
  velocity: number,
  note: number | undefined,
  maxKickDur = 0.45,
  dest: AudioNode = ctx.destination,
): void {
  const n = note ?? DEFAULT_NOTE[type]
  switch (type) {
    case 'kick':       return synthKick(ctx, when, velocity, maxKickDur, dest)
    case 'snare':      return synthSnare(ctx, when, velocity, dest)
    case 'hihat':      return synthHihat(ctx, when, velocity, dest)
    case 'open-hihat': return synthOpenHihat(ctx, when, velocity, dest)
    case 'clap':       return synthClap(ctx, when, velocity, dest)
    case 'tom':        return synthTom(ctx, when, velocity, n, dest)
    case 'crash':      return synthCrash(ctx, when, velocity, dest)
    case 'rim':        return synthRim(ctx, when, velocity, dest)
    case '808':        return synth808(ctx, when, velocity, dest)
    case 'ride':       return synthRide(ctx, when, velocity, dest)
    case 'shaker':     return synthShaker(ctx, when, velocity, dest)
    default:           return synthOther(ctx, when, velocity, dest)
  }
}
