/**
 * Wavetable synthesizer engine for BeatLab.
 *
 * 64-frame wavetable (2048 samples / frame) with dual oscillators, subtractive
 * filter, ADSR envelopes for amplitude and filter, and an LFO.
 * Synthesis uses Web Audio API PeriodicWave (frequency-domain representation).
 */

// ── Types ──────────────────────────────────────────────────────────────────────

export interface WavetablePatch {
  // Oscillator A
  oscAWavetable: 'analog' | 'digital' | 'vocal' | 'strings' | 'brass' | 'custom'
  oscAPosition:  number        // 0–1 wavetable scan position
  oscADetune:    number        // semitones  (-24 to +24)
  oscAGain:      number        // 0–1

  // Oscillator B
  oscBWavetable: 'analog' | 'digital' | 'vocal' | 'strings' | 'brass' | 'custom'
  oscBPosition:  number
  oscBDetune:    number
  oscBGain:      number

  // Filter
  filterType:      'lowpass' | 'highpass' | 'bandpass'
  filterCutoff:    number        // 20–20000 Hz
  filterResonance: number        // 0–30
  filterEnvAmount: number        // -1 to +1

  // Amplitude envelope (seconds)
  attack:  number
  decay:   number
  sustain: number        // 0–1
  release: number

  // Filter envelope (seconds)
  fAttack:  number
  fDecay:   number
  fSustain: number       // 0–1
  fRelease: number

  // LFO
  lfoShape:  'sine' | 'triangle' | 'square' | 'sawtooth'
  lfoRate:   number      // 0.1–20 Hz
  lfoDepth:  number      // 0–1
  lfoTarget: 'pitch' | 'filter' | 'wavetable' | 'pan'

  // Master
  masterGain: number     // 0–1
  polyphony:  number     // 1–8
}

export const WAVETABLE_FRAMES = 64
export const FRAME_SIZE      = 2048
const        NUM_HARMONICS   = 128   // Fourier series order

// ── Built-in presets ───────────────────────────────────────────────────────────

function base(): WavetablePatch {
  return {
    oscAWavetable: 'analog', oscAPosition: 0.7,  oscADetune: 0,   oscAGain: 0.8,
    oscBWavetable: 'analog', oscBPosition: 0.7,  oscBDetune: 7,   oscBGain: 0.5,
    filterType: 'lowpass',   filterCutoff: 2000, filterResonance: 3, filterEnvAmount: 0.5,
    attack: 0.02, decay: 0.3, sustain: 0.6, release: 0.4,
    fAttack: 0.01, fDecay: 0.2, fSustain: 0.4, fRelease: 0.3,
    lfoShape: 'sine', lfoRate: 4, lfoDepth: 0.08, lfoTarget: 'pitch',
    masterGain: 0.7, polyphony: 4,
  }
}

