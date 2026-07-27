// A short, broadband groove (kick / snare / hats / saw bass) rendered offline
// into a seamless loop buffer. It gives the article mixing widgets real, dynamic
// material to shape — transients for a compressor, low end for EQ, a stereo-able
// body for width — with nothing to download. Cached per sample-rate.

const cache = new Map<number, Promise<AudioBuffer>>()

/** A 2-bar, 100-bpm groove as a loopable buffer at the given sample rate. */
export function grooveLoop(sampleRate: number): Promise<AudioBuffer> {
  const hit = cache.get(sampleRate)
  if (hit) return hit
  const p = render(sampleRate)
  cache.set(sampleRate, p)
  return p
}

const BPM = 100
const BARS = 2
const STEP = 60 / BPM / 4          // sixteenth-note, seconds

async function render(sampleRate: number): Promise<AudioBuffer> {
  const beats = BARS * 4
  const dur = (60 / BPM) * beats
  const OAC = (typeof OfflineAudioContext !== 'undefined'
    ? OfflineAudioContext
    : (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext)
  const ac = new OAC(2, Math.ceil(dur * sampleRate), sampleRate)
  const at = (step: number) => step * STEP

  // Four-on-the-floor with an offbeat hat shuffle + a moving saw bass, over 2 bars.
  const kick = [0, 4, 8, 12, 16, 20, 24, 28]
  const snare = [4, 12, 20, 28]
  const clHat = [2, 6, 10, 14, 18, 22, 26, 30]
  const opHat = [7, 23]
  // Bass: A1 root moving to C2 / E2 / G1 across the two bars (Hz).
  const bass: Array<[number, number]> = [
    [0, 55.0], [3, 55.0], [6, 82.4], [8, 65.4],
    [11, 65.4], [14, 98.0], [16, 55.0], [19, 55.0],
    [22, 82.4], [24, 49.0], [27, 49.0], [30, 73.4],
  ]

  for (const s of kick)  synthKick(ac, at(s))
  for (const s of snare) synthSnare(ac, at(s))
  // Closed hats alternate across the stereo field, open hats sit wide — this is
  // what gives the loop real width for the stereo widget (and just sounds nicer).
  clHat.forEach((s, i) => synthHat(ac, at(s), false, i % 2 ? 0.4 : -0.4))
  opHat.forEach((s, i) => synthHat(ac, at(s), true, i % 2 ? -0.6 : 0.6))
  for (const [s, hz] of bass) synthBass(ac, at(s), hz, STEP * 2.6)

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
  // Body tone under the noise.
  const o = ac.createOscillator(); o.type = 'triangle'; o.frequency.value = 180
  const gt = env(ac, t, 0.28, 0.12)
  o.connect(gt); gt.connect(ac.destination); o.start(t); o.stop(t + 0.14)
}

function synthHat(ac: BaseAudioContext, t: number, open: boolean, pan = 0) {
  const len = open ? 0.3 : 0.05
  const n = noiseBuffer(ac, len)
  const f = ac.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 8500
  const g = env(ac, t, open ? 0.24 : 0.3, len)
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
