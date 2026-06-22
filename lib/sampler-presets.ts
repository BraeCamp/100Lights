/**
 * Built-in sampler patches with programmatically generated samples.
 * All audio is synthesized via OfflineAudioContext — no external files needed.
 * sampleUrl uses the 'builtin:<type>' convention; call generatePresetBuffers()
 * to get a Map<keyGroupId, AudioBuffer> ready for playSamplerNote().
 */

import type { SamplerPatch, SamplerKeyGroup } from './sampler-engine'

function kg(
  id: string,
  sampleUrl: string,
  rootNote: number,
  loNote: number,
  hiNote: number,
  gain = 1.0,
): SamplerKeyGroup {
  return {
    id,
    sampleUrl,
    rootNote,
    loNote,
    hiNote,
    loVel: 0,
    hiVel: 127,
    loopStart: 0,
    loopEnd: 0,
    tune: 0,
    gain,
  }
}

export const SAMPLER_PRESETS: SamplerPatch[] = [
  {
    id: 'preset-808bass',
    name: '808 Bass',
    keyGroups: [
      kg('808bass-full', 'builtin:808bass', 36, 24, 60, 1.0),
    ],
    attack: 0.002,
    decay: 0.15,
    sustain: 0.6,
    release: 0.6,
    filterCutoff: 14000,
    filterResonance: 2,
  },
  {
    id: 'preset-vocalchop',
    name: 'Vocal Chop',
    keyGroups: [
      kg('vocalchop-full', 'builtin:vocalchop', 60, 36, 84, 0.85),
    ],
    attack: 0.003,
    decay: 0.08,
    sustain: 0.5,
    release: 0.25,
    filterCutoff: 9000,
    filterResonance: 4,
  },
  {
    id: 'preset-lofikeys',
    name: 'Lo-Fi Keys',
    keyGroups: [
      kg('lofikeys-full', 'builtin:lofikeys', 60, 21, 108, 0.9),
    ],
    attack: 0.004,
    decay: 0.4,
    sustain: 0.3,
    release: 0.8,
    filterCutoff: 7000,
    filterResonance: 1.5,
  },
  {
    id: 'preset-arpsynth',
    name: 'Arp Synth',
    keyGroups: [
      kg('arpsynth-full', 'builtin:arpsynth', 60, 36, 84, 0.8),
    ],
    attack: 0.001,
    decay: 0.06,
    sustain: 0.2,
    release: 0.15,
    filterCutoff: 16000,
    filterResonance: 3,
  },
  {
    id: 'preset-perckit',
    name: 'Perc Kit',
    keyGroups: [
      kg('perckit-kick',  'builtin:perc-kick',  36, 33, 38, 1.0),
      kg('perckit-snare', 'builtin:perc-snare', 40, 39, 43, 0.9),
      kg('perckit-hat',   'builtin:perc-hat',   42, 42, 46, 0.7),
      kg('perckit-clap',  'builtin:perc-clap',  49, 47, 54, 0.85),
    ],
    attack: 0.001,
    decay: 0.1,
    sustain: 0.0,
    release: 0.2,
    filterCutoff: 18000,
    filterResonance: 0,
  },
]

// ── Sample generators ─────────────────────────────────────────────────────────

async function render808Bass(): Promise<AudioBuffer> {
  const sr = 44100
  const dur = 2.0
  const ctx = new OfflineAudioContext(1, Math.floor(sr * dur), sr)

  // Sub sine sweep: starts high then drops to C2 (65.4 Hz)
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(220, 0)
  osc.frequency.exponentialRampToValueAtTime(65.4, 0.08)
  gain.gain.setValueAtTime(0.85, 0)
  gain.gain.exponentialRampToValueAtTime(0.001, 1.9)
  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.start(0)
  osc.stop(dur)

  // Slight harmonic on top
  const osc2 = ctx.createOscillator()
  const g2 = ctx.createGain()
  osc2.type = 'sine'
  osc2.frequency.setValueAtTime(440, 0)
  osc2.frequency.exponentialRampToValueAtTime(130.8, 0.06)
  g2.gain.setValueAtTime(0.15, 0)
  g2.gain.exponentialRampToValueAtTime(0.001, 0.4)
  osc2.connect(g2)
  g2.connect(ctx.destination)
  osc2.start(0)
  osc2.stop(0.45)

  return ctx.startRendering()
}

