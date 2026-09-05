// Slice to New MIDI Track and Convert Harmony / Melody / Drums to MIDI —
// the pure part (Live's audio-to-MIDI commands, Batch 3.5). The browser side
// that decodes, encodes slices and dispatches is lib/audio-to-track.ts.
//
// Slicing: the sample is cut at its transients, at its warp markers, or on a
// grid; every slice becomes a pad of a drum instrument (chromatic from C1,
// the way a Drum Rack fills), and a MIDI clip plays the pads in order, each
// note where its slice sits — through the clip's warp map, so a warped clip
// slices to the beats it plays at, not to the sample's own seconds.
//
// Converting: the shared local transcriber (lib/audio-to-midi.ts) hears the
// notes; Harmony keeps every voice it found, Melody keeps one line (one note
// per attack), Drums hears attacks and calls each a kick, a snare or a hat by
// where its energy sits.

import type { AudioNote } from './audio-to-midi'
import type { DrumPadSettings, MidiNote } from './daw-types'

export type SliceBy = 'transients' | 'markers' | number   // a number is a grid in beats

/** Grids the dialog offers, in beats (1 bar is `barBeats`). */
export const SLICE_GRIDS = [2, 1, 0.5, 0.25, 0.125] as const
export const MAX_SLICES = 64
export const DEFAULT_MAX_SLICES = 32
/** The first pad — C1, where a Drum Rack starts filling. */
export const FIRST_PAD = 36
/** A slice shorter than this is a sliver of the cut before it, not a sound. */
export const MIN_SLICE_SEC = 0.02

export function sliceByLabel(by: SliceBy, barBeats: number): string {
  if (by === 'transients') return 'Transient'
  if (by === 'markers') return 'Warp Marker'
  if (by === barBeats) return '1 Bar'
  const names: Record<number, string> = { 2: '1/2', 1: '1/4', 0.5: '1/8', 0.25: '1/16', 0.125: '1/32' }
  return names[by] ?? `${by} beats`
}

export interface CutOptions {
  /** The trimmed sample's span, in seconds of the buffer. */
  start: number
  end: number
  /** How many beats the clip spans. */
  clipBeats: number
  /** Beats → seconds through the clip's warp map (the identity of a straight clip). */
  beatToSec: (beat: number) => number
  /** Transient times (seconds of the buffer), for 'transients'. */
  onsets?: number[]
  /** Warp marker times (seconds of the buffer), for 'markers'. */
  markerSecs?: number[]
  max?: number
}

/**
 * Where the slices start, in seconds of the buffer: sorted, unique, inside
 * [start, end), always beginning at `start`. Too many cuts for `max` are
 * thinned evenly (every k-th kept) rather than truncated, so the whole
 * sample is still covered. Slivers under MIN_SLICE_SEC merge into the slice
 * before them.
 */
export function sliceCuts(by: SliceBy, o: CutOptions): number[] {
  const max = Math.max(1, Math.min(MAX_SLICES, o.max ?? DEFAULT_MAX_SLICES))
  let raw: number[]
  if (by === 'transients') raw = o.onsets ?? []
  else if (by === 'markers') raw = o.markerSecs ?? []
  else {
    raw = []
    const g = by > 0 ? by : 1
    for (let b = 0; b < o.clipBeats - 1e-6; b += g) raw.push(o.beatToSec(b))
  }
  const inside = raw.filter(t => t > o.start + MIN_SLICE_SEC && t < o.end - MIN_SLICE_SEC).sort((a, b) => a - b)
  const merged: number[] = [o.start]
  for (const t of inside) if (t - merged[merged.length - 1] >= MIN_SLICE_SEC) merged.push(t)
  if (merged.length <= max) return merged
  const k = Math.ceil(merged.length / max)
  return merged.filter((_, i) => i % k === 0).slice(0, max)
}

export interface SliceSpan { from: number; to: number }

/** The slices as spans of the buffer, the last running to `end`. */
export function sliceSpans(cuts: number[], end: number): SliceSpan[] {
  return cuts.map((from, i) => ({ from, to: i + 1 < cuts.length ? cuts[i + 1] : end })).filter(s => s.to - s.from >= MIN_SLICE_SEC)
}

/** Pad pitches for n slices — chromatic from C1. */
export function padPitches(n: number): number[] {
  return Array.from({ length: Math.max(0, Math.min(n, 127 - FIRST_PAD + 1)) }, (_, i) => FIRST_PAD + i)
}

/**
 * One note per slice, where the slice sits in the clip (beats through the
 * map), lasting as long as the slice does. Velocity is flat: the pad's own
 * audio carries the dynamics.
 */
export function sliceNotes(spans: SliceSpan[], secToBeat: (sec: number) => number, pitches: number[], makeId: () => string): MidiNote[] {
  return spans.map((s, i) => {
    const start = secToBeat(s.from), end = secToBeat(s.to)
    return { id: makeId(), pitch: pitches[i], startBeat: Math.max(0, start), durationBeats: Math.max(0.0625, end - start), velocity: 100 }
  })
}

