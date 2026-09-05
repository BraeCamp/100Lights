// The Sample Editor's arithmetic, without the pane.
//
// Live's clip panel for audio has a handful of numbers that all describe one
// relationship: how long the sample IS (its native seconds, after trimming),
// how many beats it is asked to SPAN (the clip's length), and the tempo that
// makes those two agree — Seg. BPM. With Warp on the engine plays the sample
// at native / clip seconds, which is tempo / Seg BPM; ×2 and ÷2 exist because
// tempo detection is often off by an octave, and doubling the Seg BPM means
// the sample spans twice the beats at half the speed. Everything here is a
// pure function so the pane, the palette and the voice path agree, and a
// test can pin the numbers.

import type { AudioClip } from './daw-types'

export const MIN_NATIVE_SECONDS = 0.01

/** Seconds of sample the clip plays: the buffer minus both trims. Null until the buffer has loaded. */
export function nativeSeconds(clip: Pick<AudioClip, 'bufferDuration' | 'trimStart' | 'trimEnd'>): number | null {
  if (clip.bufferDuration == null) return null
  return Math.max(0, clip.bufferDuration - (clip.trimStart ?? 0) - (clip.trimEnd ?? 0))
}

/**
 * Seg. BPM: the tempo at which the sample's native length spans the clip's
 * beats. The stored value wins; otherwise it is read off the clip. Null until
 * the buffer has loaded.
 */
export function segBpmOf(clip: Pick<AudioClip, 'bufferDuration' | 'trimStart' | 'trimEnd' | 'durationBeats' | 'segBpm'>): number | null {
  if (clip.segBpm && clip.segBpm > 0) return clip.segBpm
  const sec = nativeSeconds(clip)
  if (sec == null || sec < MIN_NATIVE_SECONDS || !(clip.durationBeats > 0)) return null
  return round2((clip.durationBeats / sec) * 60)
}

/** How many beats the sample spans at a Seg BPM — the clip's length when it follows the sample. */
export function beatsAtSegBpm(nativeSec: number, segBpm: number): number {
  return round6((nativeSec * segBpm) / 60)
}

/** Playback speed with Warp on: the song's tempo over the sample's own. 1 = as recorded. */
export function warpSpeed(tempo: number, segBpm: number): number {
  return segBpm > 0 ? tempo / segBpm : 1
}

/** The patch for a new Seg BPM: the clip's length follows the sample (snapped to the grid when asked). */
export function setSegBpm(clip: Pick<AudioClip, 'bufferDuration' | 'trimStart' | 'trimEnd'>, segBpm: number, grid = 0): Partial<AudioClip> | null {
  const sec = nativeSeconds(clip)
  if (sec == null || sec < MIN_NATIVE_SECONDS || !(segBpm > 0)) return null
  let beats = beatsAtSegBpm(sec, segBpm)
  if (grid > 0) beats = Math.max(grid, Math.round(beats / grid) * grid)
  return { segBpm: round2(segBpm), durationBeats: beats, warpEnabled: true }
}

export const gainToDb = (gain: number): number => 20 * Math.log10(Math.max(0.001, gain))
export const dbToGain = (db: number): number => Math.pow(10, db / 20)

/**
 * A trim edge dragged by `deltaSec`: the start can never pass the end (a
 * hair of sample always stays), and neither trim goes negative.
 */
export function trimByDrag(clip: Pick<AudioClip, 'bufferDuration' | 'trimStart' | 'trimEnd'>, edge: 'start' | 'end', deltaSec: number): Partial<AudioClip> | null {
  if (clip.bufferDuration == null) return null
  const total = clip.bufferDuration
  const ts = clip.trimStart ?? 0, te = clip.trimEnd ?? 0
  if (edge === 'start') {
    const next = Math.max(0, Math.min(total - te - MIN_NATIVE_SECONDS, ts + deltaSec))
    return { trimStart: round6(next) }
  }
  // The end edge moving RIGHT (positive delta) means less trimmed at the end.
  const next = Math.max(0, Math.min(total - ts - MIN_NATIVE_SECONDS, te - deltaSec))
  return { trimEnd: round6(next) }
}

/** Where a beat inside the clip sits in the sample, 0..1 of the full buffer — for the playhead over the waveform. */
export function sampleFraction(clip: Pick<AudioClip, 'bufferDuration' | 'trimStart' | 'trimEnd' | 'durationBeats' | 'reverse'>, beatInClip: number): number | null {
  const sec = nativeSeconds(clip)
  if (sec == null || clip.bufferDuration == null || clip.bufferDuration <= 0 || !(clip.durationBeats > 0)) return null
  let t = Math.max(0, Math.min(1, beatInClip / clip.durationBeats))
  if (clip.reverse) t = 1 - t
  return ((clip.trimStart ?? 0) + t * sec) / clip.bufferDuration
}

/**
 * SLIP EDIT (Live: ⇧⌥-drag inside the waveform) — the audio slides under the
 * clip, which stays where it is and keeps its length. A positive delta moves
 * the window LATER in the sample, so the audio appears to slide left.
 *
 * Which numbers move depends on what maps the sample onto the beats:
 *   • warp markers, when the clip has them — they name absolute seconds of the
 *     buffer, so the trims are not in the map and shifting the markers is the
 *     only thing that slides anything. Room is what keeps every marker inside
 *     the buffer.
 *   • the trims otherwise (unwarped, or warped straight across them). Room is
 *     the audio trimmed off each end.
 * Returns null when there is no room to move.
 */
