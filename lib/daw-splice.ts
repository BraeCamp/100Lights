// Cutting a clip in two at the playhead.
//
// This lived as forty-five lines inline in TrackRow's JSX, wired to one context
// menu item called "Splice at Playhead". That made it unreachable by anything
// else — not the palette, not a keyboard shortcut, not a test. It is also the
// single most-used edit in any DAW, and I once audited this codebase and
// reported it as missing, because I searched for the word "split".
//
// Pulled out here so there is one implementation with several ways in, and so
// the tricky parts — warped audio, looped MIDI — can be tested directly.

import { isAudioClip, type DawClip, type MidiNote } from './daw-types'

export interface SpliceResult {
  /** The clip to remove — the original. */
  removeId: string
  /** The two halves, in order. */
  add: DawClip[]
}

/**
 * Split `clip` at absolute beat `playhead`.
 *
 * Returns null when the playhead isn't strictly inside the clip: splitting at
 * an edge would produce a zero-length half, which is worse than doing nothing
 * because it looks like the edit worked.
 *
 * `beatsToSeconds` comes from the engine, since converting beats to seconds
 * depends on the tempo map (a song with tempo changes has no single ratio).
 */
export function spliceClipAt(
  clip: DawClip,
  playhead: number,
  beatsToSeconds: (beats: number) => number,
): SpliceResult | null {
  if (playhead <= clip.startBeat || playhead >= clip.startBeat + clip.durationBeats) return null
  const beatOffset = playhead - clip.startBeat

  if (isAudioClip(clip)) {
    if (!clip.bufferDuration) return null
    const bufDur = clip.bufferDuration
    const nativeDur = bufDur - clip.trimStart - clip.trimEnd
    const frac = beatOffset / clip.durationBeats
    // Warped clips stretch their audio to fill durationBeats, so the cut lands
    // at that fraction of the source. Unwarped clips play at native speed, so
    // the cut lands at however many seconds have actually elapsed — using the
    // fraction there would drift wherever the clip isn't at its natural length.
    const splitSec = clip.warpEnabled
      ? (clip.trimStart ?? 0) + frac * nativeDur
      : (clip.trimStart ?? 0) + beatsToSeconds(beatOffset)
    return {
      removeId: clip.id,
      add: [
        { ...clip, id: crypto.randomUUID(), durationBeats: beatOffset, trimEnd: Math.max(0, bufDur - splitSec) },
        { ...clip, id: crypto.randomUUID(), startBeat: playhead, durationBeats: clip.durationBeats - beatOffset, trimStart: splitSec },
      ],
    }
  }

  // Looped MIDI: materialise the repeats before cutting, so both halves keep
  // the pattern you can HEAR rather than splitting the single stored pattern
  // and silently dropping every repeat after the cut.
  let notes: MidiNote[] = clip.notes
  if (clip.loopEnabled && clip.loopLengthBeats) {
    const L = clip.loopLengthBeats
    notes = []
    for (let k = 0; k * L < clip.durationBeats; k++) {
      for (const n of clip.notes) {
        const start = k * L + n.startBeat
        if (start >= clip.durationBeats) continue
        notes.push({ ...n, id: crypto.randomUUID(), startBeat: start, durationBeats: Math.min(n.durationBeats, clip.durationBeats - start) })
      }
    }
  }

  // Notes starting before the cut stay left, truncated if they span it; notes
  // at or after it move right and are rebased to the new clip's start.
  const leftNotes = notes.filter(n => n.startBeat < beatOffset)
    .map(n => ({ ...n, durationBeats: Math.min(n.durationBeats, beatOffset - n.startBeat) }))
  const rightNotes = notes.filter(n => n.startBeat >= beatOffset)
    .map(n => ({ ...n, id: crypto.randomUUID(), startBeat: n.startBeat - beatOffset }))

  // Each half's loop unit becomes its OWN length — the splice boundary — so
  // switching looping back on repeats the spliced segment. Leaving the old
  // loopLengthBeats would snap the clip straight back to its un-spliced size.
  return {
    removeId: clip.id,
    add: [
      { ...clip, id: crypto.randomUUID(), durationBeats: beatOffset, notes: leftNotes, loopEnabled: false, loopLengthBeats: beatOffset },
      { ...clip, id: crypto.randomUUID(), startBeat: playhead, durationBeats: clip.durationBeats - beatOffset, notes: rightNotes, loopEnabled: false, loopLengthBeats: clip.durationBeats - beatOffset },
    ],
  }
}
