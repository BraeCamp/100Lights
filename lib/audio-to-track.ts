// Slice to New MIDI Track and Convert Harmony / Melody / Drums to MIDI — the
// browser side (Batch 3.5). It has the decoded buffer, cuts and encodes the
// slices, hears the notes, and dispatches the new track and clip. The pure
// decisions are lib/slice-to-midi.ts. Called from the clip panel, the clip's
// context menu, and voice (AUDIO_TO_MIDI in VoiceControl).

import type { AudioClip, MidiNote, TrackInstrument } from './daw-types'
import { defaultDrumInstrument, defaultPolyInstrument } from './daw-types'
import { makeMidiClip, type DawAction } from './daw-state'
import { detectOnsets, monoOf } from './onsets'
import { encodeWavPcm16 } from './wav-codec'
import { validMarkers, secToBeat as mapSecToBeat, beatToSec as mapBeatToSec } from './warp'
import { audioToNotes } from './audio-to-midi'
import {
  sliceCuts, sliceSpans, padPitches, sliceNotes, slicePads, melodyOnly, toMidiNotes, drumNotes, describeSlicing,
  CONVERT_LABEL, type SliceBy, type ConvertKind,
} from './slice-to-midi'

export type BufferLike = { sampleRate: number; numberOfChannels: number; length: number; duration: number; getChannelData(i: number): Float32Array }
type Dispatch = (a: DawAction) => void

export interface ClipMap {
  /** The trimmed sample's span, seconds of the buffer. */
  start: number
  end: number
  secToBeat: (sec: number) => number
  beatToSec: (beat: number) => number
  markerSecs: number[]
}

/**
 * Seconds of the buffer ↔ beats of the clip. A warped clip with markers goes
 * through them; warped without, straight across its beats; unwarped, at the
 * song tempo — the sample's own speed.
 */
export function clipMap(clip: AudioClip, buf: BufferLike, tempo: number): ClipMap {
  const start = clip.trimStart ?? 0, end = Math.max(start + 1e-3, buf.duration - (clip.trimEnd ?? 0))
  const ms = validMarkers(clip.warpMarkers)
  if (clip.warpEnabled && ms && ms.length >= 2) {
    return { start, end, secToBeat: s => mapSecToBeat(ms, s), beatToSec: b => mapBeatToSec(ms, b), markerSecs: ms.map(m => m.sec) }
  }
  if (clip.warpEnabled) {
    const native = end - start
    return { start, end, secToBeat: s => ((s - start) / native) * clip.durationBeats, beatToSec: b => start + (b / clip.durationBeats) * native, markerSecs: [] }
  }
  const bps = (tempo > 0 ? tempo : 120) / 60
  return { start, end, secToBeat: s => (s - start) * bps, beatToSec: b => start + b / bps, markerSecs: [] }
}

const dataUri = (ab: ArrayBuffer): Promise<string> => new Promise((res, rej) => {
  const r = new FileReader()
  r.onload = () => res(String(r.result))
  r.onerror = () => rej(r.error)
  r.readAsDataURL(new Blob([ab], { type: 'audio/wav' }))
})

export interface SliceOutcome { trackId: string; clipId: string; slices: number; said: string }

/**
 * Cut the clip's sample into slices, bake each into a pad of a new drum
 * instrument on a new track, and write a MIDI clip that plays the pads where
 * the slices sit. The audio clip stays.
 */
