export interface SamplePreset {
  id: string
  name: string
  category: 'lead' | 'pad' | 'bass' | 'keys' | 'strings' | 'experimental'
  description: string
}

export const SAMPLE_LIBRARY: SamplePreset[] = [
  { id: 'moog-lead',    name: 'Moog Lead',    category: 'lead',         description: 'Sawtooth with resonant 24dB filter — classic analog lead' },
  { id: 'supersaw',     name: 'Supersaw',     category: 'lead',         description: 'Stacked detuned saws (Roland JP-8000 style)' },
  { id: 'juno-pad',     name: 'Juno Pad',     category: 'pad',          description: 'Warm square wave with chorus character (Juno-106)' },
  { id: 'oberheim-pad', name: 'Oberheim Pad', category: 'pad',          description: 'Lush detuned polysynth pads (OB-Xa style)' },
  { id: 'glass-pad',    name: 'Glass Pad',    category: 'pad',          description: 'Shimmery metallic pad with sine + upper partials' },
  { id: 'mini-bass',    name: 'Mini Bass',    category: 'bass',         description: 'Fat square wave Minimoog bass' },
  { id: 'tb303',        name: 'TB-303',       category: 'bass',         description: 'Squelchy acid bass with high resonance filter' },
  { id: 'b3-organ',     name: 'B3 Organ',     category: 'keys',         description: 'Hammond-style additive drawbar organ' },
  { id: 'dx7-bell',     name: 'DX7 Bell',     category: 'keys',         description: 'FM synthesis bright metallic bells (DX7 style)' },
  { id: 'strings',      name: 'Strings',      category: 'strings',      description: 'Detuned ensemble string synth, slow and dark' },
  { id: 'flute',        name: 'Flute',        category: 'experimental', description: 'Breathy sine-based flute tone' },
  { id: 'tape-warm',    name: 'Tape Warm',    category: 'experimental', description: 'Saturated tape warmth, dark lo-fi character' },
]

const C4 = 261.63
const SR = 44100
const DUR = 2.5

type Gen = () => Promise<AudioBuffer>

