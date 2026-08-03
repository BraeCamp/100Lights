// Standard MIDI File (SMF) reader/writer — enough for real interop:
// reads format 0/1 (merging tracks), honors PPQ and tempo events for
// beat math, and writes a single-track format-0 file from a clip.

import type { MidiNote, DawProject, MidiClip } from './daw-types'
import { isMidiClip } from './daw-types'
import { tempoSegments, meterSegments } from './tempo-map'
import { parseSmf } from './midi-import'

export interface ParsedMidi {
  /** Notes with startBeat/durationBeats in quarter-note beats. */
  notes: Omit<MidiNote, 'id'>[]
  /** First tempo event, if any (BPM). */
  tempo?: number
  name?: string
}

// ── Reading ───────────────────────────────────────────────────────────────────
// Delegates to the one robust SMF tokenizer (parseSmf in midi-import.ts) instead
// of keeping a second, divergent parser. This flattens all tracks into a single
// note list for the single-clip callers (drag-drop onto a lane, ClipView). Because
// parseSmf is SMPTE-tolerant, handles formats 0/1/2, pairs overlapping same-pitch
// notes FIFO, and bounds-guards truncated files, drag-drop now imports the same
// files the Open-button importer does (it previously rejected SMPTE / format 2).

export function parseMidiFile(buf: ArrayBuffer): ParsedMidi {
  const smf = parseSmf(buf)
  const div = smf.division || 480
  const notes: Omit<MidiNote, 'id'>[] = []
  let name: string | undefined
  for (const track of smf.tracks) {
    if (!name && track.name) name = track.name
    for (const n of track.notes) {
      notes.push({
        pitch: n.pitch,
        startBeat: n.onTick / div,
        durationBeats: Math.max(0.05, (n.offTick - n.onTick) / div),
        velocity: n.velocity,
      })
    }
  }
  notes.sort((a, b) => a.startBeat - b.startBeat)
  const tempo = smf.tempos[0] ? Math.round(smf.tempos[0].bpm) : undefined
  return { notes, tempo, name }
}

// ── Writing ───────────────────────────────────────────────────────────────────

function pushVarlen(out: number[], v: number) {
  const bytes = [v & 0x7f]
  v >>= 7
  while (v > 0) { bytes.unshift((v & 0x7f) | 0x80); v >>= 7 }
  out.push(...bytes)
}

/** Writes a single-track format-0 SMF from notes (beats are quarter notes). */
export function writeMidiFile(notes: Array<Pick<MidiNote, 'pitch' | 'startBeat' | 'durationBeats' | 'velocity'>>, tempo = 120, trackName = 'Pattern'): Blob {
  const PPQ = 480
  type Ev = { tick: number; bytes: number[] }
  const evs: Ev[] = []

  // tempo + name
  const us = Math.round(60_000_000 / tempo)
  evs.push({ tick: 0, bytes: [0xff, 0x51, 0x03, (us >> 16) & 0xff, (us >> 8) & 0xff, us & 0xff] })
  const nameBytes = [...trackName.slice(0, 60)].map(c => c.charCodeAt(0) & 0x7f)
  evs.push({ tick: 0, bytes: [0xff, 0x03, nameBytes.length, ...nameBytes] })

  for (const n of notes) {
    const on = Math.max(0, Math.round(n.startBeat * PPQ))
    const off = Math.max(on + 1, Math.round((n.startBeat + n.durationBeats) * PPQ))
    const vel = Math.max(1, Math.min(127, Math.round(n.velocity)))
    const pitch = Math.max(0, Math.min(127, Math.round(n.pitch)))
    evs.push({ tick: on, bytes: [0x90, pitch, vel] })
    evs.push({ tick: off, bytes: [0x80, pitch, 0] })
  }
  evs.sort((a, b) => a.tick - b.tick)

  const body: number[] = []
  let last = 0
  for (const ev of evs) {
    pushVarlen(body, ev.tick - last)
    last = ev.tick
    body.push(...ev.bytes)
  }
  pushVarlen(body, 0)
  body.push(0xff, 0x2f, 0x00) // end of track

  const header = [
    0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, (PPQ >> 8) & 0xff, PPQ & 0xff,
    0x4d, 0x54, 0x72, 0x6b,
    (body.length >> 24) & 0xff, (body.length >> 16) & 0xff, (body.length >> 8) & 0xff, body.length & 0xff,
  ]
  return new Blob([new Uint8Array([...header, ...body])], { type: 'audio/midi' })
}

// ── Whole-project export (format 1, multi-track) ──────────────────────────────