export async function sliceToNewTrack(
  clip: AudioClip, buf: BufferLike,
  o: { tempo: number; barBeats: number; by: SliceBy; max?: number; sensitivity?: number },
  dispatch: Dispatch,
): Promise<SliceOutcome> {
  const map = clipMap(clip, buf, o.tempo)
  const onsets = o.by === 'transients' ? detectOnsets(monoOf(buf), buf.sampleRate, o.sensitivity != null ? { sensitivity: o.sensitivity } : {}).map(x => x.t) : undefined
  const by = o.by
  const cuts = sliceCuts(by, { start: map.start, end: map.end, clipBeats: clip.durationBeats, beatToSec: map.beatToSec, onsets, markerSecs: map.markerSecs, max: o.max })
  const spans = sliceSpans(cuts, map.end)
  const pitches = padPitches(spans.length)
  const sr = buf.sampleRate
  const slices: Array<{ id: string; name: string; data: string }> = []
  for (let i = 0; i < spans.length && i < pitches.length; i++) {
    const s = Math.max(0, Math.floor(spans[i].from * sr)), e = Math.min(buf.length, Math.floor(spans[i].to * sr))
    if (e - s < 2) continue
    const channels = Array.from({ length: buf.numberOfChannels }, (_, ch) => buf.getChannelData(ch).slice(s, e))
    slices.push({ id: `slice-${clip.id}-${i}-${e - s}`, name: `${clip.name} ${i + 1}`, data: await dataUri(encodeWavPcm16(channels, sr)) })
  }
  const trackId = crypto.randomUUID(), clipId = crypto.randomUUID()
  const instrument: TrackInstrument = { type: 'drum', params: { pack: 'synth', pads: slicePads(pitches, slices) } }
  dispatch({ type: 'ADD_TRACK', id: trackId, name: `${clip.name} Slices`, instrument })
  const notes = sliceNotes(spans.slice(0, slices.length), map.secToBeat, pitches, () => crypto.randomUUID())
  dispatch({ type: 'ADD_CLIP', clip: makeMidiClip(trackId, `${clip.name} sliced`, clip.startBeat, clip.durationBeats, { id: clipId, notes }) })
  return { trackId, clipId, slices: slices.length, said: describeSlicing(slices.length, by, o.barBeats) }
}

export interface ConvertOutcome { trackId: string; clipId: string; notes: number; lowConfidence: number; said: string }

/**
 * Hear the clip as notes and write them to a MIDI clip on a new track:
 * Harmony keeps every voice, Melody one line, Drums the attacks as kick,
 * snare and hat. The audio clip stays.
 */
export async function convertToNewTrack(
  clip: AudioClip, buf: BufferLike,
  o: { tempo: number; kind: ConvertKind; sensitivity?: number },
  dispatch: Dispatch,
): Promise<ConvertOutcome> {
  const map = clipMap(clip, buf, o.tempo)
  const sr = buf.sampleRate
  const mono = monoOf(buf)
  const s0 = Math.max(0, Math.floor(map.start * sr)), s1 = Math.min(mono.length, Math.floor(map.end * sr))
  const span = mono.slice(s0, s1)
  const secToBeat = (secInSpan: number) => map.secToBeat(map.start + secInSpan)
  const id = () => crypto.randomUUID()
  let notes: MidiNote[], instrument: TrackInstrument, low = 0
  if (o.kind === 'drums') {
    const hits = detectOnsets(span, sr, o.sensitivity != null ? { sensitivity: o.sensitivity } : {})
    notes = drumNotes(hits, span, sr, secToBeat, id)
    instrument = defaultDrumInstrument()
  } else {
    const r = await audioToNotes(span, sr, { sensitivity: o.sensitivity ?? 0.5 })
    low = r.lowConfidence
    notes = toMidiNotes(o.kind === 'melody' ? melodyOnly(r.notes) : r.notes, secToBeat, id)
    instrument = defaultPolyInstrument()
  }
  const trackId = crypto.randomUUID(), clipId = crypto.randomUUID()
  const label = `${clip.name} ${CONVERT_LABEL[o.kind]}`
  dispatch({ type: 'ADD_TRACK', id: trackId, name: label, instrument })
  dispatch({ type: 'ADD_CLIP', clip: makeMidiClip(trackId, label, clip.startBeat, clip.durationBeats, { id: clipId, notes }) })
  const n = notes.length
  return { trackId, clipId, notes: n, lowConfidence: low, said: `${n} note${n === 1 ? '' : 's'} on a new ${CONVERT_LABEL[o.kind]} track${low ? ` — ${low} uncertain, worth a listen` : ''}` }
}
