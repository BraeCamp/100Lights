// Tiny synthesized drum voices shared by the rhythm widgets (swing, sidechain).
// Each schedules a one-shot at time `t` into `dest`. Kept deliberately minimal —
// these are teaching aids, not the studio's kit.

function noise(c: AudioContext, len: number): AudioBufferSourceNode {
  const b = c.createBuffer(1, Math.ceil(c.sampleRate * len), c.sampleRate)
  const d = b.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  const s = c.createBufferSource(); s.buffer = b
  return s
}

export function dkick(c: AudioContext, t: number, dest: AudioNode, gain = 0.9) {
  const o = c.createOscillator()
  o.frequency.setValueAtTime(150, t)
  o.frequency.exponentialRampToValueAtTime(48, t + 0.11)
  const e = c.createGain()
  e.gain.setValueAtTime(gain, t)
  e.gain.exponentialRampToValueAtTime(0.001, t + 0.3)
  o.connect(e); e.connect(dest); o.start(t); o.stop(t + 0.32)
}

export function dsnare(c: AudioContext, t: number, dest: AudioNode, gain = 0.5) {
  const n = noise(c, 0.2)
  const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1900
  const e = c.createGain(); e.gain.setValueAtTime(gain, t); e.gain.exponentialRampToValueAtTime(0.001, t + 0.18)
  n.connect(f); f.connect(e); e.connect(dest); n.start(t); n.stop(t + 0.2)
}

export function dhat(c: AudioContext, t: number, dest: AudioNode, gain = 0.3) {
  const n = noise(c, 0.05)
  const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 8500
  const e = c.createGain(); e.gain.setValueAtTime(gain, t); e.gain.exponentialRampToValueAtTime(0.001, t + 0.05)
  n.connect(f); f.connect(e); e.connect(dest); n.start(t); n.stop(t + 0.06)
}
