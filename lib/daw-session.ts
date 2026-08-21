// Session→arrangement capture materialization.
//
// The engine logs launched-clip spans on the transport timeline while a
// session capture is armed (startSessionCapture/stopSessionCapture). This
// pure helper turns that log into arrangement clips: same content, fresh
// ids, positioned at the absolute beats the jam actually played. Looping
// slots become looping arrangement clips spanning their full held length.
import type { DawClip, MidiClip } from './daw-types'
import { isAudioClip, isMidiClip } from './daw-types'
import type { SessionCaptureEntry } from './daw-engine'

export function sessionCaptureToClips(entries: SessionCaptureEntry[]): DawClip[] {
  const out: DawClip[] = []
  for (const e of entries) {
    const end = e.endBeat
    if (end === null || end <= e.startBeat + 1e-3) continue
    const span = end - e.startBeat
    if (isMidiClip(e.clip)) {
      const src = e.clip as MidiClip
      const loopLen = src.durationBeats || 4
      out.push({
        ...src,
        id: crypto.randomUUID(),
        trackId: e.trackId,
        startBeat: e.startBeat,
        durationBeats: span,
        // The slot looped its pattern; the arrangement clip loops it too
        loopEnabled: span > loopLen + 1e-3 ? true : src.loopEnabled,
        loopLengthBeats: span > loopLen + 1e-3 ? loopLen : src.loopLengthBeats,
        notes: src.notes.map(n => ({ ...n })),
      })
    } else if (isAudioClip(e.clip)) {
      out.push({
        ...e.clip,
        id: crypto.randomUUID(),
        trackId: e.trackId,
        startBeat: e.startBeat,
        durationBeats: span,
      })
    }
  }
  return out
}