async function renderVocalChop(): Promise<AudioBuffer> {
  const sr = 44100
  const dur = 0.7
  const ctx = new OfflineAudioContext(1, Math.floor(sr * dur), sr)

  // Formant bands at vowel-like frequencies (approximating "ah")
  const formants: [number, number, number][] = [
    [800,  0.5,  12], // F1
    [1200, 0.3,   8], // F2
    [2500, 0.15,  6], // F3
  ]

  // Noise source for breath quality
  const nLen = Math.floor(sr * dur)
  const nBuf = ctx.createBuffer(1, nLen, sr)
  const nd = nBuf.getChannelData(0)
  for (let i = 0; i < nLen; i++) nd[i] = Math.random() * 2 - 1

  const masterGain = ctx.createGain()
  masterGain.gain.setValueAtTime(0.0001, 0)
  masterGain.gain.linearRampToValueAtTime(0.7, 0.02)
  masterGain.gain.setValueAtTime(0.65, 0.3)
  masterGain.gain.exponentialRampToValueAtTime(0.001, 0.68)
  masterGain.connect(ctx.destination)

  for (const [freq, amp, q] of formants) {
    const src = ctx.createBufferSource()
    src.buffer = nBuf
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = freq
    bp.Q.value = q
    const g = ctx.createGain()
    g.gain.value = amp
    src.connect(bp)
    bp.connect(g)
    g.connect(masterGain)
    src.start(0)
    src.stop(dur)
  }

  // Pitched component at C4 (261.6 Hz) for melodic content
  const osc = ctx.createOscillator()
  osc.type = 'sawtooth'
  osc.frequency.value = 261.63
  const og = ctx.createGain()
  og.gain.setValueAtTime(0.0001, 0)
  og.gain.linearRampToValueAtTime(0.22, 0.015)
  og.gain.setValueAtTime(0.20, 0.3)
  og.gain.exponentialRampToValueAtTime(0.001, 0.67)
  const lp = ctx.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 3000
  osc.connect(og)
  og.connect(lp)
  lp.connect(ctx.destination)
  osc.start(0)
  osc.stop(dur)

  return ctx.startRendering()
}

async function renderLoFiKeys(): Promise<AudioBuffer> {
  const sr = 44100
  const dur = 2.2
  const ctx = new OfflineAudioContext(1, Math.floor(sr * dur), sr)

  const hz = 261.63 // C4

  const masterGain = ctx.createGain()
  masterGain.gain.setValueAtTime(0.0001, 0)
  masterGain.gain.linearRampToValueAtTime(0.7, 0.004)
  masterGain.gain.exponentialRampToValueAtTime(0.38, 0.05)
  masterGain.gain.exponentialRampToValueAtTime(0.001, 2.1)
  masterGain.connect(ctx.destination)

  // Additive harmonics with inharmonic stretch
  const partials: [number, number][] = [
    [1, 1.00], [2, 0.55], [3, 0.32], [4, 0.18],
    [5, 0.10], [6, 0.06], [8, 0.025],
  ]
  for (const [n, amp] of partials) {
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    // Slight inharmonic stretch
    osc.frequency.value = hz * n * (1 + (n - 1) * 0.0006)
    const g = ctx.createGain()
    g.gain.value = amp
    osc.connect(g)
    g.connect(masterGain)
    osc.start(0)
    osc.stop(dur)
  }

  // Hammer strike noise burst
  const nLen = Math.floor(sr * 0.015)
  const nBuf = ctx.createBuffer(1, nLen, sr)
  const nd = nBuf.getChannelData(0)
  for (let i = 0; i < nLen; i++) nd[i] = (Math.random() * 2 - 1) * (1 - i / nLen)
  const nSrc = ctx.createBufferSource()
  nSrc.buffer = nBuf
  const nBp = ctx.createBiquadFilter()
  nBp.type = 'bandpass'
  nBp.frequency.value = hz * 2.5
  nBp.Q.value = 0.5
  const ng = ctx.createGain()
  ng.gain.value = 0.08
  nSrc.connect(nBp)
  nBp.connect(ng)
  ng.connect(masterGain)
  nSrc.start(0)

  // Lo-fi: gentle low-pass
  const lp = ctx.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 5500
  masterGain.disconnect()
  masterGain.connect(lp)
  lp.connect(ctx.destination)

  return ctx.startRendering()
}