const GENERATORS: Record<string, Gen> = {

  'moog-lead': async () => {
    const ctx = new OfflineAudioContext(1, Math.ceil(SR * DUR), SR)
    const osc = ctx.createOscillator()
    osc.type = 'sawtooth'; osc.frequency.value = C4
    const filt = ctx.createBiquadFilter()
    filt.type = 'lowpass'; filt.frequency.value = 2200; filt.Q.value = 3.5
    const g = ctx.createGain(); g.gain.value = 0.7
    osc.connect(filt); filt.connect(g); g.connect(ctx.destination)
    osc.start(0); osc.stop(DUR)
    return ctx.startRendering()
  },

  'supersaw': async () => {
    const ctx = new OfflineAudioContext(1, Math.ceil(SR * DUR), SR)
    const detunes = [-12, -6, -2, 0, 2, 6, 12]
    const g = ctx.createGain(); g.gain.value = 0.6 / detunes.length
    g.connect(ctx.destination)
    const filt = ctx.createBiquadFilter()
    filt.type = 'lowpass'; filt.frequency.value = 3000; filt.Q.value = 1.5
    filt.connect(g)
    for (const cents of detunes) {
      const osc = ctx.createOscillator()
      osc.type = 'sawtooth'
      osc.frequency.value = C4 * Math.pow(2, cents / 1200)
      osc.connect(filt)
      osc.start(0); osc.stop(DUR)
    }
    return ctx.startRendering()
  },

  'juno-pad': async () => {
    const ctx = new OfflineAudioContext(1, Math.ceil(SR * DUR), SR)
    const osc = ctx.createOscillator()
    osc.type = 'square'; osc.frequency.value = C4
    const filt = ctx.createBiquadFilter()
    filt.type = 'lowpass'; filt.frequency.value = 1200; filt.Q.value = 1.5
    const g = ctx.createGain(); g.gain.value = 0.65
    osc.connect(filt); filt.connect(g); g.connect(ctx.destination)
    osc.start(0); osc.stop(DUR)
    return ctx.startRendering()
  },

  'oberheim-pad': async () => {
    const ctx = new OfflineAudioContext(1, Math.ceil(SR * DUR), SR)
    const g = ctx.createGain(); g.gain.value = 0.4
    g.connect(ctx.destination)
    const filt = ctx.createBiquadFilter()
    filt.type = 'lowpass'; filt.frequency.value = 1000; filt.Q.value = 2
    filt.connect(g)
    for (const cents of [-7, 0, 7]) {
      const osc = ctx.createOscillator()
      osc.type = 'sawtooth'
      osc.frequency.value = C4 * Math.pow(2, cents / 1200)
      osc.connect(filt)
      osc.start(0); osc.stop(DUR)
    }
    return ctx.startRendering()
  },

  'glass-pad': async () => {
    const ctx = new OfflineAudioContext(1, Math.ceil(SR * DUR), SR)
    const g = ctx.createGain(); g.gain.value = 0.7
    g.connect(ctx.destination)
    // Fundamental + upper partials at non-integer ratios for metallic/glassy character
    const partials: [number, number][] = [[1, 0.8], [2.76, 0.4], [5.4, 0.2], [8.93, 0.1]]
    for (const [ratio, amp] of partials) {
      const osc = ctx.createOscillator()
      osc.type = 'sine'; osc.frequency.value = C4 * ratio
      const pg = ctx.createGain(); pg.gain.value = amp
      osc.connect(pg); pg.connect(g)
      osc.start(0); osc.stop(DUR)
    }
    return ctx.startRendering()
  },

  'mini-bass': async () => {
    const ctx = new OfflineAudioContext(1, Math.ceil(SR * DUR), SR)
    const osc = ctx.createOscillator()
    osc.type = 'square'; osc.frequency.value = C4 / 2  // one octave down for bass feel
    const filt = ctx.createBiquadFilter()
    filt.type = 'lowpass'; filt.frequency.value = 350; filt.Q.value = 1
    const g = ctx.createGain(); g.gain.value = 0.75
    osc.connect(filt); filt.connect(g); g.connect(ctx.destination)
    osc.start(0); osc.stop(DUR)
    return ctx.startRendering()
  },

  'tb303': async () => {
    const ctx = new OfflineAudioContext(1, Math.ceil(SR * DUR), SR)
    const osc = ctx.createOscillator()
    osc.type = 'sawtooth'; osc.frequency.value = C4 / 2
    const filt = ctx.createBiquadFilter()
    filt.type = 'lowpass'; filt.frequency.value = 800; filt.Q.value = 10
    const g = ctx.createGain(); g.gain.value = 0.65
    osc.connect(filt); filt.connect(g); g.connect(ctx.destination)
    osc.start(0); osc.stop(DUR)
    return ctx.startRendering()
  },

  'b3-organ': async () => {
    const ctx = new OfflineAudioContext(1, Math.ceil(SR * DUR), SR)
    const g = ctx.createGain(); g.gain.value = 0.7
    g.connect(ctx.destination)
    // Hammond drawbar harmonics: 16', 8', 5⅓', 4', 2⅔', 2', 1⅗', 1⅓', 1'
    const drawbars: [number, number][] = [
      [0.5, 0.5], [1, 0.8], [1.5, 0.6], [2, 0.7],
      [3, 0.5], [4, 0.4], [5, 0.2], [6, 0.15], [8, 0.1],
    ]
    for (const [ratio, amp] of drawbars) {
      const osc = ctx.createOscillator()
      osc.type = 'sine'; osc.frequency.value = C4 * ratio
      const pg = ctx.createGain(); pg.gain.value = amp
      osc.connect(pg); pg.connect(g)
      osc.start(0); osc.stop(DUR)
    }
    return ctx.startRendering()
  },

  'dx7-bell': async () => {
    const ctx = new OfflineAudioContext(1, Math.ceil(SR * DUR), SR)
    const carrier = ctx.createOscillator()
    carrier.type = 'sine'; carrier.frequency.value = C4
    const modulator = ctx.createOscillator()
    modulator.type = 'sine'; modulator.frequency.value = C4 * 3.5
    const modGain = ctx.createGain()
    modGain.gain.setValueAtTime(C4 * 8, 0)
    modGain.gain.exponentialRampToValueAtTime(C4 * 0.5, DUR)
    modulator.connect(modGain); modGain.connect(carrier.frequency)
    const g = ctx.createGain(); g.gain.value = 0.7
    carrier.connect(g); g.connect(ctx.destination)
    carrier.start(0); carrier.stop(DUR)
    modulator.start(0); modulator.stop(DUR)
    return ctx.startRendering()
  },

  'strings': async () => {
    const ctx = new OfflineAudioContext(1, Math.ceil(SR * DUR), SR)
    const g = ctx.createGain(); g.gain.value = 0.5
    g.connect(ctx.destination)
    const filt = ctx.createBiquadFilter()
    filt.type = 'lowpass'; filt.frequency.value = 700; filt.Q.value = 0.7
    filt.connect(g)
    for (const cents of [-15, -8, -3, 0, 3, 8, 15]) {
      const osc = ctx.createOscillator()
      osc.type = 'sawtooth'
      osc.frequency.value = C4 * Math.pow(2, cents / 1200)
      osc.connect(filt)
      osc.start(0); osc.stop(DUR)
    }
    return ctx.startRendering()
  },

  'flute': async () => {
    const ctx = new OfflineAudioContext(1, Math.ceil(SR * DUR), SR)
    const g = ctx.createGain(); g.gain.value = 0.7
    g.connect(ctx.destination)
    // Fundamental dominant, slight second harmonic, narrow bandpass peak for air
    const partials: [number, number][] = [[1, 0.9], [2, 0.15], [3, 0.05]]
    for (const [ratio, amp] of partials) {
      const osc = ctx.createOscillator()
      osc.type = 'sine'; osc.frequency.value = C4 * ratio
      const pg = ctx.createGain(); pg.gain.value = amp
      osc.connect(pg); pg.connect(g)
      osc.start(0); osc.stop(DUR)
    }
    return ctx.startRendering()
  },

  'tape-warm': async () => {
    const ctx = new OfflineAudioContext(1, Math.ceil(SR * DUR), SR)
    const osc = ctx.createOscillator()
    osc.type = 'sawtooth'; osc.frequency.value = C4
    // Tape saturation: gentle soft-clip curve
    const shaper = ctx.createWaveShaper()
    const n = 512
    const curve = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      const x = (i * 2 / (n - 1)) - 1
      curve[i] = Math.tanh(x * 2) / Math.tanh(2)
    }
    shaper.curve = curve; shaper.oversample = '4x'
    const filt = ctx.createBiquadFilter()
    filt.type = 'lowpass'; filt.frequency.value = 500; filt.Q.value = 0.6
    const g = ctx.createGain(); g.gain.value = 0.7
    osc.connect(shaper); shaper.connect(filt); filt.connect(g); g.connect(ctx.destination)
    osc.start(0); osc.stop(DUR)
    return ctx.startRendering()
  },
}

const cache = new Map<string, AudioBuffer>()

export async function getSampleBuffer(presetId: string): Promise<AudioBuffer | null> {
  if (typeof window === 'undefined') return null
  if (cache.has(presetId)) return cache.get(presetId)!
  const gen = GENERATORS[presetId]
  if (!gen) return null
  const buf = await gen()
  cache.set(presetId, buf)
  return buf
}
