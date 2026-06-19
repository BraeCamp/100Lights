/**
 * Drum synthesis packs for Beat Lab.
 * "synth" = digital synthesis   "808" = TR-808-style richer synthesis
 * All functions accept a MIDI note so pitch-detected hits play at the correct frequency.
 */

import type { BeatType } from './beat-analyzer'

export type PackId = 'synth' | '808'

export interface DrumPack {
  id: PackId
  name: string
}

export const DRUM_PACKS: DrumPack[] = [
  { id: 'synth', name: 'Synth' },
  { id: '808',   name: '808'   },
]

function midiToHz(note: number): number {
  return 440 * Math.pow(2, (note - 69) / 12)
}

// ── Synth pack ────────────────────────────────────────────────────────────────

function synthKick(ctx: AudioContext, when: number, v: number, maxDur: number, note: number) {
  const base = midiToHz(Math.max(24, Math.min(60, note)))
  const dur = Math.max(0.12, Math.min(0.45, maxDur))
  const osc = ctx.createOscillator()
  const g = ctx.createGain()
  osc.connect(g); g.connect(ctx.destination)
  osc.frequency.setValueAtTime(base * 6, when)
  osc.frequency.exponentialRampToValueAtTime(base, when + 0.12)
  g.gain.setValueAtTime(v * 0.9, when)
  g.gain.exponentialRampToValueAtTime(0.001, when + dur)
  osc.start(when); osc.stop(when + dur + 0.05)
}

function synthSnare(ctx: AudioContext, when: number, v: number, note: number) {
  const toneHz = midiToHz(Math.max(36, Math.min(84, note)))
  const len = Math.floor(ctx.sampleRate * 0.18)
  const nBuf = ctx.createBuffer(1, len, ctx.sampleRate)
  const nd = nBuf.getChannelData(0)
  for (let i = 0; i < len; i++) nd[i] = Math.random() * 2 - 1
  const noise = ctx.createBufferSource(); noise.buffer = nBuf
  const nf = ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 1800; nf.Q.value = 0.6
  const ng = ctx.createGain()
  noise.connect(nf); nf.connect(ng); ng.connect(ctx.destination)
  ng.gain.setValueAtTime(v * 0.6, when)
  ng.gain.exponentialRampToValueAtTime(0.001, when + 0.18)
  noise.start(when)
  const osc = ctx.createOscillator(); const tg = ctx.createGain()
  osc.connect(tg); tg.connect(ctx.destination)
  osc.frequency.value = toneHz
  tg.gain.setValueAtTime(v * 0.35, when)
  tg.gain.exponentialRampToValueAtTime(0.001, when + 0.07)
  osc.start(when); osc.stop(when + 0.1)
}

function synthHihat(ctx: AudioContext, when: number, v: number, note: number) {
  const scale = Math.pow(2, (note - 60) / 12)
  const len = Math.floor(ctx.sampleRate * 0.055)
  const nBuf = ctx.createBuffer(1, len, ctx.sampleRate)
  const nd = nBuf.getChannelData(0)
  for (let i = 0; i < len; i++) nd[i] = Math.random() * 2 - 1
  const noise = ctx.createBufferSource(); noise.buffer = nBuf
  const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 8000 * scale
  const g = ctx.createGain()
  noise.connect(f); f.connect(g); g.connect(ctx.destination)
  g.gain.setValueAtTime(v * 0.3, when)
  g.gain.exponentialRampToValueAtTime(0.001, when + 0.055)
  noise.start(when)
}

function synthOpenHihat(ctx: AudioContext, when: number, v: number, note: number) {
  const scale = Math.pow(2, (note - 60) / 12)
  const dur = 0.38
  const len = Math.floor(ctx.sampleRate * dur)
  const nBuf = ctx.createBuffer(1, len, ctx.sampleRate)
  const nd = nBuf.getChannelData(0)
  for (let i = 0; i < len; i++) nd[i] = Math.random() * 2 - 1
  const noise = ctx.createBufferSource(); noise.buffer = nBuf
  const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7500 * scale
  const g = ctx.createGain()
  noise.connect(f); f.connect(g); g.connect(ctx.destination)
  g.gain.setValueAtTime(v * 0.28, when)
  g.gain.exponentialRampToValueAtTime(0.001, when + dur)
  noise.start(when)
}