async function renderArpSynth(): Promise<AudioBuffer> {
  const sr = 44100
  const dur = 0.35
  const ctx = new OfflineAudioContext(1, Math.floor(sr * dur), sr)

  const hz = 261.63 // C4
  const filter = ctx.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.setValueAtTime(6000, 0)
  filter.frequency.exponentialRampToValueAtTime(900, 0.12)
  filter.Q.value = 2.5
  filter.connect(ctx.destination)

  const masterGain = ctx.createGain()
  masterGain.gain.setValueAtTime(0.6, 0)
  masterGain.gain.exponentialRampToValueAtTime(0.001, 0.33)
  masterGain.connect(filter)

  const osc1 = ctx.createOscillator()
  osc1.type = 'square'
  osc1.frequency.value = hz
  const osc2 = ctx.createOscillator()
  osc2.type = 'sawtooth'
  osc2.frequency.value = hz * 2
  osc2.detune.value = 7
  const g2 = ctx.createGain()
  g2.gain.value = 0.35
  osc1.connect(masterGain)
  osc2.connect(g2)
  g2.connect(masterGain)
  osc1.start(0); osc1.stop(dur)
  osc2.start(0); osc2.stop(dur)

  return ctx.startRendering()
}

async function renderPercKick(): Promise<AudioBuffer> {
  const sr = 44100
  const dur = 0.6
  const ctx = new OfflineAudioContext(1, Math.floor(sr * dur), sr)

  const body = ctx.createOscillator()
  const bg = ctx.createGain()
  body.type = 'sine'
  body.frequency.setValueAtTime(180, 0)
  body.frequency.exponentialRampToValueAtTime(42, 0.07)
  bg.gain.setValueAtTime(0.9, 0)
  bg.gain.exponentialRampToValueAtTime(0.001, 0.55)
  body.connect(bg); bg.connect(ctx.destination)
  body.start(0); body.stop(dur)

  const click = ctx.createOscillator()
  const cg = ctx.createGain()
  click.type = 'sine'
  click.frequency.setValueAtTime(700, 0)
  click.frequency.exponentialRampToValueAtTime(120, 0.03)
  cg.gain.setValueAtTime(0.8, 0)
  cg.gain.exponentialRampToValueAtTime(0.001, 0.05)
  click.connect(cg); cg.connect(ctx.destination)
  click.start(0); click.stop(0.06)

  return ctx.startRendering()
}