const PROJECT_PPQ = 480
const clamp7 = (n: number) => Math.max(0, Math.min(127, Math.round(n)))
const nameMeta = (s: string): number[] => {
  const b = [...s.slice(0, 60)].map(c => c.charCodeAt(0) & 0x7f)
  return [0xff, 0x03, b.length, ...b]
}
/** Delta-encode sorted events into a complete MTrk chunk (with end-of-track). */
function trackChunk(evs: Array<{ tick: number; bytes: number[] }>): number[] {
  const body: number[] = []
  let last = 0
  for (const ev of evs) { pushVarlen(body, Math.max(0, ev.tick - last)); last = ev.tick; body.push(...ev.bytes) }
  pushVarlen(body, 0); body.push(0xff, 0x2f, 0x00)
  return [
    0x4d, 0x54, 0x72, 0x6b,
    (body.length >> 24) & 0xff, (body.length >> 16) & 0xff, (body.length >> 8) & 0xff, body.length & 0xff,
    ...body,
  ]
}

/**
 * Export the whole project as a multi-track (format 1) Standard MIDI File — the
 * universal interchange other DAWs import cleanly. Track 0 is a conductor track
 * carrying the tempo map + meter map (so mid-song tempo/time-sig changes survive);
 * each MIDI track becomes its own MTrk with absolute note positions. Audio tracks
 * have no note data and are omitted (reported via the count).
 */
export function writeProjectMidi(project: DawProject): { blob: Blob; midiTracks: number; notes: number; audioTracksOmitted: number } {
  const toTick = (beat: number) => Math.max(0, Math.round(beat * PROJECT_PPQ))

  // Conductor track: name + tempo segments + meter segments.
  const meta: Array<{ tick: number; bytes: number[] }> = [{ tick: 0, bytes: nameMeta(project.name || 'Project') }]
  for (const seg of tempoSegments(project)) {
    const us = Math.round(60_000_000 / seg.bpm)
    meta.push({ tick: toTick(seg.beat), bytes: [0xff, 0x51, 0x03, (us >> 16) & 0xff, (us >> 8) & 0xff, us & 0xff] })
  }
  for (const seg of meterSegments(project)) {
    const dd = Math.max(0, Math.round(Math.log2(seg.den))) // SMF stores denominator as its power of 2
    meta.push({ tick: toTick(seg.beat), bytes: [0xff, 0x58, 0x04, Math.max(1, seg.num), dd, 24, 8] })
  }
  meta.sort((a, b) => a.tick - b.tick)
  const chunks: number[][] = [trackChunk(meta)]

  let midiTracks = 0
  let noteCount = 0
  let audioTracksOmitted = 0
  for (const track of project.tracks) {
    const clips = project.arrangementClips.filter(c => isMidiClip(c) && c.trackId === track.id) as MidiClip[]
    if (clips.length === 0) {
      if (project.arrangementClips.some(c => !isMidiClip(c) && c.trackId === track.id)) audioTracksOmitted++
      continue
    }
    // order: at a shared tick, note-offs (order 0) precede note-ons (order 1) so a
    // re-triggered same pitch isn't silenced by its predecessor's off.
    const evs: Array<{ tick: number; bytes: number[]; order: number }> = [{ tick: 0, bytes: nameMeta(track.name || 'Track'), order: 0 }]
    for (const clip of clips) {
      for (const n of clip.notes) {
        const absBeat = clip.startBeat + n.startBeat
        const on = toTick(absBeat)
        const off = Math.max(on + 1, toTick(absBeat + n.durationBeats))
        const pitch = clamp7(n.pitch)
        evs.push({ tick: on, bytes: [0x90, pitch, Math.max(1, clamp7(n.velocity))], order: 1 })
        evs.push({ tick: off, bytes: [0x80, pitch, 0], order: 0 })
        noteCount++
      }
    }
    evs.sort((a, b) => a.tick - b.tick || a.order - b.order)
    chunks.push(trackChunk(evs))
    midiTracks++
  }

  const ntrks = chunks.length
  const header = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, (ntrks >> 8) & 0xff, ntrks & 0xff, (PROJECT_PPQ >> 8) & 0xff, PROJECT_PPQ & 0xff]
  // Flatten without argument-spreading: `out.push(...chunk)` overflows the JS
  // max-arguments limit once a track is large (a few thousand notes), which threw
  // RangeError on exactly the big projects users most want to export.
  const total = header.length + chunks.reduce((n, c) => n + c.length, 0)
  const out = new Uint8Array(total)
  let off = 0
  out.set(header, off); off += header.length
  for (const c of chunks) { out.set(c, off); off += c.length }
  return { blob: new Blob([out], { type: 'audio/midi' }), midiTracks, notes: noteCount, audioTracksOmitted }
}
