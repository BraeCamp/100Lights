/**
 * Make room for another track, only where it is actually in the way.
 *
 * Brae: "Can we add a way to have one track respond to the eq spikes of another
 * track?"
 *
 * An ordinary sidechain ducks the WHOLE track whenever the other one plays. That
 * is right for a kick and a bass, and wrong for almost everything else: a pad
 * ducking under a vocal loses its top and its bottom too, when the only thing
 * that was ever clashing is the band the voice sits in. What you want is for the
 * pad to step aside at 400Hz for exactly as long as the voice is at 400Hz, and
 * to carry on everywhere else — which is what mixing engineers do by hand with a
 * dynamic EQ, and what plugins call unmasking.
 *
 * So: split BOTH signals into the same bands, follow the key's envelope band by
 * band, and duck each band of the target by its own amount.
 *
 *   target ─┬─ band 1 ─ VCA₁ ─┬─ out
 *           ├─ band 2 ─ VCA₂ ─┤
 *           ├─ band 3 ─ VCA₃ ─┤
 *           └─ band 4 ─ VCA₄ ─┘
 *                        ↑ gain
 *   key ────┬─ band 1 ─ follower₁ ─ ×(−amount) ┘
 *           └─ … the same split, so band n listens to band n
 *
 * Four bands, fixed. More would track the key more precisely and cost a filter
 * pair each; four is enough to separate "boom", "body", "presence" and "air",
 * which is the vocabulary the problem is actually described in. The bands are
 * simple 12dB slices rather than a linear-phase crossover: they do not sum
 * perfectly flat, but this is a ducking effect, and being a fraction of a dB
 * off between bands is inaudible next to the ducking itself.
 *
 * Nothing here is a worklet, so it costs no main-thread time — which matters,
 * because everything else in this studio that touches audio does.
 */

import { createEnvelopeFollower } from './sidechain'

/** Band edges in Hz. Below the first and above the last are the outer bands. */
const EDGES = [200, 800, 3000]

export interface SpectralDuckOptions {
  /** How deep the duck goes at full key level, 0..1. */
  amount?: number
  /** How fast a band steps aside, seconds. */
  attack?: number
  /** How long it stays out of the way after the key stops, seconds. */
  release?: number
  /** Sensitivity, dB. Lower = quieter key material still triggers it. */
  threshold?: number
  /**
   * Weight per band, 0..1, low → high. Lets one band be spared entirely —
   * a bass that should duck in the mids but never lose its bottom.
   */
  weights?: [number, number, number, number]
}

export function createSpectralDucker(ctx: BaseAudioContext, opts: SpectralDuckOptions = {}): {
  keyInput: AudioNode
  signalIn: AudioNode
  signalOut: AudioNode
  /** Update without rebuilding the graph. */
  setAmount(v: number): void
  setWeights(w: [number, number, number, number]): void
} {
  const amount = Math.min(1, Math.max(0, opts.amount ?? 0.6))
  const weights = opts.weights ?? [1, 1, 1, 1]

  const signalIn = ctx.createGain()
  const signalOut = ctx.createGain()
  const keyInput = ctx.createGain()

  /** One 12dB slice of the spectrum. Outer bands use a single filter. */
  const slice = (src: AudioNode, i: number): AudioNode => {
    let node: AudioNode = src
    if (i > 0) {
      const hp = ctx.createBiquadFilter()
      hp.type = 'highpass'
      hp.frequency.value = EDGES[i - 1]
      hp.Q.value = 0.707
      node.connect(hp); node = hp
    }
    if (i < EDGES.length) {
      const lp = ctx.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.value = EDGES[i]
      lp.Q.value = 0.707
      node.connect(lp); node = lp
    }
    return node
  }

  const scalers: GainNode[] = []

  for (let i = 0; i < EDGES.length + 1; i++) {
    // The target's band, through a VCA that sits at unity until the key pushes
    // it down. AudioParam is additive, so gain = 1 + (−depth · envelope).
    const vca = ctx.createGain()
    vca.gain.value = 1
    slice(signalIn, i).connect(vca)
    vca.connect(signalOut)

    // The key's SAME band, followed, inverted, and wired into that VCA's gain.
    const follower = createEnvelopeFollower(ctx, {
      threshold: opts.threshold ?? -30,
      attack: opts.attack ?? 0.008,
      release: opts.release ?? 0.18,
    })
    slice(keyInput, i).connect(follower.input)

    const scaler = ctx.createGain()
    scaler.gain.value = -amount * (weights[i] ?? 1)
    follower.envelope.connect(scaler)
    scaler.connect(vca.gain)
    scalers.push(scaler)
  }

  return {
    keyInput,
    signalIn,
    signalOut,
    setAmount(v) {
      const a = Math.min(1, Math.max(0, v))
      scalers.forEach((s, i) => { s.gain.value = -a * (weights[i] ?? 1) })
    },
    setWeights(w) {
      for (let i = 0; i < scalers.length; i++) {
        weights[i] = Math.min(1, Math.max(0, w[i] ?? 1))
        scalers[i].gain.value = -amount * weights[i]
      }
    },
  }
}

/** Human labels for the four bands, for anything that shows them. */
export const DUCK_BANDS = ['Low', 'Body', 'Presence', 'Air'] as const
