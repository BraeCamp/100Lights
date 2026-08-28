/* ===========================================================================
   Example Synth — a reference implementation of the Beacon Plugin Format v1.

   Everything a plugin has to get right is here and nowhere else:

     * notes are scheduled by ABSOLUTE CONTEXT TIME, never by timer, which is
       what makes an offline bounce come out identical to live playback;
     * `ready` is posted once, after init, and the host queues everything sent
       before it;
     * no allocation in process(), so the audio thread never waits for GC;
     * the processor keeps running while voices are releasing and returns true
       forever, because returning false destroys the node.

   Copy this folder to start your own plugin. There is no build step.
   =========================================================================== */

'use strict'

const TWO_PI = Math.PI * 2
const MAX_VOICES = 16

function clamp(v, a, b) { return v < a ? a : v > b ? b : v }
function midiToHz(n) { return 440 * Math.pow(2, (n - 69) / 12) }
function dbToGain(db) { return Math.pow(10, db / 20) }

/* ------------------------------------------------------------------ voice -- */

class Voice {
  constructor() {
    this.active = false
    this.note = -1
    this.phase1 = 0
    this.phase2 = 0
    this.velocity = 0

    // amp envelope
    this.env = 0
    this.stage = 'idle'   // attack | decay | sustain | release

    // filter state (topology-preserving SVF)
    this.ic1 = 0
    this.ic2 = 0

    // when this voice was started, for stealing the oldest
    this.age = 0
  }

  start(note, velocity, age) {
    this.active = true
    this.note = note
    this.velocity = velocity
    this.stage = 'attack'
    this.age = age
    // Phases are NOT reset: restarting them on every note makes repeated notes
    // sound mechanically identical, and on a saw it adds a click.
  }

  release() {
    if (this.active) this.stage = 'release'
  }

  kill() {
    this.active = false
    this.stage = 'idle'
    this.env = 0
    this.ic1 = 0
    this.ic2 = 0
  }
}

/* --------------------------------------------------------------- waveforms -- */

function wave(kind, phase) {
  switch (kind) {
    case 0: return Math.sin(phase * TWO_PI)
    case 1: return 4 * Math.abs(phase - 0.5) - 1
    case 2: return 2 * phase - 1
    default: return phase < 0.5 ? 1 : -1
  }
}

/* A one-sample polyBLEP, enough to keep saws and squares from sounding gritty
   in the top octaves without a wavetable. */
function polyBlep(t, dt) {
  if (t < dt) { const x = t / dt; return x + x - x * x - 1 }
  if (t > 1 - dt) { const x = (t - 1) / dt; return x * x + x + x + 1 }
  return 0
}

function bandLimited(kind, phase, dt) {
  if (kind === 0 || kind === 1) return wave(kind, phase)
  if (kind === 2) return wave(2, phase) - polyBlep(phase, dt)
  let s = phase < 0.5 ? 1 : -1
  s += polyBlep(phase, dt)
  let p2 = phase + 0.5
  if (p2 >= 1) p2 -= 1
  s -= polyBlep(p2, dt)
  return s
}

/* =========================================================================== */

class ExampleSynth extends AudioWorkletProcessor {
  constructor() {
    super()

    this.ready = false
    this.p = {}                 // parameter values by id
    this.voices = []
    for (let i = 0; i < MAX_VOICES; i++) this.voices.push(new Voice())
    this.ageCounter = 0

    // pending note events, sorted by time, consumed as the clock reaches them
    this.events = []

    // stereo delay
    const maxDelay = Math.ceil(sampleRate * 2)
    this.dL = new Float32Array(maxDelay)
    this.dR = new Float32Array(maxDelay)
    this.dWrite = 0
    this.dSize = maxDelay

    this.peak = 0
    this.meterCountdown = 0

    this.port.onmessage = (e) => this.onMessage(e.data)
  }

  /* ------------------------------------------------------------ messages -- */

