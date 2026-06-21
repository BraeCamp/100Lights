/**
 * Melodic instrument synthesis for Beat Lab.
 * Guitar: Karplus-Strong physical model (plucked string — sounds natural)
 * Piano: Additive harmonics + strike noise + FM for electric variants
 * Synth: Classic oscillator + filter (lead, pad, bass, arp)
 */

import type { BeatType } from './beat-analyzer'

function midiToHz(note: number): number {
  return 440 * Math.pow(2, (note - 69) / 12)
}

// ── Guitar — Karplus-Strong plucked string model ──────────────────────────────
// Sounds convincingly like a real plucked string because it IS a physical model:
// a brief noise burst (the pick/pluck) fed through a comb filter with a damping
// coefficient simulates how a vibrating string loses energy over time.

export function playGuitar(
  ctx: AudioContext, variant: BeatType, midiNote: number,
  when: number, velocity: number, dest: AudioNode = ctx.destination,
) {
  const hz = midiToHz(Math.max(28, Math.min(88, midiNote)))
  const sr = ctx.sampleRate
  const period = Math.ceil(sr / hz)
  const duration = 3.5
  const bufLen = Math.min(Math.floor(sr * duration), sr * 5)

  const buf = ctx.createBuffer(1, bufLen, sr)
  const data = buf.getChannelData(0)

  // Excitation: noise burst at the pick point
  for (let i = 0; i < period; i++) {
    data[i] = Math.random() * 2 - 1
  }

  // Decay coefficient — electric sustains longer, nylon decays faster, acoustic in between
  const decay = variant === 'guitar-electric' ? 0.9997 :
                variant === 'guitar-nylon'    ? 0.9980 : 0.9990

  // Averaging feedback loop (low-pass + delay = string resonance)
  for (let i = period; i < bufLen; i++) {
    const prev = i - period - 1 >= 0 ? data[i - period - 1] : 0
    data[i] = decay * 0.5 * (data[i - period] + prev)
  }

  const src = ctx.createBufferSource()
  src.buffer = buf

  const gain = ctx.createGain()
  gain.gain.value = velocity * 0.9

  if (variant === 'guitar-electric') {
    // Slight high-shelf boost for electric twang
    const shelf = ctx.createBiquadFilter()
    shelf.type = 'highshelf'
    shelf.frequency.value = 2500
    shelf.gain.value = 6
    src.connect(shelf)
    shelf.connect(gain)
  } else if (variant === 'guitar-nylon') {
    // Nylon is warmer — low-pass off the high end
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 5000
    src.connect(lp)
    lp.connect(gain)
  } else {
    src.connect(gain)
  }

  gain.connect(dest)
  src.start(when)
}

// ── Piano — additive harmonics + hammer strike noise ─────────────────────────
// Multiple harmonics (naturally present in piano strings) with individual decay rates,
// plus a brief noise burst to simulate the hammer striking the string.

