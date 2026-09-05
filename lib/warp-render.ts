// A sample rendered through its warp markers, as one buffer.
//
// The scheduler plays an audio clip as one AudioBufferSourceNode, with the
// fades, the drawn effects and the seek arithmetic all built around that.
// Warping keeps it that way: the sample is rendered through the map ONCE —
// span by span, each span's seconds squeezed or stretched into the wall
// seconds its beats take at the song's tempo — and the result plays like any
// other buffer. Two ways to fit a span: Re-Pitch resamples it (speed and
// pitch move together, a turntable); Complex hands it to WSOLA (lib/wsola.ts),
// which keeps the pitch. Pure over buffer-shaped objects, with the buffer
// factory and the stretcher injected, so a Node test can run the resampler
// on a click train and read the clicks back on the grid.

import { beatToSec, sortMarkers, type WarpMarker } from './warp'
import { beatsSpan, textureSpan, DEFAULT_BEATS, DEFAULT_TEXTURE, type WarpModeName, type BeatsParams, type TextureParams } from './warp-modes'

export interface BufferLike {
  sampleRate: number
  numberOfChannels: number
  length: number
  duration: number
  getChannelData(i: number): Float32Array
}

export interface WarpRenderOptions {
  /** The map. Two or more valid markers. */
  markers: WarpMarker[]
  /** How long the clip is, in beats — the render covers [0, clipBeats]. */
  clipBeats: number
  /** Wall seconds a beat span takes at the song's tempo (through the tempo map). */
  wallSeconds: (beat0: number, beat1: number) => number
  mode: WarpModeName
  makeBuffer: (channels: number, frames: number, sampleRate: number) => BufferLike
  /** The pitch-keeping stretcher (WSOLA): a buffer and a factor (>1 shortens). Needed for 'stretch' and 'tones'. */
  stretch?: (buf: BufferLike, factor: number) => BufferLike
  /** Beats mode: where to cut, in seconds of the sample (transients, or grid divisions through the map), and how to fill gaps. */
  beats?: { cutsSec: number[]; params: BeatsParams }
  /** Texture mode: grain and flux; the seed keeps a render the same everywhere. */
  texture?: { params: TextureParams; seed: string }
}

/** Linear-interpolation resample of src[from..to) into `outFrames` frames. */
export function resampleSpan(src: Float32Array, from: number, to: number, outFrames: number, out: Float32Array, at: number): void {
  const n = Math.max(0, to - from)
  if (outFrames <= 0) return
  if (n <= 1) { for (let i = 0; i < outFrames; i++) out[at + i] = n === 1 && from < src.length ? src[from] : 0; return }
  const step = n / outFrames
  for (let i = 0; i < outFrames; i++) {
    const pos = from + i * step
    const j = Math.floor(pos)
    const frac = pos - j
    const a = j < src.length && j >= 0 ? src[j] : 0
    const b = j + 1 < src.length && j + 1 >= 0 ? src[j + 1] : a
    out[at + i] = a + (b - a) * frac
  }
}

/** A copy of src's frames [from, to) as a buffer (silence where the range leaves the sample). */
function slice(src: BufferLike, from: number, to: number, makeBuffer: WarpRenderOptions['makeBuffer']): BufferLike {
  const n = Math.max(1, to - from)
  const out = makeBuffer(src.numberOfChannels, n, src.sampleRate)
  for (let ch = 0; ch < src.numberOfChannels; ch++) {
    const s = src.getChannelData(ch), d = out.getChannelData(ch)
    for (let i = 0; i < n; i++) { const j = from + i; d[i] = j >= 0 && j < s.length ? s[j] : 0 }
  }
  return out
}

/**
 * The spans the render is cut into: the marker beats inside (0, clipBeats)
 * plus the two ends, each with its seconds through the map and its wall time.
 */
export function renderSpans(o: Pick<WarpRenderOptions, 'markers' | 'clipBeats' | 'wallSeconds'>): { beat0: number; beat1: number; sec0: number; sec1: number; wall: number }[] {
  const ms = sortMarkers(o.markers)
  const cuts = [0, ...ms.map(m => m.beat).filter(b => b > 1e-6 && b < o.clipBeats - 1e-6), o.clipBeats]
  const out: { beat0: number; beat1: number; sec0: number; sec1: number; wall: number }[] = []
  for (let i = 0; i < cuts.length - 1; i++) {
    const beat0 = cuts[i], beat1 = cuts[i + 1]
    if (beat1 - beat0 <= 1e-9) continue
    out.push({ beat0, beat1, sec0: beatToSec(ms, beat0), sec1: beatToSec(ms, beat1), wall: Math.max(0, o.wallSeconds(beat0, beat1)) })
  }
  return out
}

/** The sample through its map, as one buffer as long as the clip's wall time. */
export function renderWarped(src: BufferLike, o: WarpRenderOptions): BufferLike {
  const sr = src.sampleRate
  const spans = renderSpans(o)
  const totalFrames = Math.max(1, Math.round(spans.reduce((s, x) => s + x.wall, 0) * sr))
  const out = o.makeBuffer(src.numberOfChannels, totalFrames, sr)
  let at = 0
  for (const sp of spans) {
    const frames = Math.round(sp.wall * sr)
    if (frames <= 0) continue
    const from = Math.round(sp.sec0 * sr), to = Math.round(sp.sec1 * sr)
    if (o.mode === 'beats') {
      const cuts = (o.beats?.cutsSec ?? []).map(s => Math.round(s * sr))
      for (let ch = 0; ch < src.numberOfChannels; ch++) {
        beatsSpan(src.getChannelData(ch), from, to, Math.min(frames, totalFrames - at), out.getChannelData(ch), at, cuts, o.beats?.params ?? DEFAULT_BEATS, sr)
      }
    } else if (o.mode === 'texture') {
      for (let ch = 0; ch < src.numberOfChannels; ch++) {
        textureSpan(src.getChannelData(ch), from, to, Math.min(frames, totalFrames - at), out.getChannelData(ch), at, o.texture?.params ?? DEFAULT_TEXTURE, sr, `${o.texture?.seed ?? ''}:${sp.beat0}:${ch}`)
      }
    } else if ((o.mode === 'stretch' || o.mode === 'tones') && o.stretch && to - from > 64) {
      const factor = (to - from) / frames
      const stretched = Math.abs(factor - 1) < 0.002 ? slice(src, from, to, o.makeBuffer) : o.stretch(slice(src, from, to, o.makeBuffer), factor)
      for (let ch = 0; ch < src.numberOfChannels; ch++) {
        const s = stretched.getChannelData(Math.min(ch, stretched.numberOfChannels - 1)), d = out.getChannelData(ch)
        const n = Math.min(frames, s.length, totalFrames - at)
        for (let i = 0; i < n; i++) d[at + i] = s[i]
      }
    } else {
      for (let ch = 0; ch < src.numberOfChannels; ch++) {
        resampleSpan(src.getChannelData(ch), from, to, Math.min(frames, totalFrames - at), out.getChannelData(ch), at)
      }
    }
    at += frames
    if (at >= totalFrames) break
  }
  return out
}