function synthClap(ctx: AudioContext, when: number, v: number, note: number) {
  const toneHz = midiToHz(Math.max(36, Math.min(84, note)))
  for (const off of [0, 0.01, 0.022]) {
    const t = when + off
    const len = Math.floor(ctx.sampleRate * 0.06)
    const nBuf = ctx.createBuffer(1, len, ctx.sampleRate)
    const nd = nBuf.getChannelData(0)
    for (let i = 0; i < len; i++) nd[i] = Math.random() * 2 - 1
    const noise = ctx.createBufferSource(); noise.buffer = nBuf
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = toneHz * 2; f.Q.value = 0.8
    const g = ctx.createGain()
    noise.connect(f); f.connect(g); g.connect(ctx.destination)
    g.gain.setValueAtTime(v * 0.5, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.06)
    noise.start(t)
  }
}

function synthTom(ctx: AudioContext, when: number, v: number, note: number) {
  const base = midiToHz(Math.max(36, Math.min(72, note)))
  const dur = 0.22
  const osc = ctx.createOscillator()
  const g = ctx.createGain()
  osc.connect(g); g.connect(ctx.destination)
  osc.frequency.setValueAtTime(base * 2.5, when)
  osc.frequency.exponentialRampToValueAtTime(base, when + 0.06)
  g.gain.setValueAtTime(v * 0.75, when)
  g.gain.exponentialRampToValueAtTime(0.001, when + dur)
  osc.start(when); osc.stop(when + dur + 0.02)
}

function synthCrash(ctx: AudioContext, when: number, v: number, note: number) {
  const scale = Math.pow(2, (note - 60) / 12)
  const dur = 1.1
  const len = Math.floor(ctx.sampleRate * dur)
  const nBuf = ctx.createBuffer(1, len, ctx.sampleRate)
  const nd = nBuf.getChannelData(0)
  for (let i = 0; i < len; i++) nd[i] = Math.random() * 2 - 1
  const noise = ctx.createBufferSource(); noise.buffer = nBuf
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3500 * scale
  const g = ctx.createGain()
  noise.connect(hp); hp.connect(g); g.connect(ctx.destination)
  g.gain.setValueAtTime(v * 0.45, when)
  g.gain.exponentialRampToValueAtTime(0.001, when + dur)
  noise.start(when)
}

function synthRim(ctx: AudioContext, when: number, v: number, note: number) {
  const hz = midiToHz(Math.max(48, Math.min(84, note)))
  const dur = 0.038
  const osc = ctx.createOscillator(); osc.type = 'square'
  const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = hz * 3; f.Q.value = 2.5
  const g = ctx.createGain()
  osc.connect(f); f.connect(g); g.connect(ctx.destination)
  osc.frequency.value = hz
  g.gain.setValueAtTime(v * 0.65, when)
  g.gain.exponentialRampToValueAtTime(0.001, when + dur)
  osc.start(when); osc.stop(when + dur + 0.005)
}

function synthOther(ctx: AudioContext, when: number, v: number, note: number) {
  const hz = midiToHz(Math.max(36, Math.min(84, note)))
  const osc = ctx.createOscillator(); osc.type = 'triangle'
  const g = ctx.createGain()
  osc.connect(g); g.connect(ctx.destination)
  osc.frequency.value = hz
  g.gain.setValueAtTime(v * 0.35, when)
  g.gain.exponentialRampToValueAtTime(0.001, when + 0.12)
  osc.start(when); osc.stop(when + 0.14)
}

// ── 808 pack ──────────────────────────────────────────────────────────────────

function kick808(ctx: AudioContext, when: number, v: number, maxDur: number, note: number) {
  const base = midiToHz(Math.max(24, Math.min(60, note)))
  const dur = Math.max(0.15, Math.min(0.8, maxDur))
  const osc = ctx.createOscillator()
  const g = ctx.createGain()
  osc.connect(g); g.connect(ctx.destination)
  osc.frequency.setValueAtTime(base * 8, when)
  osc.frequency.exponentialRampToValueAtTime(base * 1.1, when + 0.04)
  osc.frequency.exponentialRampToValueAtTime(base * 0.7, when + 0.22)
  g.gain.setValueAtTime(v, when)
  g.gain.exponentialRampToValueAtTime(0.001, when + dur)
  osc.start(when); osc.stop(when + dur + 0.05)
  const click = ctx.createOscillator(); click.type = 'square'; click.frequency.value = 1600
  const cg = ctx.createGain()
  click.connect(cg); cg.connect(ctx.destination)
  cg.gain.setValueAtTime(v * 0.3, when)
  cg.gain.exponentialRampToValueAtTime(0.001, when + 0.007)
  click.start(when); click.stop(when + 0.01)
}