/** A pad per slice, its audio baked in as a data URI so the kit travels with the project. */
export function slicePads(pitches: number[], slices: Array<{ id: string; name: string; data: string }>): Record<number, DrumPadSettings> {
  const pads: Record<number, DrumPadSettings> = {}
  slices.forEach((s, i) => {
    if (pitches[i] == null) return
    pads[pitches[i]] = { volume: 0.8, pitch: 0, pan: 0, mute: false, chokeGroup: 0, sample: { id: s.id, name: s.name, data: s.data } }
  })
  return pads
}

// ── Convert to MIDI ──────────────────────────────────────────────────────────

export type ConvertKind = 'harmony' | 'melody' | 'drums'
export const CONVERT_LABEL: Record<ConvertKind, string> = { harmony: 'Harmony', melody: 'Melody', drums: 'Drums' }

/** Attacks closer than this are one attack — the same window the transcriber's chords use. */
export const SAME_ATTACK_SEC = 0.03

/**
 * One line: of the notes that start together, keep the surest (then the
 * highest). Harmony keeps them all.
 */
export function melodyOnly(notes: AudioNote[]): AudioNote[] {
  const sorted = [...notes].sort((a, b) => a.startSec - b.startSec || b.confidence - a.confidence || b.midi - a.midi)
  const out: AudioNote[] = []
  for (const n of sorted) {
    const last = out[out.length - 1]
    if (last && n.startSec - last.startSec < SAME_ATTACK_SEC) continue
    out.push(n)
  }
  // A line's note ends where the next begins, if it was heard running on.
  return out.map((n, i) => {
    const next = out[i + 1]
    return next && n.startSec + n.durSec > next.startSec ? { ...n, durSec: Math.max(0.03, next.startSec - n.startSec) } : n
  })
}

/** Transcribed notes as MIDI notes in the clip, through the map. Velocity 0..1 or 1..127 both land on 1..127. */
export function toMidiNotes(notes: AudioNote[], secToBeat: (sec: number) => number, makeId: () => string, minBeats = 0.0625): MidiNote[] {
  return notes.map(n => {
    const start = secToBeat(n.startSec), end = secToBeat(n.startSec + n.durSec)
    const v = n.velocity <= 1 ? Math.round(n.velocity * 127) : Math.round(n.velocity)
    return { id: makeId(), pitch: Math.max(0, Math.min(127, Math.round(n.midi))), startBeat: Math.max(0, start), durationBeats: Math.max(minBeats, end - start), velocity: Math.max(1, Math.min(127, v)) }
  })
}

// Drums: which pad an attack is, from where its energy sits.
export const KICK = 36
export const SNARE = 38
export const CLOSED_HAT = 42

/** Spectral centroid, Hz, of `n` samples from `at` — a small in-place FFT, no library. */
export function spectralCentroid(samples: Float32Array, sampleRate: number, at: number, n = 1024): number {
  let size = 1
  while (size * 2 <= n) size *= 2
  const re = new Float64Array(size), im = new Float64Array(size)
  for (let i = 0; i < size; i++) {
    const s = samples[at + i] ?? 0
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size)   // Hann
    re[i] = s * w
  }
  fft(re, im)
  let num = 0, den = 0
  for (let k = 1; k < size / 2; k++) {
    const mag = Math.sqrt(re[k] * re[k] + im[k] * im[k])
    const hz = (k * sampleRate) / size
    num += hz * mag; den += mag
  }
  return den > 0 ? num / den : 0
}

function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const wr = Math.cos(ang), wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0
      for (let j = 0; j < len / 2; j++) {
        const ur = re[i + j], ui = im[i + j]
        const vr = re[i + j + len / 2] * cr - im[i + j + len / 2] * ci
        const vi = re[i + j + len / 2] * ci + im[i + j + len / 2] * cr
        re[i + j] = ur + vr; im[i + j] = ui + vi
        re[i + j + len / 2] = ur - vr; im[i + j + len / 2] = ui - vi
        const ncr = cr * wr - ci * wi
        ci = cr * wi + ci * wr; cr = ncr
      }
    }
  }
}

/** Kick below 250 Hz, hat above 2 kHz, snare between. */
export function drumPitchFor(centroidHz: number): number {
  if (centroidHz < 250) return KICK
  if (centroidHz > 2000) return CLOSED_HAT
  return SNARE
}

export interface DrumHit { t: number; strength: number }

/** Attacks as drum notes — each on the pad its energy says, a sixteenth long, as loud as its attack. */
export function drumNotes(hits: DrumHit[], samples: Float32Array, sampleRate: number, secToBeat: (sec: number) => number, makeId: () => string): MidiNote[] {
  return hits.map(h => {
    const at = Math.max(0, Math.min(samples.length - 1, Math.round(h.t * sampleRate)))
    const pitch = drumPitchFor(spectralCentroid(samples, sampleRate, at))
    return { id: makeId(), pitch, startBeat: Math.max(0, secToBeat(h.t)), durationBeats: 0.25, velocity: Math.max(40, Math.min(127, Math.round(60 + h.strength * 67))) }
  })
}

export function describeSlicing(count: number, by: SliceBy, barBeats: number): string {
  return `${count} slice${count === 1 ? '' : 's'} — one per ${sliceByLabel(by, barBeats).toLowerCase()}`
}
