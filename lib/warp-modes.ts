// The warp modes that are not a plain stretch: Beats and Texture.
//
// Live has six ways to fit a sample to the grid, and they are different
// ideas, not different qualities of one idea. Re-Pitch resamples (speed
// and pitch together). Complex and Tones stretch and keep the pitch
// (WSOLA, lib/wsola.ts — Tones with a larger grain). BEATS does not
// stretch at all: it cuts the span at its transients (or at grid
// divisions), puts each slice where its beat lands, and plays it at the
// speed it was recorded — a slice that is too long for its slot is cut
// short, one that is too short leaves a gap that the Transient Loop Mode
// fills (Off: silence, with the Transient Envelope fading the slice out;
// Forward: the slice repeats; Back-and-Forth: it ping-pongs). TEXTURE is
// granular: grains of a set size read from the sample at the warped rate,
// overlapped, with Flux jittering where each grain is read from — the
// smear that suits pads and noise. Pure over buffer-shaped objects, seeded
// where anything is random (a render must be the same on every machine).

import { rngFor } from './seeded-random'

export type WarpModeName = 'repitch' | 'stretch' | 'tones' | 'beats' | 'texture'

export interface BeatsParams {
  /** Cut at the detected transients, or every so many beats of the grid. */
  preserve: 'transients' | number
  loop: 'off' | 'forward' | 'backforth'
  /** 0–100: how much of each slice survives before a fade when a gap follows. 100 = no fade. */
  envelope: number
}
export interface TonesParams { grainMs: number }
export interface TextureParams { grainMs: number; flux: number }

export const DEFAULT_BEATS: BeatsParams = { preserve: 'transients', loop: 'off', envelope: 100 }
export const DEFAULT_TONES: TonesParams = { grainMs: 100 }
export const DEFAULT_TEXTURE: TextureParams = { grainMs: 60, flux: 0.2 }

export const WARP_MODE_LABEL: Record<WarpModeName, string> = { repitch: 'Re-Pitch', stretch: 'Complex', tones: 'Tones', beats: 'Beats', texture: 'Texture' }

/**
 * Beats: the source frames [from, to) rendered into `outFrames` frames at
 * `out[at..]`, sliced at `cutFrames` (source frames strictly inside the span),
 * each slice placed where its start lands and played as recorded.
 */
export function beatsSpan(
  src: Float32Array, from: number, to: number, outFrames: number, out: Float32Array, at: number,
  cutFrames: number[], p: BeatsParams, sampleRate: number,
): void {
  const n = to - from
  if (n <= 0 || outFrames <= 0) return
  const scale = outFrames / n
  const edges = [from, ...cutFrames.filter(c => c > from + 1 && c < to - 1).sort((a, b) => a - b), to]
  const fadeFrames = Math.max(8, Math.round(sampleRate * 0.002))
  for (let k = 0; k < edges.length - 1; k++) {
    const s0 = edges[k], s1 = edges[k + 1]
    const segLen = s1 - s0
    const slot0 = at + Math.round((s0 - from) * scale)
    const slot1 = k === edges.length - 2 ? at + outFrames : at + Math.round((s1 - from) * scale)
    const slotLen = slot1 - slot0
    if (slotLen <= 0) continue
    if (segLen >= slotLen) {
      // Too long for its slot: play what fits, and fade the last 2 ms.
      for (let i = 0; i < slotLen; i++) {
        const g = i > slotLen - fadeFrames ? (slotLen - i) / fadeFrames : 1
        out[slot0 + i] = src[s0 + i] * g
      }
      continue
    }
    // Shorter than its slot: the slice, then the gap.
    const keep = Math.max(0, Math.min(100, p.envelope)) / 100
    for (let i = 0; i < segLen; i++) {
      // Transient Envelope: the slice fades over its last (1 − keep) part when a gap follows.
      const fadeStart = Math.round(segLen * keep)
      const g = p.loop === 'off' && i > fadeStart && segLen > fadeStart ? Math.max(0, 1 - (i - fadeStart) / Math.max(1, segLen - fadeStart)) : 1
      out[slot0 + i] = src[s0 + i] * g
    }
    if (p.loop === 'off') continue
    // Fill the gap by repeating the slice — forward, or back and forth.
    let pos = segLen, dir = 1, iter = 1
    while (pos < slotLen) {
      const back = p.loop === 'backforth' && iter % 2 === 1
      for (let i = 0; i < segLen && pos < slotLen; i++, pos++) {
        const j = back ? s1 - 1 - i : s0 + i
        // A short crossfade at each repeat's head hides the seam.
        const g = i < fadeFrames ? i / fadeFrames : 1
        out[slot0 + pos] = src[j] * g
      }
      iter++; dir = -dir
    }
  }
}

/**
 * Texture: granular. Grains of `grainMs`, half overlapped and Hann
 * windowed, read from the source at the warped rate; Flux (0–1) jitters
 * each grain's read position by up to a grain. Seeded per span.
 */
export function textureSpan(
  src: Float32Array, from: number, to: number, outFrames: number, out: Float32Array, at: number,
  p: TextureParams, sampleRate: number, seed: string,
): void {
  const n = to - from
  if (n <= 0 || outFrames <= 0) return
  const grain = Math.max(32, Math.round(sampleRate * (Math.max(5, Math.min(500, p.grainMs)) / 1000)))
  const hop = Math.max(1, Math.round(grain / 2))
  const rng = rngFor(`texture:${seed}`)
  const flux = Math.max(0, Math.min(1, p.flux))
  const norm = new Float32Array(outFrames)
  const acc = new Float32Array(outFrames)
  for (let o = 0; o < outFrames; o += hop) {
    const centre = from + (o / outFrames) * n
    const jitter = flux > 0 ? (rng() * 2 - 1) * flux * grain : 0
    const start = Math.round(centre + jitter - grain / 2)
    for (let i = 0; i < grain && o + i < outFrames; i++) {
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (grain - 1))
      const j = start + i
      const v = j >= 0 && j < src.length ? src[j] : 0
      acc[o + i] += v * w
      norm[o + i] += w
    }
  }
  for (let i = 0; i < outFrames; i++) out[at + i] = norm[i] > 0.01 ? acc[i] / norm[i] : 0
}