function snare808(ctx: AudioContext, when: number, v: number, note: number) {
  const toneHz = midiToHz(Math.max(36, Math.min(84, note)))
  const len = Math.floor(ctx.sampleRate * 0.22)
  const nBuf = ctx.createBuffer(1, len, ctx.sampleRate)
  const nd = nBuf.getChannelData(0)
  for (let i = 0; i < len; i++) nd[i] = (Math.random() * 2 - 1) * Math.exp(-i / (len * 0.28))
  const noise = ctx.createBufferSource(); noise.buffer = nBuf
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 280
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 7000
  const ng = ctx.createGain()
  noise.connect(hp); hp.connect(lp); lp.connect(ng); ng.connect(ctx.destination)
  ng.gain.setValueAtTime(v * 0.8, when)
  ng.gain.exponentialRampToValueAtTime(0.001, when + 0.22)
  noise.start(when)
  const osc = ctx.createOscillator(); const tg = ctx.createGain()
  osc.connect(tg); tg.connect(ctx.destination)
  osc.frequency.setValueAtTime(toneHz * 1.4, when)
  osc.frequency.exponentialRampToValueAtTime(toneHz * 0.6, when + 0.1)
  tg.gain.setValueAtTime(v * 0.5, when)
  tg.gain.exponentialRampToValueAtTime(0.001, when + 0.1)
  osc.start(when); osc.stop(when + 0.12)
}

function hihat808(ctx: AudioContext, when: number, v: number, note: number) {
  const FREQS = [205.3, 304.4, 369.9, 522.8, 635.4, 831.7]
  const scale = Math.pow(2, (note - 60) / 12)
  const dur = 0.065
  const mix = ctx.createGain(); mix.gain.value = v * 0.065
  mix.connect(ctx.destination)
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7500
  hp.connect(mix)
  const eg = ctx.createGain()
  eg.connect(hp)
  eg.gain.setValueAtTime(1, when)
  eg.gain.exponentialRampToValueAtTime(0.001, when + dur)
  for (const f of FREQS) {
    const osc = ctx.createOscillator(); osc.type = 'square'
    osc.frequency.value = f * scale
    osc.connect(eg)
    osc.start(when); osc.stop(when + dur + 0.005)
  }
}

function openHihat808(ctx: AudioContext, when: number, v: number, note: number) {
  const FREQS = [205.3, 304.4, 369.9, 522.8, 635.4, 831.7]
  const scale = Math.pow(2, (note - 60) / 12)
  const dur = 0.45
  const mix = ctx.createGain(); mix.gain.value = v * 0.065
  mix.connect(ctx.destination)
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7000
  hp.connect(mix)
  const eg = ctx.createGain()
  eg.connect(hp)
  eg.gain.setValueAtTime(1, when)
  eg.gain.exponentialRampToValueAtTime(0.001, when + dur)
  for (const f of FREQS) {
    const osc = ctx.createOscillator(); osc.type = 'square'
    osc.frequency.value = f * scale
    osc.connect(eg)
    osc.start(when); osc.stop(when + dur + 0.01)
  }
}

function clap808(ctx: AudioContext, when: number, v: number, note: number) {
  const toneHz = midiToHz(Math.max(36, Math.min(84, note)))
  for (const [off, amp] of [[0, 1], [0.012, 0.8], [0.028, 0.7], [0.048, 0.5]] as [number, number][]) {
    const t = when + off
    const len = Math.floor(ctx.sampleRate * 0.08)
    const nBuf = ctx.createBuffer(1, len, ctx.sampleRate)
    const nd = nBuf.getChannelData(0)
    for (let i = 0; i < len; i++) nd[i] = Math.random() * 2 - 1
    const noise = ctx.createBufferSource(); noise.buffer = nBuf
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = toneHz * 2; f.Q.value = 0.7
    const g = ctx.createGain()
    noise.connect(f); f.connect(g); g.connect(ctx.destination)
    g.gain.setValueAtTime(v * amp * 0.65, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.08)
    noise.start(t)
  }
}

function tom808(ctx: AudioContext, when: number, v: number, note: number) {
  const base = midiToHz(Math.max(36, Math.min(72, note)))
  const dur = 0.30
  const osc = ctx.createOscillator()
  const g = ctx.createGain()
  osc.connect(g); g.connect(ctx.destination)
  osc.frequency.setValueAtTime(base * 4, when)
  osc.frequency.exponentialRampToValueAtTime(base * 1.2, when + 0.03)
  osc.frequency.exponentialRampToValueAtTime(base * 0.9, when + 0.14)
  g.gain.setValueAtTime(v * 0.85, when)
  g.gain.exponentialRampToValueAtTime(0.001, when + dur)
  osc.start(when); osc.stop(when + dur + 0.02)
  // click
  const ck = ctx.createOscillator(); ck.type = 'square'; ck.frequency.value = 1200
  const cg = ctx.createGain()
  ck.connect(cg); cg.connect(ctx.destination)
  cg.gain.setValueAtTime(v * 0.2, when)
  cg.gain.exponentialRampToValueAtTime(0.001, when + 0.008)
  ck.start(when); ck.stop(when + 0.012)
}

