// Combine two samples into one.
//
// Layering two sounds is one of the oldest ways to make a new one — a piano
// under a pad, a click on the front of a bass, a hit that becomes a texture.
// Apollo can already play two samples on two oscillators, but that is two
// voices with two sets of controls; this makes ONE sample, so everything
// downstream (filters, envelopes, the multisample mapping, a wavetable built
// from it) treats it as a single sound.
//
// Pure buffer maths, deliberately: it takes and returns AudioBuffers and knows
// nothing about the library, the engine or React, so it is the same function
// for standalone Apollo and for the card hosted in Beacon — and it can be
// checked by measuring its output.

export type CombineMode = 'layer' | 'sequence' | 'crossfade'

export interface CombineOptions {
  mode: CombineMode
  /** 0 = only A, 1 = only B, 0.5 = equal. An equal-power law, so a centred
   *  blend does not dip in the middle the way a linear one does. */
  balance?: number
  /** layer: where B starts, in seconds. sequence: gap between them (negative
   *  overlaps). crossfade: length of the fade. */
  offsetSec?: number
  /** Scale the result so its peak just fits. Summing two samples routinely
   *  exceeds full scale, and a clipped combine is not a usable sample. */
  normalize?: boolean
}

export interface CombineResult {
  buffer: AudioBuffer
  /** Peak before any normalising — how much headroom the sum actually needed. */
  peak: number
  /** Gain applied by normalising (1 when it was already safe or disabled). */
  gain: number
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

/** Read channel `c` of a buffer, folding mono up so a mono + stereo pair
 *  combines without one side going silent. */
function chan(buf: AudioBuffer, c: number): Float32Array {
  return buf.getChannelData(Math.min(c, buf.numberOfChannels - 1))
}

export function combineBuffers(
  ctx: BaseAudioContext,
  a: AudioBuffer,
  b: AudioBuffer,
  opts: CombineOptions,
): CombineResult {
  const balance = clamp01(opts.balance ?? 0.5)
  // Equal power: two half-gain copies summed are quieter than either alone
  // under a linear law, which reads as the middle of the blend being wrong.
  const gA = Math.cos(balance * Math.PI / 2)
  const gB = Math.sin(balance * Math.PI / 2)
  const sr = ctx.sampleRate
  const offset = opts.offsetSec ?? 0
  const channels = Math.max(a.numberOfChannels, b.numberOfChannels)

  let length: number
  let bStart: number      // where B begins, in samples
  let fadeLen = 0         // crossfade length, in samples

  if (opts.mode === 'sequence') {
    // A, then B. A negative offset overlaps them.
    bStart = Math.max(0, Math.round(a.length + offset * sr))
    length = Math.max(a.length, bStart + b.length)
  } else if (opts.mode === 'crossfade') {
    fadeLen = Math.max(1, Math.round(Math.abs(offset || 0.25) * sr))
    fadeLen = Math.min(fadeLen, a.length, b.length)
    bStart = Math.max(0, a.length - fadeLen)
    length = bStart + b.length
  } else {
    bStart = Math.max(0, Math.round(offset * sr))
    length = Math.max(a.length, bStart + b.length)
  }
  length = Math.max(1, length)

  const out = ctx.createBuffer(channels, length, sr)
  let peak = 0

  for (let c = 0; c < channels; c++) {
    const src = out.getChannelData(c)
    const av = chan(a, c)
    const bv = chan(b, c)

    for (let i = 0; i < a.length && i < length; i++) {
      let v = av[i] * gA
      if (opts.mode === 'crossfade' && i >= bStart) {
        // Equal-power fade OUT across the overlap.
        const t = clamp01((i - bStart) / fadeLen)
        v = av[i] * gA * Math.cos(t * Math.PI / 2)
      }
      src[i] = v
    }
    for (let i = 0; i < b.length; i++) {
      const o = bStart + i
      if (o >= length) break
      let v = bv[i] * gB
      if (opts.mode === 'crossfade' && i < fadeLen) {
        const t = clamp01(i / fadeLen)
        v = bv[i] * gB * Math.sin(t * Math.PI / 2)
      }
      src[o] += v
    }
    for (let i = 0; i < length; i++) {
      const m = Math.abs(src[i])
      if (m > peak) peak = m
    }
  }

  let gain = 1
  if (opts.normalize !== false && peak > 0.99) {
    gain = 0.99 / peak
    for (let c = 0; c < channels; c++) {
      const src = out.getChannelData(c)
      for (let i = 0; i < length; i++) src[i] *= gain
    }
  }
  return { buffer: out, peak, gain }
}

/** A readable name for the result, so the library does not fill up with
 *  "user_lx9f2" entries nobody can identify later. */
export function combinedName(nameA: string, nameB: string, mode: CombineMode): string {
  const join = mode === 'sequence' ? '→' : mode === 'crossfade' ? '~' : '+'
  const trim = (s: string) => s.replace(/\.[^.]+$/, '').slice(0, 22)
  return `${trim(nameA)} ${join} ${trim(nameB)}`
}