export const WAVETABLE_PRESETS: Record<string, WavetablePatch> = {
  Lead: {
    ...base(),
    oscAWavetable: 'analog', oscAPosition: 0.85, oscADetune: 0, oscAGain: 0.9,
    oscBWavetable: 'digital', oscBPosition: 0.6, oscBDetune: 12, oscBGain: 0.4,
    filterCutoff: 3500, filterResonance: 5, filterEnvAmount: 0.6,
    attack: 0.008, decay: 0.25, sustain: 0.65, release: 0.3,
    lfoDepth: 0.1,
  },
  Pad: {
    ...base(),
    oscAWavetable: 'strings', oscAPosition: 0.5, oscAGain: 0.75,
    oscBWavetable: 'strings', oscBPosition: 0.55, oscBDetune: -7, oscBGain: 0.6,
    filterCutoff: 900, filterResonance: 1, filterEnvAmount: 0.3,
    attack: 0.6, decay: 1.0, sustain: 0.75, release: 1.5,
    fAttack: 0.5, fDecay: 0.8, fSustain: 0.6, fRelease: 1.2,
    lfoRate: 0.4, lfoDepth: 0.04,
  },
  Bass: {
    ...base(),
    oscAWavetable: 'analog', oscAPosition: 1.0, oscADetune: 0, oscAGain: 0.95,
    oscBWavetable: 'analog', oscBPosition: 1.0, oscBDetune: -12, oscBGain: 0.5,
    filterCutoff: 700, filterResonance: 8, filterEnvAmount: 0.7,
    attack: 0.004, decay: 0.12, sustain: 0.45, release: 0.18,
    fAttack: 0.003, fDecay: 0.1, fSustain: 0.2, fRelease: 0.15,
    lfoDepth: 0, polyphony: 2,
  },
  Keys: {
    ...base(),
    oscAWavetable: 'digital', oscAPosition: 0.4, oscADetune: 0, oscAGain: 0.85,
    oscBWavetable: 'analog',  oscBPosition: 0.9, oscBDetune: 0, oscBGain: 0.35,
    filterCutoff: 4000, filterResonance: 2, filterEnvAmount: 0.3,
    attack: 0.005, decay: 0.4, sustain: 0.55, release: 0.6,
    fAttack: 0.005, fDecay: 0.35, fSustain: 0.3, fRelease: 0.5,
    lfoDepth: 0,
  },
  Arp: {
    ...base(),
    oscAWavetable: 'digital', oscAPosition: 0.9, oscADetune: 0, oscAGain: 0.9,
    oscBWavetable: 'digital', oscBPosition: 0.95, oscBDetune: 5, oscBGain: 0.4,
    filterCutoff: 5000, filterResonance: 6, filterEnvAmount: 0.8,
    attack: 0.001, decay: 0.1, sustain: 0.2, release: 0.15,
    fAttack: 0.001, fDecay: 0.08, fSustain: 0.1, fRelease: 0.12,
    lfoDepth: 0, polyphony: 2,
  },
  Brass: {
    ...base(),
    oscAWavetable: 'brass', oscAPosition: 0.7, oscADetune: 0, oscAGain: 0.9,
    oscBWavetable: 'brass', oscBPosition: 0.75, oscBDetune: 5, oscBGain: 0.5,
    filterCutoff: 3000, filterResonance: 4, filterEnvAmount: 0.65,
    attack: 0.06, decay: 0.15, sustain: 0.75, release: 0.25,
    fAttack: 0.04, fDecay: 0.12, fSustain: 0.5, fRelease: 0.2,
    lfoDepth: 0.05, lfoTarget: 'pitch',
  },
  Strings: {
    ...base(),
    oscAWavetable: 'strings', oscAPosition: 0.6, oscADetune: 0,   oscAGain: 0.8,
    oscBWavetable: 'strings', oscBPosition: 0.65, oscBDetune: -5, oscBGain: 0.7,
    filterCutoff: 1800, filterResonance: 1, filterEnvAmount: 0.2,
    attack: 0.3, decay: 0.7, sustain: 0.8, release: 1.0,
    fAttack: 0.25, fDecay: 0.5, fSustain: 0.7, fRelease: 0.8,
    lfoRate: 5.5, lfoDepth: 0.07, lfoTarget: 'pitch',
  },
  Choir: {
    ...base(),
    oscAWavetable: 'vocal', oscAPosition: 0.2, oscADetune: 0,   oscAGain: 0.8,
    oscBWavetable: 'vocal', oscBPosition: 0.25, oscBDetune: 5,  oscBGain: 0.65,
    filterCutoff: 2200, filterResonance: 1, filterEnvAmount: 0.15,
    attack: 0.4, decay: 0.9, sustain: 0.85, release: 1.2,
    fAttack: 0.35, fDecay: 0.7, fSustain: 0.75, fRelease: 1.0,
    lfoRate: 4.5, lfoDepth: 0.06, lfoTarget: 'wavetable',
  },
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function midiToHz(note: number): number {
  return 440 * Math.pow(2, (note - 69) / 12)
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

// ── Fourier coefficients ───────────────────────────────────────────────────────

/**
 * Compute Fourier series coefficients (real[], imag[]) for a given wavetable
 * type at frame index 0–63.  The arrays are suitable for ctx.createPeriodicWave().
 */
export function getFrameCoefficients(
  type: WavetablePatch['oscAWavetable'],
  frame: number,
): { real: Float32Array; imag: Float32Array } {
  const real = new Float32Array(NUM_HARMONICS + 1)
  const imag = new Float32Array(NUM_HARMONICS + 1)
  const t = clamp(frame / (WAVETABLE_FRAMES - 1), 0, 1)

  switch (type) {
    case 'analog': {
      // Frame 0 = pure sine → Frame 63 = full sawtooth
      for (let k = 1; k <= NUM_HARMONICS; k++) {
        const sign = k % 2 === 1 ? 1 : -1
        const saw  = (2 / Math.PI) * sign / k
        imag[k]    = k === 1 ? (1 - t) + t * saw : t * saw
      }
      break
    }

    case 'digital': {
      // Pulse width modulation: narrow (10 %) → square (50 %)
      const pw = 0.1 + t * 0.4
      for (let k = 1; k <= NUM_HARMONICS; k++) {
        imag[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * pw)
      }
      break
    }

    case 'vocal': {
      // Four vowel formant positions spread over 64 frames.
      // Each entry: array of [harmonic_index, amplitude, gaussian_sigma]
      const vowels: Array<Array<[number, number, number]>> = [
        // 'aa'
        [[1, 0.4, 1.5], [3, 1.0, 0.9], [7, 0.5, 1.1], [14, 0.25, 2.0]],
        // 'eh'
        [[2, 0.6, 1.0], [6, 1.0, 0.8], [13, 0.35, 1.4], [22, 0.2, 2.0]],
        // 'ee'
        [[1, 0.3, 1.5], [9, 1.0, 0.7], [17, 0.4, 1.0], [26, 0.2, 1.5]],
        // 'oo'
        [[1, 1.0, 2.0], [2, 0.6, 0.9], [8, 0.25, 1.4], [15, 0.2, 2.0]],
      ]
      const vi   = Math.min(2, Math.floor(t * 3))
      const lt   = t * 3 - vi
      const v0   = vowels[vi]
      const v1   = vowels[vi + 1] ?? vowels[vi]
      for (let k = 1; k <= NUM_HARMONICS; k++) {
        let a0 = 0, a1 = 0
        for (const [fk, fa, fw] of v0) a0 += fa * Math.exp(-0.5 * ((k - fk) / fw) ** 2)
        for (const [fk, fa, fw] of v1) a1 += fa * Math.exp(-0.5 * ((k - fk) / fw) ** 2)
        imag[k] = ((1 - lt) * a0 + lt * a1) / k
      }
      break
    }

    case 'strings': {
      // Smooth glassy (frame 0) → bright bowed (frame 63)
      for (let k = 1; k <= NUM_HARMONICS; k++) {
        const oddBoost = k % 2 === 1 ? 1.0 + t * 0.6 : 1.0
        imag[k]        = (1 / Math.pow(k, 1.4 - t * 0.45)) * oddBoost
      }
      break
    }

    case 'brass': {
      // Mellow horn (frame 0) → bright trumpet (frame 63)
      for (let k = 1; k <= NUM_HARMONICS; k++) {
        const evenBoost = k % 2 === 0 ? 1.0 + t * 2.0 : 1.0
        imag[k]         = (1 / Math.pow(k, 1.8 - t * 1.1)) * evenBoost
      }
      break
    }

    default: {
      // 'custom' — sawtooth as sensible starting point
      for (let k = 1; k <= NUM_HARMONICS; k++) {
        imag[k] = (2 / Math.PI) * (k % 2 === 1 ? 1 : -1) / k
      }
    }
  }

  // Normalize peak to 1.0
  let maxAmp = 0
  for (let k = 1; k <= NUM_HARMONICS; k++) {
    const a = Math.hypot(real[k], imag[k])
    if (a > maxAmp) maxAmp = a
  }
  if (maxAmp > 0) {
    for (let k = 1; k <= NUM_HARMONICS; k++) { real[k] /= maxAmp; imag[k] /= maxAmp }
  }

  return { real, imag }
}

// ── Wavetable generation (for display / export) ────────────────────────────────

/**
 * Generate the full 64-frame wavetable as a flat Float32Array of 64 × 2048 samples.
 * Each group of 2048 samples is one waveform cycle.
 * Uses trig recurrence for efficiency (avoids sin/cos calls in inner loop).
 */
export function generateWavetable(type: WavetablePatch['oscAWavetable']): Float32Array {
  const table = new Float32Array(WAVETABLE_FRAMES * FRAME_SIZE)

  for (let f = 0; f < WAVETABLE_FRAMES; f++) {
    const { real, imag } = getFrameCoefficients(type, f)
    const base = f * FRAME_SIZE
    const frame = table.subarray(base, base + FRAME_SIZE)

    // Additive synthesis via trig recurrence — O(H * N) without any trig in inner loop
    for (let k = 1; k < real.length; k++) {
      const re = real[k]; const im = imag[k]
      if (re === 0 && im === 0) continue
      const angle = (2 * Math.PI * k) / FRAME_SIZE
      const cosStep = Math.cos(angle)
      const sinStep = Math.sin(angle)
      let cosN = 1, sinN = 0     // cos(k*0*dθ) = 1, sin(k*0*dθ) = 0
      for (let n = 0; n < FRAME_SIZE; n++) {
        frame[n] += re * cosN - im * sinN
        const nc = cosN * cosStep - sinN * sinStep
        const ns = sinN * cosStep + cosN * sinStep
        cosN = nc; sinN = ns
      }
    }

    // Normalize frame to ±1
    let max = 0
    for (let n = 0; n < FRAME_SIZE; n++) { const a = Math.abs(frame[n]); if (a > max) max = a }
    if (max > 0) for (let n = 0; n < FRAME_SIZE; n++) frame[n] /= max
  }

  return table
}

// ── ADSR helper ────────────────────────────────────────────────────────────────

interface ADSRHandle {
  /** Call on note-off. Returns the absolute time when the tail finishes. */
  release(now: number): number
}

function scheduleADSR(
  param: AudioParam,
  attack: number, decay: number, sustain: number, release: number,
  peakLevel: number,
  startTime: number,
): ADSRHandle {
  const a = Math.max(0.001, attack)
  const d = Math.max(0.001, decay)
  const r = Math.max(0.001, release)

  param.setValueAtTime(0.0001, startTime)
  param.linearRampToValueAtTime(peakLevel, startTime + a)
  param.linearRampToValueAtTime(peakLevel * sustain, startTime + a + d)

  return {
    release(now: number): number {
      const elapsed = now - startTime
      let curVal: number
      if (elapsed <= 0) {
        curVal = 0.0001
      } else if (elapsed < a) {
        curVal = peakLevel * (elapsed / a)
      } else if (elapsed < a + d) {
        const dp = (elapsed - a) / d
        curVal = peakLevel * (1 - dp * (1 - sustain))
      } else {
        curVal = peakLevel * sustain
      }
      param.cancelScheduledValues(now)
      param.setValueAtTime(Math.max(0.0001, curVal), now)
      param.linearRampToValueAtTime(0.0001, now + r)
      return now + r + 0.02
    },
  }
}

// ── Note playback ──────────────────────────────────────────────────────────────

/**
 * Play a note using the wavetable patch.  Returns a stop function that triggers
 * the release phase.  Call immediately (no delay) to hard-stop.
 */
export function playWavetableNote(
  ctx: AudioContext,
  patch: WavetablePatch,
  midiNote: number,
  velocity: number,          // 0–1
  startTime: number,
  destination: AudioNode = ctx.destination,
): () => void {
  const hz       = midiToHz(clamp(midiNote, 21, 108))
  const velScale = clamp(velocity, 0, 1)
  const t0       = startTime

  // ── Signal chain ──────────────────────────────────────────────────────────
  // oscA/B → oscGain → ampGain → filter → panner → masterGain → destination

  const masterGain = ctx.createGain()
  masterGain.gain.value = patch.masterGain * velScale
  masterGain.connect(destination)

  const panner = ctx.createStereoPanner()
  panner.connect(masterGain)

  const filter = ctx.createBiquadFilter()
  filter.type             = patch.filterType
  filter.frequency.value  = patch.filterCutoff
  filter.Q.value          = patch.filterResonance
  filter.connect(panner)

  const ampGain = ctx.createGain()
  ampGain.connect(filter)

  // ── Amplitude ADSR ─────────────────────────────────────────────────────────
  const ampEnv = scheduleADSR(
    ampGain.gain,
    patch.attack, patch.decay, patch.sustain, patch.release,
    1.0, t0,
  )

  // ── Filter ADSR ────────────────────────────────────────────────────────────
  const fc0    = patch.filterCutoff
  const fcPeak = patch.filterType === 'lowpass'
    ? clamp(fc0 + patch.filterEnvAmount * (20000 - fc0), 20, 20000)
    : clamp(fc0 + patch.filterEnvAmount * (fc0 - 20),    20, 20000)

  const fEnv = scheduleADSR(
    filter.frequency,
    patch.fAttack, patch.fDecay, patch.fSustain, patch.fRelease,
    fcPeak, t0,
  )
  // The filter env starts from the base cutoff, so override the 0→peak ramp:
  filter.frequency.cancelScheduledValues(t0)
  filter.frequency.setValueAtTime(fc0, t0)
  filter.frequency.linearRampToValueAtTime(fcPeak, t0 + Math.max(0.001, patch.fAttack))
  filter.frequency.linearRampToValueAtTime(
    fc0 + (fcPeak - fc0) * patch.fSustain,
    t0 + patch.fAttack + Math.max(0.001, patch.fDecay),
  )

  // ── LFO ────────────────────────────────────────────────────────────────────
  const lfo = ctx.createOscillator()
  lfo.type             = patch.lfoShape
  lfo.frequency.value  = patch.lfoRate

  const lfoGain = ctx.createGain()
  lfo.connect(lfoGain)

  if (patch.lfoTarget === 'pitch') {
    lfoGain.gain.value = patch.lfoDepth * 150   // ±150 cents max
  } else if (patch.lfoTarget === 'filter') {
    lfoGain.gain.value = patch.lfoDepth * fc0 * 0.6
    lfoGain.connect(filter.frequency)
  } else if (patch.lfoTarget === 'pan') {
    lfoGain.gain.value = patch.lfoDepth
    lfoGain.connect(panner.pan)
  }

  // ── Oscillators ────────────────────────────────────────────────────────────
  const oscillators: OscillatorNode[] = []

  function makeOsc(
    wtType: WavetablePatch['oscAWavetable'],
    position: number,
    detuneSemitones: number,
    gain: number,
  ): void {
    const frameIdx = Math.round(clamp(position, 0, 1) * (WAVETABLE_FRAMES - 1))
    const { real, imag } = getFrameCoefficients(wtType, frameIdx)
    const wave = ctx.createPeriodicWave(real, imag, { disableNormalization: false })

    const osc = ctx.createOscillator()
    osc.setPeriodicWave(wave)
    osc.frequency.value = hz * Math.pow(2, detuneSemitones / 12)

    if (patch.lfoTarget === 'pitch') {
      lfoGain.connect(osc.detune)
    }

    const og = ctx.createGain()
    og.gain.value = gain
    osc.connect(og)
    og.connect(ampGain)

    osc.start(t0)
    oscillators.push(osc)
  }

  makeOsc(patch.oscAWavetable, patch.oscAPosition, patch.oscADetune, patch.oscAGain)
  makeOsc(patch.oscBWavetable, patch.oscBPosition, patch.oscBDetune, patch.oscBGain)

  lfo.start(t0)

  // ── Stop function ──────────────────────────────────────────────────────────
  return () => {
    const now    = ctx.currentTime
    const ampEnd = ampEnv.release(now)
    const fcNow  = filter.frequency.value
    filter.frequency.cancelScheduledValues(now)
    filter.frequency.setValueAtTime(fcNow, now)
    filter.frequency.linearRampToValueAtTime(fc0, now + Math.max(0.001, patch.fRelease))
    fEnv.release(now)   // use the computed release for fEnv even if we already handled it

    const tail = Math.max(ampEnd, now + patch.fRelease) + 0.05
    oscillators.forEach(o => o.stop(tail))
    lfo.stop(tail)
  }
}
