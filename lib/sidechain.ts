/**
 * Sidechain compressor via envelope follower + VCA gain control.
 *
 * Because Web Audio's DynamicsCompressor has no sidechain key input, ducking is
 * implemented with an analog-style envelope follower:
 *
 *   keyInput → rectifier (abs) → boost+clip → attack LPF → release LPF
 *            → envScaler (−duckAmount) → vca.gain  (additive modulation on base=1)
 *
 *   signalIn → VCA (GainNode) → signalOut
 *
 * When the key input is silent, vca.gain = 1 (no ducking).
 * When the key input peaks, vca.gain → 1 − duckAmount.
 * duckAmount is derived from ratio: 1 − 1/ratio  (ratio 4 → 75% duck).
 *
 * Attack speed  ~ 1/(2π·attack_s)  cutoff on the first LP.
 * Release speed ~ 1/(2π·release_s) cutoff on the second (slower) LP; this LP
 * "holds" the envelope after the key signal drops, giving a musical tail.
 *
 * Sensitivity is driven by threshold (dB): lower threshold = higher boost,
 * so quieter sources still trigger a full duck.
 */
export function createSidechainProcessor(
  ctx: AudioContext,
  params: { threshold: number; ratio: number; attack: number; release: number }
): {
  keyInput: AudioNode   // connect the trigger lane's input here
  signalIn: AudioNode   // connect the target lane signal here
  signalOut: AudioNode  // output — connect to the rest of the FX chain
} {
  // ── Full-wave rectifier: maps any audio signal to 0..1 ──────────────────
  const rectCurve = new Float32Array(4096)
  for (let i = 0; i < 4096; i++) {
    const x = (i / 2047.5) - 1   // -1..+1
    rectCurve[i] = Math.abs(x)
  }
  const rect = ctx.createWaveShaper()
  rect.curve = rectCurve
  rect.oversample = '2x'

  // ── Boost + clip: drives envelope to 1 for any signal above threshold ────
  // Lower threshold (more negative dB) → higher boost → more sensitive.
  const threshLin  = Math.pow(10, (params.threshold ?? -24) / 20)  // e.g. -24 dB → 0.063
  const boost      = Math.min(40, Math.max(2, 0.5 / Math.max(0.005, threshLin)))
  const boostCurve = new Float32Array(4096)
  for (let i = 0; i < 4096; i++) {
    const x = (i / 2047.5) - 1
    boostCurve[i] = Math.min(1, Math.abs(x) * boost)
  }
  const boostShape = ctx.createWaveShaper()
  boostShape.curve = boostCurve
  boostShape.oversample = '2x'

  // ── Attack LPF: controls how fast the duck engages ──────────────────────
  const attackSec    = Math.max(0.001, params.attack ?? 0.003)
  const attackCutoff = Math.min(500, Math.max(5, 1 / (2 * Math.PI * attackSec)))
  const attackLPF    = ctx.createBiquadFilter()
  attackLPF.type            = 'lowpass'
  attackLPF.frequency.value = attackCutoff
  attackLPF.Q.value         = 0.5

  // ── Release LPF: controls how long the duck holds after key drops ────────
  // Slower cutoff → envelope "hangs" longer → longer release tail.
  const releaseSec    = Math.max(0.01, params.release ?? 0.25)
  const releaseCutoff = Math.min(200, Math.max(0.5, 1 / (2 * Math.PI * releaseSec)))
  const releaseLPF    = ctx.createBiquadFilter()
  releaseLPF.type            = 'lowpass'
  releaseLPF.frequency.value = releaseCutoff
  releaseLPF.Q.value         = 0.5

  // ── Duck depth from ratio ────────────────────────────────────────────────
  // ratio 1 → 0 %  ratio 4 → 75 %  ratio 20 → 95 %
  const duckAmount = Math.min(0.95, 1 - 1 / Math.max(1.1, params.ratio ?? 4))

  // ── VCA: base gain 1, modulated by envelope * -duckAmount ───────────────
  // Web Audio AudioParam is additive: finalGain = .value + sum(connections)
  // Result: gain = 1 + (−duckAmount · envelope)
  const vca = ctx.createGain()
  vca.gain.value = 1

  const envScaler = ctx.createGain()
  envScaler.gain.value = -duckAmount   // inverts and scales the envelope

  // ── Connect key input path ───────────────────────────────────────────────
  const keyIn = ctx.createGain()
  keyIn.gain.value = 1
  keyIn.connect(rect)
  rect.connect(boostShape)
  boostShape.connect(attackLPF)
  attackLPF.connect(releaseLPF)
  releaseLPF.connect(envScaler)
  envScaler.connect(vca.gain)    // audio-rate modulation of VCA gain

  // ── Connect signal path ──────────────────────────────────────────────────
  const signalIn  = ctx.createGain()
  const signalOut = ctx.createGain()
  signalIn.connect(vca)
  vca.connect(signalOut)

  return { keyInput: keyIn, signalIn, signalOut }
}
