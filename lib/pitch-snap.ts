/**
 * Scale-aware pitch snapping for audio clips.
 *
 * Transposing a sample by an arbitrary number of semitones is the fastest way
 * to take it out of the song's key — every step is available, and only some of
 * them are musical. Snapping the *resulting* pitch to the project's scale means
 * the default outcome is in key, and going off-grid becomes a deliberate act
 * (hold ⌥ Option) rather than the thing that happens by accident.
 *
 * Note this snaps the RESULT, not the offset. Shifting a sample up 3 semitones
 * is musical or not depending entirely on what pitch it started at, so the
 * source pitch has to be part of the calculation — which is why callers pass
 * the detected pitch and why snapping is unavailable without it.
 */

import { ROOT_NOTES, snapToScale, isNoteInScale, type RootNote, type ScaleType } from './scale-constants'

export const hzToMidi = (hz: number) => 69 + 12 * Math.log2(hz / 440)
export const midiToHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12)

/** Project key (0-11) → the root name scale-constants expects. */
export const rootFromKey = (key: number): RootNote => ROOT_NOTES[((key % 12) + 12) % 12]

export interface SnapContext {
  /** Detected pitch of the source audio, in Hz. Null = snapping unavailable. */
  detectedHz: number | null
  key: number
  scale: string
}

/** Is a given semitone offset in key for this source pitch? */
export function offsetIsInScale(semitones: number, ctx: SnapContext): boolean {
  if (ctx.detectedHz == null) return true
  const result = Math.round(hzToMidi(ctx.detectedHz)) + semitones
  return isNoteInScale(result, rootFromKey(ctx.key), ctx.scale as ScaleType)
}

/**
 * Nearest semitone offset that lands the sample on a scale degree.
 * Returns the offset unchanged when there's no detected pitch to measure from.
 */
export function snapOffsetToScale(semitones: number, ctx: SnapContext): number {
  if (ctx.detectedHz == null) return Math.round(semitones)
  const sourceMidi = Math.round(hzToMidi(ctx.detectedHz))
  const wanted = sourceMidi + Math.round(semitones)
  const snapped = snapToScale(wanted, rootFromKey(ctx.key), ctx.scale as ScaleType)
  return snapped - sourceMidi
}

/**
 * Every in-scale offset within range, for rendering tick marks so the musical
 * positions are visible before the user drags rather than only after.
 */
export function inScaleOffsets(min: number, max: number, ctx: SnapContext): number[] {
  if (ctx.detectedHz == null) return []
  const out: number[] = []
  for (let s = Math.ceil(min); s <= Math.floor(max); s++) {
    if (offsetIsInScale(s, ctx)) out.push(s)
  }
  return out
}

/** Resulting MIDI note after a shift, for display. */
export function resultMidi(semitones: number, cents: number, ctx: SnapContext): number | null {
  if (ctx.detectedHz == null) return null
  return hzToMidi(ctx.detectedHz) + semitones + cents / 100
}
