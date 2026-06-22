/**
 * 4-operator FM synthesizer engine for BeatLab.
 *
 * Inspired by the Yamaha DX7.  8 operator-routing algorithms using Web Audio
 * OscillatorNodes connected via GainNodes for frequency-modulation.
 */

// ── Types ──────────────────────────────────────────────────────────────────────

export interface FMOperator {
  ratio:    number   // frequency multiplier (0.5, 1, 2, 3, 4 …)
  level:    number   // output level 0–1
  attack:   number   // 0–5 s
  decay:    number   // 0–5 s
  sustain:  number   // 0–1
  release:  number   // 0–5 s
  detune:   number   // cents (-100 … +100)
  feedback: number   // self-modulation 0–1 (honoured on operator 0 only)
}

export type FMAlgorithm = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8

/** Operator indices are 0-based (operators 1–4 ⟺ indices 0–3). */
interface AlgorithmDef {
  name:      string
  carriers:  number[]                             // operator indices that go to audio out
  modulators: Array<{ from: number; to: number }> // modulation routing
}

// ── Algorithm definitions ──────────────────────────────────────────────────────

export const FM_ALGORITHMS: Record<FMAlgorithm, AlgorithmDef> = {
  // Full series chain: 1→2→3→4 (4 is carrier)
  1: {
    name: 'Series Chain',
    carriers: [3],
    modulators: [{ from: 0, to: 1 }, { from: 1, to: 2 }, { from: 2, to: 3 }],
  },
  // Two branches into one carrier: (1→2), (3→4), but also 2→4
  2: {
    name: 'Y Branch',
    carriers: [3],
    modulators: [{ from: 0, to: 1 }, { from: 1, to: 3 }, { from: 2, to: 3 }],
  },
  // Two parallel stacks: (1→2), (3→4) both carriers
  3: {
    name: 'Twin Stack',
    carriers: [1, 3],
    modulators: [{ from: 0, to: 1 }, { from: 2, to: 3 }],
  },
  // Cascade + free carrier: 1→2→3, 4 free carrier
  4: {
    name: 'Cascade + Free',
    carriers: [2, 3],
    modulators: [{ from: 0, to: 1 }, { from: 1, to: 2 }],
  },
  // Fan-out: 1 modulates 2, 3, and 4 (1 is the only modulator)
  5: {
    name: 'Fan-out',
    carriers: [1, 2, 3],
    modulators: [{ from: 0, to: 1 }, { from: 0, to: 2 }, { from: 0, to: 3 }],
  },
  // Full series + direct skip: 1→2→3→4 + 1→4
  6: {
    name: 'Series + Skip',
    carriers: [3],
    modulators: [
      { from: 0, to: 1 }, { from: 1, to: 2 }, { from: 2, to: 3 }, { from: 0, to: 3 },
    ],
  },
  // Three modulators → one carrier: 1→4, 2→4, 3→4
  7: {
    name: 'Triple Mod',
    carriers: [3],
    modulators: [{ from: 0, to: 3 }, { from: 1, to: 3 }, { from: 2, to: 3 }],
  },
  // All carriers — additive synthesis
  8: {
    name: 'Additive',
    carriers: [0, 1, 2, 3],
    modulators: [],
  },
}

// ── Patch type ─────────────────────────────────────────────────────────────────

export interface FMPatch {
  operators:    [FMOperator, FMOperator, FMOperator, FMOperator]
  algorithm:    FMAlgorithm
  masterGain:   number    // 0–1
  pitchEgRate:  number    // global pitch-envelope rate (0 = off)
  name:         string
}

// ── Built-in presets ───────────────────────────────────────────────────────────

function defOp(ratio: number, level: number, a: number, d: number, s: number, r: number, feedback = 0, detune = 0): FMOperator {
  return { ratio, level, attack: a, decay: d, sustain: s, release: r, feedback, detune }
}