  onMessage(msg) {
    switch (msg.type) {
      case 'init':
        this.p = { ...msg.values }
        this.ready = true
        // No wasm here, so there is nothing to compile before answering.
        this.port.postMessage({ type: 'ready' })
        break

      case 'note':
        // Keep the queue ordered by time so process() only ever looks at the
        // head. Note-offs and note-ons can arrive out of order.
        this.insertEvent(msg)
        break

      case 'param':
        this.p[msg.id] = msg.value
        break

      case 'params':
        for (const k of Object.keys(msg.values)) this.p[k] = msg.values[k]
        break

      case 'state':
        // This plugin keeps nothing beyond its parameters, so there is nothing
        // to restore. A sampler would decode its buffers here.
        break

      case 'requestState':
        this.port.postMessage({ type: 'state', state: '' })
        break

      case 'transport':
        this.bpm = msg.bpm
        break

      case 'panic':
        for (const v of this.voices) v.kill()
        this.events.length = 0
        this.dL.fill(0)
        this.dR.fill(0)
        break

      default:
        break
    }
  }

  insertEvent(msg) {
    const t = msg.time
    let i = this.events.length
    while (i > 0 && this.events[i - 1].time > t) i--
    this.events.splice(i, 0, msg)
  }

  /* -------------------------------------------------------------- voices -- */

  noteOn(note, velocity) {
    let v = this.voices.find(x => x.active && x.note === note)
    if (!v) v = this.voices.find(x => !x.active)
    if (!v) {
      // steal the quietest voice already releasing, else the oldest
      let best = null
      for (const x of this.voices) {
        if (x.stage !== 'release') continue
        if (!best || x.env < best.env) best = x
      }
      if (!best) {
        best = this.voices[0]
        for (const x of this.voices) if (x.age < best.age) best = x
      }
      v = best
    }
    v.start(note, velocity, ++this.ageCounter)
  }

  noteOff(note) {
    for (const v of this.voices) if (v.active && v.note === note) v.release()
  }

  /* ------------------------------------------------------------- process -- */

