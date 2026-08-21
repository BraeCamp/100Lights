// Consolidate — "print" a looping MIDI clip so its repetitions become real,
// individually-editable notes (Ableton's Ctrl+J).
//
// Why this matters: inside a looping clip every repetition is the SAME note
// data, so nudging one note in bar 3 nudges it in every bar. Producers hit
// consolidate the moment they want one repeat to differ (the Live 12 course
// does it constantly). After consolidating, the clip holds the flattened
// pattern with looping off — same sound, now editable per repetition.
import type { MidiClip, MidiNote } from './daw-types'

/** True when the clip actually has repetitions to print. */
export function canConsolidate(clip: MidiClip): boolean {
  const loopLen = clip.loopLengthBeats ?? 0
  return !!clip.loopEnabled && loopLen > 0 && clip.durationBeats > loopLen + 1e-6
}

/**
 * Flatten a looping clip's repetitions into explicit notes.
 * Mirrors the engine's occurrence expansion (daw-engine `_tick`): repetition k
 * starts at k·loopLength, and the last repetition is truncated at the clip end
 * — so what you hear before consolidating is exactly what you get after.
 */
export function consolidateMidiClip(clip: MidiClip): MidiClip {
  if (!canConsolidate(clip)) return clip
  const loopLen = clip.loopLengthBeats!
  const out: MidiNote[] = []
  const kMax = Math.ceil(clip.durationBeats / loopLen)
  for (let k = 0; k < kMax; k++) {
    for (const note of clip.notes) {
      const startBeat = k * loopLen + note.startBeat
      if (startBeat >= clip.durationBeats - 1e-6) continue
      // Truncate the final repetition at the clip boundary, exactly as the
      // scheduler does when it caps maxDur.
      const durationBeats = Math.min(note.durationBeats, clip.durationBeats - startBeat)
      if (durationBeats <= 1e-6) continue
      out.push({ ...note, id: crypto.randomUUID(), startBeat, durationBeats })
    }
  }
  return { ...clip, notes: out, loopEnabled: false, loopLengthBeats: undefined }
}
