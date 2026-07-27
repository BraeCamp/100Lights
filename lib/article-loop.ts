// Short, broadband grooves (kick / snare / hats / saw bass) rendered offline into
// seamless loop buffers for the article mixing widgets. Multiple STYLES so the
// demos aren't all one house loop — different tempo, pattern, swing, and bass per
// genre (see the "diversify the music" note in CONTEXT.md). Cached per style+rate.

export type LoopStyle = 'house' | 'boombap' | 'lofi'

interface StyleSpec {
  bpm: number
  swing: number          // 0 = straight; fraction the off-beat 16ths slide late
  kick: number[]         // 16th-step indices over 2 bars (0..31)
  snare: number[]
  clHat: number[]
  opHat: number[]
  bass: Array<[number, number]>   // [step, Hz]
  hatGain: number
}

const A = (n: number) => 55 * Math.pow(2, n / 12)   // Hz from semitones above A1
const STYLES: Record<LoopStyle, StyleSpec> = {
  // Four-on-the-floor, bright and busy.
  house: {
    bpm: 122, swing: 0, hatGain: 1,
    kick: [0, 4, 8, 12, 16, 20, 24, 28], snare: [4, 12, 20, 28],
    clHat: [2, 6, 10, 14, 18, 22, 26, 30], opHat: [7, 23],
    bass: [[0, 55], [3, 55], [6, 82.4], [8, 65.4], [11, 65.4], [14, 98], [16, 55], [19, 55], [22, 82.4], [24, 49], [27, 49], [30, 73.4]],
  },
  // Dusty hip-hop: swung, kick+snare backbone, sparser hats, lower + laid-back.
  boombap: {
    bpm: 88, swing: 0.6, hatGain: 0.8,
    kick: [0, 10, 16, 19, 26], snare: [4, 12, 20, 28],
    clHat: [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30], opHat: [],
    bass: [[0, A(-12)], [10, A(-12)], [16, A(-5)], [26, A(-7)]],
  },
  // Lo-fi: slow, sparse, soft — room to breathe, warm low bass.
  lofi: {
    bpm: 72, swing: 0.58, hatGain: 0.55,
    kick: [0, 16, 22], snare: [8, 24],
    clHat: [2, 6, 10, 14, 18, 22, 26, 30], opHat: [12],
    bass: [[0, A(-14)], [8, A(-9)], [16, A(-11)], [24, A(-16)]],
  },
}

const cache = new Map<string, Promise<AudioBuffer>>()
export function grooveLoop(sampleRate: number, style: LoopStyle = 'house'): Promise<AudioBuffer> {
  const key = `${style}:${sampleRate}`
  const hit = cache.get(key)
  if (hit) return hit
  const p = render(sampleRate, STYLES[style])
  cache.set(key, p)
  return p
}

async function render(sampleRate: number, S: StyleSpec): Promise<AudioBuffer> {
  const bars = 2, beats = bars * 4
  const step = 60 / S.bpm / 4                 // 16th, seconds
  const dur = (60 / S.bpm) * beats
  const OAC = (typeof OfflineAudioContext !== 'undefined'
    ? OfflineAudioContext
    : (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext)
  const ac = new OAC(2, Math.ceil(dur * sampleRate), sampleRate)
  // Swing pushes odd 16ths late by `swing` of an 8th.
  const at = (s: number) => Math.floor(s / 2) * (step * 2) + (s % 2 ? S.swing * step * 2 : 0)

  for (const s of S.kick) synthKick(ac, at(s))
  for (const s of S.snare) synthSnare(ac, at(s))
  S.clHat.forEach((s, i) => synthHat(ac, at(s), false, S.hatGain, i % 2 ? 0.4 : -0.4))
  S.opHat.forEach((s, i) => synthHat(ac, at(s), true, S.hatGain, i % 2 ? -0.6 : 0.6))
  for (const [s, hz] of S.bass) synthBass(ac, at(s), hz, step * 2.6)

  return ac.startRendering()
}

function env(ac: BaseAudioContext, t: number, peak: number, dur: number): GainNode {
  const g = ac.createGain()
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(peak, t + 0.004)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  return g
}

function synthKick(ac: BaseAudioContext, t: number) {
  const o = ac.createOscillator()
  o.frequency.setValueAtTime(150, t)
  o.frequency.exponentialRampToValueAtTime(48, t + 0.11)
  const g = env(ac, t, 0.95, 0.3)
  o.connect(g); g.connect(ac.destination)
  o.start(t); o.stop(t + 0.32)
}

function noiseBuffer(ac: BaseAudioContext, len: number): AudioBufferSourceNode {
  const buf = ac.createBuffer(1, Math.ceil(ac.sampleRate * len), ac.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  const src = ac.createBufferSource(); src.buffer = buf
  return src
}

function synthSnare(ac: BaseAudioContext, t: number) {
  const n = noiseBuffer(ac, 0.2)
  const f = ac.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1900; f.Q.value = 0.7
  const g = env(ac, t, 0.5, 0.18)
  n.connect(f); f.connect(g); g.connect(ac.destination)
  n.start(t); n.stop(t + 0.2)
  const o = ac.createOscillator(); o.type = 'triangle'; o.frequency.value = 180
  const gt = env(ac, t, 0.28, 0.12)
  o.connect(gt); gt.connect(ac.destination); o.start(t); o.stop(t + 0.14)
}

function synthHat(ac: BaseAudioContext, t: number, open: boolean, gain: number, pan = 0) {
  const len = open ? 0.3 : 0.05
  const n = noiseBuffer(ac, len)
  const f = ac.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 8500
  const g = env(ac, t, (open ? 0.24 : 0.3) * gain, len)
  n.connect(f); f.connect(g)
  if (pan && ac.createStereoPanner) { const p = ac.createStereoPanner(); p.pan.value = pan; g.connect(p); p.connect(ac.destination) }
  else g.connect(ac.destination)
  n.start(t); n.stop(t + len + 0.01)
}

function synthBass(ac: BaseAudioContext, t: number, hz: number, dur: number) {
  const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = hz
  const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = Math.min(1800, hz * 6); f.Q.value = 0.8
  const g = ac.createGain()
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(0.32, t + 0.01)
  g.gain.setValueAtTime(0.32, t + dur * 0.6)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  o.connect(f); f.connect(g); g.connect(ac.destination)
  o.start(t); o.stop(t + dur + 0.02)
}