  process(_inputs, outputs) {
    const out = outputs[0]
    if (!out || out.length === 0) return true

    const left = out[0]
    const right = out.length > 1 ? out[1] : null
    const n = left.length

    if (!this.ready) {
      left.fill(0)
      if (right) right.fill(0)
      return true
    }

    const p = this.p
    const sr = sampleRate
    const invSr = 1 / sr

    // ---- parameters, read once per block
    const osc1 = p.osc1Wave | 0
    const osc2 = p.osc2Wave | 0
    const mix = clamp(p.oscMix ?? 0.35, 0, 1)
    const detuneRatio = Math.pow(2, (p.detune ?? 0) / 1200)
    const oct2 = Math.pow(2, p.octave2 ?? 0)
    const cutoff = clamp(p.cutoff ?? 2400, 30, Math.min(18000, sr * 0.45))
    const q = 0.5 + clamp(p.resonance ?? 0.2, 0, 1) * 9
    const filterEnv = clamp(p.filterEnv ?? 0.4, -1, 1)
    const gain = dbToGain(p.gain ?? -8)

    const aCoef = 1 - Math.exp(-1 / Math.max(1, (p.attack ?? 0.008) * sr))
    const dCoef = 1 - Math.exp(-1 / Math.max(1, (p.decay ?? 0.35) * sr))
    const rCoef = 1 - Math.exp(-1 / Math.max(1, (p.release ?? 0.3) * sr))
    const sustain = clamp(p.sustain ?? 0.7, 0, 1)

    const delayMix = clamp(p.delayMix ?? 0.15, 0, 1)
    const delaySamples = clamp(Math.round((p.delayTime ?? 0.28) * sr), 2, this.dSize - 2)
    const delayFb = clamp(p.delayFeedback ?? 0.35, 0, 0.95)

    // ---- events due inside this block
    const blockStart = currentTime
    let eventIndex = 0

    let blockPeak = 0

    for (let i = 0; i < n; i++) {
      const t = blockStart + i * invSr

      while (eventIndex < this.events.length && this.events[eventIndex].time <= t) {
        const ev = this.events[eventIndex++]
        if (ev.on) this.noteOn(ev.pitch, ev.velocity)
        else this.noteOff(ev.pitch)
      }

      let sum = 0

      for (let vi = 0; vi < MAX_VOICES; vi++) {
        const v = this.voices[vi]
        if (!v.active) continue

        // ---- amp envelope
        switch (v.stage) {
          case 'attack':
            v.env += (1.04 - v.env) * aCoef
            if (v.env >= 1) { v.env = 1; v.stage = 'decay' }
            break
          case 'decay':
            v.env += (sustain - v.env) * dCoef
            if (Math.abs(v.env - sustain) < 1e-4) { v.env = sustain; v.stage = 'sustain' }
            break
          case 'sustain':
            v.env += (sustain - v.env) * 0.001
            break
          case 'release':
            v.env += (0 - v.env) * rCoef
            if (v.env < 1e-4) { v.kill(); continue }
            break
          default:
            break
        }

        // ---- oscillators
        const f1 = midiToHz(v.note)
        const f2 = f1 * detuneRatio * oct2
        const dt1 = f1 * invSr
        const dt2 = f2 * invSr

        v.phase1 += dt1
        if (v.phase1 >= 1) v.phase1 -= 1
        v.phase2 += dt2
        if (v.phase2 >= 1) v.phase2 -= 1

        const a = bandLimited(osc1, v.phase1, dt1)
        const b = bandLimited(osc2, v.phase2, dt2)
        let s = a * (1 - mix) + b * mix

        // ---- filter, with the amp envelope opening it
        const fc = clamp(cutoff * Math.pow(2, filterEnv * v.env * 4), 20, sr * 0.45)
        const g = Math.tan(Math.PI * fc * invSr)
        const k = 1 / q
        const a1 = 1 / (1 + g * (g + k))
        const a2 = g * a1
        const a3 = g * a2

        const v3 = s - v.ic2
        const v1 = a1 * v.ic1 + a2 * v3
        const v2 = v.ic2 + a2 * v.ic1 + a3 * v3
        v.ic1 = 2 * v1 - v.ic1
        v.ic2 = 2 * v2 - v.ic2
        s = v2

        sum += s * v.env * v.velocity
      }

      // ---- delay
      const readIndex = (this.dWrite - delaySamples + this.dSize) % this.dSize
      const dl = this.dL[readIndex]
      const dr = this.dR[readIndex]

      // ping-pong: what comes back on the left is fed to the right
      this.dL[this.dWrite] = sum * 0.5 + dr * delayFb
      this.dR[this.dWrite] = dl * delayFb
      this.dWrite = (this.dWrite + 1) % this.dSize

      let outL = (sum + dl * delayMix) * gain
      let outR = (sum + dr * delayMix) * gain

      // a gentle safety curve rather than a hard clip
      if (outL > 1 || outL < -1) outL = Math.tanh(outL)
      if (outR > 1 || outR < -1) outR = Math.tanh(outR)

      left[i] = outL
      if (right) right[i] = outR

      const m = outL > 0 ? outL : -outL
      if (m > blockPeak) blockPeak = m
    }

    if (eventIndex > 0) this.events.splice(0, eventIndex)

    // ---- meter, a few times a second rather than every block
    this.peak = Math.max(this.peak * 0.85, blockPeak)
    this.meterCountdown -= n
    if (this.meterCountdown <= 0) {
      this.meterCountdown = sr / 20
      this.port.postMessage({ type: 'meter', peak: this.peak })
    }

    // Never return false: that destroys the node, and the host still holds a
    // reference to it. The host disconnects when it is done with us.
    return true
  }
}

registerProcessor('beacon-example-synth', ExampleSynth)