export function slipByDrag(
  clip: Pick<AudioClip, 'bufferDuration' | 'trimStart' | 'trimEnd' | 'warpMarkers'>,
  deltaSec: number,
): Partial<AudioClip> | null {
  const total = clip.bufferDuration
  if (total == null || !(total > 0)) return null
  const ms = clip.warpMarkers
  if (ms && ms.length) {
    const lo = Math.min(...ms.map(m => m.sec)), hi = Math.max(...ms.map(m => m.sec))
    const d = Math.max(-lo, Math.min(total - hi, deltaSec))
    if (Math.abs(d) < 1e-9) return null
    return { warpMarkers: ms.map(m => ({ ...m, sec: round6(m.sec + d) })) }
  }
  const ts = clip.trimStart ?? 0, te = clip.trimEnd ?? 0
  if (total - ts - te < MIN_NATIVE_SECONDS) return null
  const d = Math.max(-ts, Math.min(te, deltaSec))
  if (Math.abs(d) < 1e-9) return null
  return { trimStart: round6(ts + d), trimEnd: round6(te - d) }
}

/**
 * CROP (Live's Crop Sample, ⇧⌘J) — throw away the audio the clip never plays,
 * so the trims say exactly what you hear. Only an unwarped, non-looping clip
 * has any: it plays its sample at native speed and its beat window may end
 * before the audio does. A warped clip fits its whole trimmed span onto its
 * beats, and a looping one repeats it, so there is nothing outside either —
 * null, and the caller should say so rather than pretend.
 *
 * Reversed, the clip plays the END of the trimmed span, so the crop takes off
 * the front.
 */
export function cropSample(
  clip: Pick<AudioClip, 'bufferDuration' | 'trimStart' | 'trimEnd' | 'durationBeats' | 'warpEnabled' | 'loopEnabled' | 'reverse'>,
  tempo: number,
): Partial<AudioClip> | null {
  const total = clip.bufferDuration
  if (total == null || clip.warpEnabled || clip.loopEnabled) return null
  const ts = clip.trimStart ?? 0, te = clip.trimEnd ?? 0
  const native = total - ts - te
  if (native < MIN_NATIVE_SECONDS || !(clip.durationBeats > 0)) return null
  const played = (clip.durationBeats * 60) / (tempo > 0 ? tempo : 120)
  if (played >= native - 1e-4) return null   // the clip outlasts its audio: nothing to cut
  return clip.reverse
    ? { trimStart: round6(total - te - played) }
    : { trimEnd: round6(total - ts - played) }
}

/**
 * MULTI-CLIP EDITING: the fields the clip panel writes to every selected audio
 * clip. The rest — the trims, the warp markers, Seg BPM, the clip's length,
 * the tempo leader — each describe ONE sample and would be nonsense copied
 * across a selection of different samples.
 */
export const SHARED_CLIP_FIELDS = [
  'gain', 'pitchSemitones', 'pitchCents', 'reverse', 'fadeIn', 'fadeOut', 'clipFade', 'loopEnabled',
  'warpEnabled', 'warpMode', 'warpBeats', 'warpTones', 'warpTexture',
] as const
export type SharedClipField = typeof SHARED_CLIP_FIELDS[number]

/** True when every field in the patch is one a selection can share. */
export function isSharedPatch(patch: Record<string, unknown>): boolean {
  const keys = Object.keys(patch)
  return keys.length > 0 && keys.every(k => (SHARED_CLIP_FIELDS as readonly string[]).includes(k))
}

export interface SampleDetails { sampleRate: number; channels: number; seconds: number; frames: number }

/** The header's facts about the sample, from the decoded buffer. */
export function sampleDetails(buf: { sampleRate: number; numberOfChannels: number; length: number; duration: number }): SampleDetails {
  return { sampleRate: buf.sampleRate, channels: buf.numberOfChannels, seconds: buf.duration, frames: buf.length }
}

export function describeSample(d: SampleDetails): string {
  const ch = d.channels === 1 ? 'mono' : d.channels === 2 ? 'stereo' : `${d.channels} ch`
  return `${(d.sampleRate / 1000).toFixed(1)} kHz · 32-bit float · ${ch} · ${d.seconds.toFixed(2)} s`
}

/** The fields Save Default Clip remembers for a sample. */
export const DEFAULT_CLIP_FIELDS = ['warpEnabled', 'warpMode', 'segBpm', 'gain', 'pitchSemitones', 'pitchCents', 'reverse', 'fadeIn', 'fadeOut', 'clipFade', 'loopEnabled'] as const
export type DefaultClipField = typeof DEFAULT_CLIP_FIELDS[number]
export type ClipDefaults = Partial<Pick<AudioClip, DefaultClipField>>

/** The part of a clip a default remembers. */
export function pickClipDefaults(clip: AudioClip): ClipDefaults {
  const out: Record<string, unknown> = {}
  for (const k of DEFAULT_CLIP_FIELDS) if (clip[k] !== undefined) out[k] = clip[k]
  return out as ClipDefaults
}

const round2 = (n: number) => Math.round(n * 100) / 100
const round6 = (n: number) => Math.round(n * 1e6) / 1e6