export function playPiano(
  ctx: AudioContext, variant: BeatType, midiNote: number,
  when: number, velocity: number, dest: AudioNode = ctx.destination,
) {
  const hz = midiToHz(Math.max(21, Math.min(108, midiNote)))
  const sustain = Math.max(0.8, Math.min(4.5, 5.0 - (midiNote - 21) / 87 * 3.0))

  const masterGain = ctx.createGain()
  masterGain.connect(dest)

  if (variant === 'piano-electric') {
    // Electric piano: square fundamentals with sharp attack (Fender Rhodes-ish)
    masterGain.gain.setValueAtTime(0.001, when)
    masterGain.gain.linearRampToValueAtTime(velocity * 0.38, when + 0.008)
    masterGain.gain.exponentialRampToValueAtTime(velocity * 0.28, when + 0.05)
    masterGain.gain.exponentialRampToValueAtTime(0.001, when + sustain * 0.7)

    for (const [ratio, amp] of [[1, 1.0], [2, 0.3], [4, 0.08]] as [number, number][]) {
      const osc = ctx.createOscillator()
      osc.type = 'square'
      osc.frequency.value = hz * ratio
      const g = ctx.createGain(); g.gain.value = amp
      osc.connect(g); g.connect(masterGain)
      osc.start(when); osc.stop(when + sustain + 0.1)
    }
  } else if (variant === 'piano-rhodes') {
    // Rhodes: tine-like bell quality — two slightly detuned sines per note create beating
    masterGain.gain.setValueAtTime(0.001, when)
    masterGain.gain.linearRampToValueAtTime(velocity * 0.35, when + 0.005)
    masterGain.gain.exponentialRampToValueAtTime(velocity * 0.22, when + 0.08)
    masterGain.gain.exponentialRampToValueAtTime(0.001, when + sustain * 0.85)

    // Vibrato LFO (characteristic Rhodes tremolo)
    const lfo = ctx.createOscillator(); lfo.frequency.value = 5.5
    const lfoGain = ctx.createGain(); lfoGain.gain.value = 0.018
    lfo.connect(lfoGain)
    lfo.start(when)

    for (const detune of [-1.2, 0, 1.2]) {
      const osc = ctx.createOscillator(); osc.type = 'sine'
      osc.frequency.value = hz; osc.detune.value = detune
      lfoGain.connect(osc.frequency)
      const g = ctx.createGain(); g.gain.value = 1 / 3
      osc.connect(g); g.connect(masterGain)
      osc.start(when); osc.stop(when + sustain + 0.1)
    }
    lfo.stop(when + sustain + 0.1)
  } else {
    // Acoustic grand: harmonics with natural inharmonicity + hammer noise
    masterGain.gain.setValueAtTime(0.001, when)
    masterGain.gain.linearRampToValueAtTime(velocity * 0.36, when + 0.004)
    masterGain.gain.exponentialRampToValueAtTime(velocity * 0.29, when + 0.04)
    masterGain.gain.exponentialRampToValueAtTime(0.001, when + sustain)

    const partials: [number, number, number][] = [
      // [frequency ratio, amplitude, cents detune]
      [1, 1.00,  0 ],
      [2, 0.48,  1.2],
      [3, 0.28, -0.8],
      [4, 0.16,  0.4],
      [5, 0.09, -1.5],
      [6, 0.05,  0.6],
      [8, 0.025, 0  ],
    ]
    for (const [ratio, amp, cents] of partials) {
      const osc = ctx.createOscillator(); osc.type = 'sine'
      osc.frequency.value = hz * ratio
      osc.detune.value = cents
      const hg = ctx.createGain(); hg.gain.value = amp
      osc.connect(hg); hg.connect(masterGain)
      osc.start(when); osc.stop(when + sustain + 0.1)
    }

    // Hammer strike (brief noise at the attack)
    const nlen = Math.floor(ctx.sampleRate * 0.012)
    const nbuf = ctx.createBuffer(1, nlen, ctx.sampleRate)
    const nd = nbuf.getChannelData(0)
    for (let i = 0; i < nlen; i++) nd[i] = Math.random() * 2 - 1
    const nsrc = ctx.createBufferSource(); nsrc.buffer = nbuf
    const nfilt = ctx.createBiquadFilter(); nfilt.type = 'bandpass'
    nfilt.frequency.value = hz * 2; nfilt.Q.value = 0.5
    const ng = ctx.createGain()
    ng.gain.setValueAtTime(velocity * 0.07, when)
    ng.gain.exponentialRampToValueAtTime(0.001, when + 0.012)
    nsrc.connect(nfilt); nfilt.connect(ng); ng.connect(dest)
    nsrc.start(when)
  }
}

// ── EDM Synth — classic oscillator + filter synthesis ────────────────────────