async function renderPercSnare(): Promise<AudioBuffer> {
  const sr = 44100
  const dur = 0.22
  const ctx = new OfflineAudioContext(1, Math.floor(sr * dur), sr)

  // Noise body
  const nLen = Math.floor(sr * dur)
  const nBuf = ctx.createBuffer(1, nLen, sr)
  const nd = nBuf.getChannelData(0)
  for (let i = 0; i < nLen; i++) nd[i] = Math.random() * 2 - 1
  const src = ctx.createBufferSource(); src.buffer = nBuf
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1200
  const ng = ctx.createGain()
  ng.gain.setValueAtTime(0.7, 0)
  ng.gain.exponentialRampToValueAtTime(0.001, 0.2)
  src.connect(hp); hp.connect(ng); ng.connect(ctx.destination)
  src.start(0)

  // Head tone
  const osc = ctx.createOscillator()
  const og = ctx.createGain()
  osc.type = 'triangle'
  osc.frequency.setValueAtTime(260, 0)
  osc.frequency.exponentialRampToValueAtTime(175, 0.04)
  og.gain.setValueAtTime(0.5, 0)
  og.gain.exponentialRampToValueAtTime(0.001, 0.08)
  osc.connect(og); og.connect(ctx.destination)
  osc.start(0); osc.stop(0.09)

  return ctx.startRendering()
}

async function renderPercHat(): Promise<AudioBuffer> {
  const sr = 44100
  const dur = 0.1
  const ctx = new OfflineAudioContext(1, Math.floor(sr * dur), sr)

  const freqs = [205.3, 304.4, 369.9, 522.8, 635.4, 831.7]
  const mix = ctx.createGain(); mix.gain.value = 0.07; mix.connect(ctx.destination)
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7800; hp.connect(mix)
  const env = ctx.createGain(); env.connect(hp)
  env.gain.setValueAtTime(1, 0)
  env.gain.exponentialRampToValueAtTime(0.001, 0.09)

  for (const f of freqs) {
    const osc = ctx.createOscillator(); osc.type = 'square'; osc.frequency.value = f
    osc.connect(env); osc.start(0); osc.stop(dur)
  }

  return ctx.startRendering()
}

async function renderPercClap(): Promise<AudioBuffer> {
  const sr = 44100
  const dur = 0.18
  const ctx = new OfflineAudioContext(1, Math.floor(sr * dur), sr)

  const bursts: [number, number][] = [[0, 1.0], [0.010, 0.85], [0.022, 0.75], [0.040, 0.60]]
  for (const [off, amp] of bursts) {
    const len = Math.floor(sr * 0.06)
    const buf = ctx.createBuffer(1, len, sr)
    const d = buf.getChannelData(0)
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
    const src = ctx.createBufferSource(); src.buffer = buf
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 900
    const g = ctx.createGain()
    g.gain.setValueAtTime(amp * 0.65, off)
    g.gain.exponentialRampToValueAtTime(0.001, off + 0.065)
    src.connect(hp); hp.connect(g); g.connect(ctx.destination)
    src.start(off)
  }

  return ctx.startRendering()
}

const BUILTIN_RENDERERS: Record<string, () => Promise<AudioBuffer>> = {
  '808bass':   render808Bass,
  'vocalchop': renderVocalChop,
  'lofikeys':  renderLoFiKeys,
  'arpsynth':  renderArpSynth,
  'perc-kick': renderPercKick,
  'perc-snare': renderPercSnare,
  'perc-hat':  renderPercHat,
  'perc-clap': renderPercClap,
}

/**
 * Generate AudioBuffers for all key groups in a preset patch.
 * Key groups with sampleUrl starting with 'builtin:' are synthesized.
 * Returns a Map<keyGroupId, AudioBuffer> suitable for playSamplerNote().
 */
export async function generatePresetBuffers(
  patch: SamplerPatch,
): Promise<Map<string, AudioBuffer>> {
  const buffers = new Map<string, AudioBuffer>()
  // Cache rendered buffers by type so we don't re-render the same sound twice
  const cache = new Map<string, AudioBuffer>()

  await Promise.all(
    patch.keyGroups.map(async (kgItem) => {
      if (!kgItem.sampleUrl.startsWith('builtin:')) return
      const type = kgItem.sampleUrl.slice('builtin:'.length)
      const renderer = BUILTIN_RENDERERS[type]
      if (!renderer) return

      if (!cache.has(type)) {
        cache.set(type, await renderer())
      }
      buffers.set(kgItem.id, cache.get(type)!)
    })
  )

  return buffers
}