export const FM_PRESETS: Record<string, FMPatch> = {
  'Electric Piano 1': {
    name: 'Electric Piano 1', algorithm: 3, masterGain: 0.65, pitchEgRate: 0,
    operators: [
      defOp(14, 0.28, 0.001, 0.55, 0.0, 0.5, 0.55),  // bright modulator
      defOp(1,  0.90, 0.001, 2.5,  0.6, 0.6),          // carrier
      defOp(14, 0.22, 0.001, 0.45, 0.0, 0.4),          // second modulator
      defOp(1,  0.80, 0.001, 2.0,  0.55, 0.55),        // second carrier
    ],
  },
  Brass: {
    name: 'Brass', algorithm: 2, masterGain: 0.7, pitchEgRate: 0,
    operators: [
      defOp(1,  0.65, 0.05, 0.15, 0.70, 0.2, 0.4),
      defOp(2,  0.50, 0.04, 0.20, 0.60, 0.2),
      defOp(1,  0.40, 0.04, 0.12, 0.55, 0.2),
      defOp(1,  0.85, 0.05, 0.10, 0.80, 0.25),
    ],
  },
  Bass: {
    name: 'Bass', algorithm: 1, masterGain: 0.75, pitchEgRate: 0,
    operators: [
      defOp(3,   0.55, 0.001, 0.18, 0.0, 0.15, 0.35),
      defOp(0.5, 0.35, 0.001, 0.30, 0.1, 0.18),
      defOp(1,   0.20, 0.001, 0.12, 0.0, 0.12),
      defOp(1,   0.85, 0.003, 0.35, 0.5, 0.22),
    ],
  },
  Bell: {
    name: 'Bell', algorithm: 7, masterGain: 0.6, pitchEgRate: 0,
    operators: [
      defOp(3.5, 0.45, 0.001, 0.3,  0.0, 0.5),
      defOp(5,   0.35, 0.001, 0.4,  0.0, 0.6),
      defOp(7,   0.25, 0.001, 0.25, 0.0, 0.4),
      defOp(1,   0.80, 0.001, 2.8,  0.0, 1.5),
    ],
  },
  Marimba: {
    name: 'Marimba', algorithm: 3, masterGain: 0.65, pitchEgRate: 0,
    operators: [
      defOp(3, 0.55, 0.001, 0.08, 0.0, 0.25),
      defOp(1, 0.85, 0.001, 0.9,  0.0, 0.35),
      defOp(4, 0.35, 0.001, 0.06, 0.0, 0.20),
      defOp(2, 0.70, 0.001, 0.65, 0.0, 0.30),
    ],
  },
  Organ: {
    name: 'Organ', algorithm: 8, masterGain: 0.6, pitchEgRate: 0,
    operators: [
      defOp(1, 0.75, 0.01, 0.02, 1.0, 0.05),
      defOp(2, 0.55, 0.01, 0.02, 1.0, 0.05),
      defOp(3, 0.35, 0.01, 0.02, 1.0, 0.05),
      defOp(4, 0.20, 0.01, 0.02, 1.0, 0.05),
    ],
  },
  Strings: {
    name: 'Strings', algorithm: 3, masterGain: 0.6, pitchEgRate: 0,
    operators: [
      defOp(1, 0.20, 0.3, 0.5, 0.5, 0.8, 0, -8),
      defOp(1, 0.80, 0.3, 0.6, 0.7, 1.0, 0, -8),
      defOp(1, 0.20, 0.3, 0.5, 0.5, 0.8, 0,  8),
      defOp(1, 0.75, 0.3, 0.6, 0.7, 1.0, 0,  8),
    ],
  },
  'Synth Lead': {
    name: 'Synth Lead', algorithm: 1, masterGain: 0.7, pitchEgRate: 0,
    operators: [
      defOp(2, 0.80, 0.001, 0.3,  0.0, 0.2, 0.6),
      defOp(1, 0.60, 0.001, 0.25, 0.2, 0.2),
      defOp(3, 0.40, 0.001, 0.2,  0.1, 0.15),
      defOp(1, 0.85, 0.008, 0.15, 0.65, 0.3),
    ],
  },
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function midiToHz(note: number): number {
  return 440 * Math.pow(2, (note - 69) / 12)
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

// ── ADSR helper ────────────────────────────────────────────────────────────────

interface ADSRHandle { release(now: number): number }

function scheduleADSR(
  param: AudioParam,
  attack: number, decay: number, sustain: number, release: number,
  peakLevel: number, startTime: number,
): ADSRHandle {
  const a = Math.max(0.001, attack)
  const d = Math.max(0.001, decay)
  const r = Math.max(0.001, release)

  param.setValueAtTime(0.0001, startTime)
  param.linearRampToValueAtTime(peakLevel, startTime + a)
  param.linearRampToValueAtTime(peakLevel * sustain, startTime + a + d)

  return {
    release(now: number): number {
      const el = now - startTime
      let cur: number
      if (el <= 0)         cur = 0.0001
      else if (el < a)     cur = peakLevel * (el / a)
      else if (el < a + d) cur = peakLevel * (1 - ((el - a) / d) * (1 - sustain))
      else                 cur = peakLevel * sustain

      param.cancelScheduledValues(now)
      param.setValueAtTime(Math.max(0.0001, cur), now)
      param.linearRampToValueAtTime(0.0001, now + r)
      return now + r + 0.02
    },
  }
}

// ── Note playback ──────────────────────────────────────────────────────────────

/**
 * Play a note using FM synthesis.  Returns a stop function that triggers the
 * release phase.  Call the returned function on note-off.
 */
export function playFMNote(
  ctx: AudioContext,
  patch: FMPatch,
  midiNote: number,
  velocity: number,        // 0–1
  startTime: number,
  destination: AudioNode = ctx.destination,
): () => void {
  const noteHz    = midiToHz(clamp(midiNote, 21, 108))
  const velScale  = clamp(velocity, 0, 1)
  const t0        = startTime
  const algo      = FM_ALGORITHMS[patch.algorithm]
  const ops       = patch.operators

  const masterGain = ctx.createGain()
  masterGain.gain.value = patch.masterGain * velScale
  masterGain.connect(destination)

  // Build one audio graph node-set per operator
  const oscillators: OscillatorNode[] = []
  const envGains:    GainNode[]       = []   // ADSR gain
  const envHandles:  ADSRHandle[]     = []

  for (let i = 0; i < 4; i++) {
    const op = ops[i]
    const osc = ctx.createOscillator()
    osc.type             = 'sine'
    osc.frequency.value  = noteHz * op.ratio
    osc.detune.value     = op.detune

    const envGain = ctx.createGain()
    osc.connect(envGain)

    oscillators.push(osc)
    envGains.push(envGain)

    // Determine peak gain
    const isCarrier = algo.carriers.includes(i)
    const peakGain  = isCarrier
      ? op.level                             // carrier = volume level
      : op.level * noteHz * op.ratio * 3.5  // modulator = FM depth in Hz

    const handle = scheduleADSR(
      envGain.gain,
      op.attack, op.decay, op.sustain, op.release,
      peakGain, t0,
    )
    envHandles.push(handle)
  }

  // Wire modulators → target.frequency
  for (const { from, to } of algo.modulators) {
    envGains[from].connect(oscillators[to].frequency)
  }

  // Wire carriers → master output
  for (const ci of algo.carriers) {
    envGains[ci].connect(masterGain)
  }

  // Operator-0 self-feedback via a short delay (safe clamped level)
  let fbDelay: DelayNode | null       = null
  let fbGain:  GainNode | null        = null
  const fbAmount = ops[0].feedback
  if (fbAmount > 0.01) {
    fbDelay = ctx.createDelay(0.025)
    fbDelay.delayTime.value = 2 / ctx.sampleRate  // 2 samples
    fbGain = ctx.createGain()
    // Keep the feedback gain small enough to avoid instability
    fbGain.gain.value = clamp(fbAmount, 0, 0.95) * noteHz * ops[0].ratio * 1.5
    envGains[0].connect(fbDelay)
    fbDelay.connect(fbGain)
    fbGain.connect(oscillators[0].frequency)
  }

  // Start all oscillators
  oscillators.forEach(o => o.start(t0))

  // Return stop function
  return () => {
    const now  = ctx.currentTime
    let tail   = now + 0.05
    for (const h of envHandles) {
      const end = h.release(now)
      if (end > tail) tail = end
    }
    oscillators.forEach(o => o.stop(tail))
    if (fbDelay) fbDelay.disconnect()
    if (fbGain)  fbGain.disconnect()
  }
}