export function playSynth(
  ctx: AudioContext, variant: BeatType, midiNote: number,
  when: number, velocity: number, dest: AudioNode = ctx.destination,
) {
  const hz = midiToHz(Math.max(21, Math.min(108, midiNote)))

  const filter = ctx.createBiquadFilter()
  filter.type = 'lowpass'
  const masterGain = ctx.createGain()
  filter.connect(masterGain)
  masterGain.connect(dest)

  if (variant === 'synth-pad') {
    // Pad: 3 detuned saws, slow attack, long release
    filter.frequency.setValueAtTime(600, when)
    filter.frequency.linearRampToValueAtTime(2200, when + 0.5)
    filter.Q.value = 1.2
    masterGain.gain.setValueAtTime(0.001, when)
    masterGain.gain.linearRampToValueAtTime(velocity * 0.22, when + 0.3)
    masterGain.gain.setValueAtTime(velocity * 0.22, when + 1.5)
    masterGain.gain.exponentialRampToValueAtTime(0.001, when + 2.8)

    for (const detune of [-8, 0, 8]) {
      const osc = ctx.createOscillator(); osc.type = 'sawtooth'
      osc.frequency.value = hz; osc.detune.value = detune
      osc.connect(filter)
      osc.start(when); osc.stop(when + 3.0)
    }

  } else if (variant === 'synth-bass') {
    // Bass: fat square + sub octave + steep filter
    filter.frequency.setValueAtTime(hz * 4, when)
    filter.frequency.exponentialRampToValueAtTime(hz * 1.8, when + 0.05)
    filter.Q.value = 3
    masterGain.gain.setValueAtTime(velocity * 0.8, when)
    masterGain.gain.exponentialRampToValueAtTime(velocity * 0.55, when + 0.08)
    masterGain.gain.exponentialRampToValueAtTime(0.001, when + 0.45)

    const osc = ctx.createOscillator(); osc.type = 'square'; osc.frequency.value = hz
    const sub = ctx.createOscillator(); sub.type = 'sawtooth'; sub.frequency.value = hz / 2
    const subGain = ctx.createGain(); subGain.gain.value = 0.6
    osc.connect(filter)
    sub.connect(subGain); subGain.connect(filter)
    osc.start(when); osc.stop(when + 0.5)
    sub.start(when); sub.stop(when + 0.5)

  } else if (variant === 'synth-arp') {
    // Arp: bright staccato pulse
    filter.frequency.setValueAtTime(4000, when)
    filter.frequency.exponentialRampToValueAtTime(700, when + 0.12)
    filter.Q.value = 2
    masterGain.gain.setValueAtTime(velocity * 0.5, when)
    masterGain.gain.exponentialRampToValueAtTime(0.001, when + 0.18)

    const osc = ctx.createOscillator(); osc.type = 'square'; osc.frequency.value = hz
    const osc2 = ctx.createOscillator(); osc2.type = 'sawtooth'; osc2.frequency.value = hz * 2
    const og2 = ctx.createGain(); og2.gain.value = 0.3
    osc.connect(filter); osc2.connect(og2); og2.connect(filter)
    osc.start(when); osc.stop(when + 0.22)
    osc2.start(when); osc2.stop(when + 0.22)

  } else {
    // Lead: detuned saw pair + filter envelope (classic supersaw-lite)
    filter.frequency.setValueAtTime(hz * 6, when)
    filter.frequency.exponentialRampToValueAtTime(hz * 8, when + 0.02)
    filter.frequency.exponentialRampToValueAtTime(hz * 3, when + 0.25)
    filter.Q.value = 2.5
    masterGain.gain.setValueAtTime(0.001, when)
    masterGain.gain.linearRampToValueAtTime(velocity * 0.42, when + 0.012)
    masterGain.gain.setValueAtTime(velocity * 0.40, when + 0.3)
    masterGain.gain.exponentialRampToValueAtTime(0.001, when + 0.65)

    const osc  = ctx.createOscillator(); osc.type  = 'sawtooth'; osc.frequency.value  = hz
    const osc2 = ctx.createOscillator(); osc2.type = 'sawtooth'; osc2.frequency.value = hz
    osc2.detune.value = 7
    osc.connect(filter); osc2.connect(filter)
    osc.start(when); osc.stop(when + 0.7)
    osc2.start(when); osc2.stop(when + 0.7)
  }
}

// ── Unified melodic dispatcher ────────────────────────────────────────────────

export function playMelodicNote(
  ctx: AudioContext, type: BeatType, midiNote: number,
  when: number, velocity: number, dest: AudioNode = ctx.destination,
) {
  if (type.startsWith('guitar')) {
    playGuitar(ctx, type, midiNote, when, velocity, dest)
  } else if (type.startsWith('piano')) {
    playPiano(ctx, type, midiNote, when, velocity, dest)
  } else if (type.startsWith('synth')) {
    playSynth(ctx, type, midiNote, when, velocity, dest)
  }
}

export const MELODIC_TYPES = new Set<BeatType>([
  'guitar-acoustic', 'guitar-electric', 'guitar-nylon',
  'piano-grand', 'piano-electric', 'piano-rhodes',
  'synth-lead', 'synth-pad', 'synth-bass', 'synth-arp',
])