function crash808(ctx: AudioContext, when: number, v: number, note: number) {
  const FREQS = [205.3, 304.4, 369.9, 522.8, 635.4, 831.7, 1024.5, 1312.8]
  const scale = Math.pow(2, (note - 60) / 12)
  const dur = 1.6
  const mix = ctx.createGain(); mix.gain.value = v * 0.05
  mix.connect(ctx.destination)
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 4000
  hp.connect(mix)
  const eg = ctx.createGain()
  eg.connect(hp)
  eg.gain.setValueAtTime(1, when)
  eg.gain.exponentialRampToValueAtTime(0.001, when + dur)
  for (const f of FREQS) {
    const osc = ctx.createOscillator(); osc.type = 'square'
    osc.frequency.value = f * scale
    osc.connect(eg)
    osc.start(when); osc.stop(when + dur + 0.02)
  }
  // noise body
  const nlen = Math.floor(ctx.sampleRate * 0.6)
  const nBuf = ctx.createBuffer(1, nlen, ctx.sampleRate)
  const nd = nBuf.getChannelData(0)
  for (let i = 0; i < nlen; i++) nd[i] = Math.random() * 2 - 1
  const noise = ctx.createBufferSource(); noise.buffer = nBuf
  const ng = ctx.createGain()
  noise.connect(ng); ng.connect(ctx.destination)
  ng.gain.setValueAtTime(v * 0.1, when)
  ng.gain.exponentialRampToValueAtTime(0.001, when + 0.6)
  noise.start(when)
}

function rim808(ctx: AudioContext, when: number, v: number, note: number) {
  const hz = midiToHz(Math.max(48, Math.min(84, note)))
  const dur = 0.038
  const osc = ctx.createOscillator(); osc.type = 'square'
  const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = hz * 2.5; f.Q.value = 2.5
  const g = ctx.createGain()
  osc.connect(f); f.connect(g); g.connect(ctx.destination)
  osc.frequency.value = hz
  g.gain.setValueAtTime(v * 0.7, when)
  g.gain.exponentialRampToValueAtTime(0.001, when + dur)
  osc.start(when); osc.stop(when + dur + 0.005)
}

function other808(ctx: AudioContext, when: number, v: number, note: number) {
  const hz = midiToHz(Math.max(36, Math.min(84, note)))
  const osc = ctx.createOscillator(); osc.type = 'triangle'
  const g = ctx.createGain()
  osc.connect(g); g.connect(ctx.destination)
  osc.frequency.value = hz
  g.gain.setValueAtTime(v * 0.45, when)
  g.gain.exponentialRampToValueAtTime(0.001, when + 0.18)
  osc.start(when); osc.stop(when + 0.2)
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
) {
  const n = note ?? DEFAULT_NOTE[type]
  if (pack === '808') {
    switch (type) {
      case 'kick':        return kick808(ctx, when, velocity, maxKickDur, n)
      case 'snare':       return snare808(ctx, when, velocity, n)
      case 'hihat':       return hihat808(ctx, when, velocity, n)
      case 'open-hihat':  return openHihat808(ctx, when, velocity, n)
      case 'clap':        return clap808(ctx, when, velocity, n)
      case 'tom':         return tom808(ctx, when, velocity, n)
      case 'crash':       return crash808(ctx, when, velocity, n)
      case 'rim':         return rim808(ctx, when, velocity, n)
      default:            return other808(ctx, when, velocity, n)
    }
  } else {
    switch (type) {
      case 'kick':        return synthKick(ctx, when, velocity, maxKickDur, n)
      case 'snare':       return synthSnare(ctx, when, velocity, n)
      case 'hihat':       return synthHihat(ctx, when, velocity, n)
      case 'open-hihat':  return synthOpenHihat(ctx, when, velocity, n)
      case 'clap':        return synthClap(ctx, when, velocity, n)
      case 'tom':         return synthTom(ctx, when, velocity, n)
      case 'crash':       return synthCrash(ctx, when, velocity, n)
      case 'rim':         return synthRim(ctx, when, velocity, n)
      default:            return synthOther(ctx, when, velocity, n)
    }
  }
}
