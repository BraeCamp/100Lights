// ── Standard MIDI File (.mid / .midi) importer ───────────────────────────────
// A universal composition import: every DAW and notation app exports SMF. It
// carries exactly what maps cleanly onto our DAW — notes, tempo, and time
// signature (including mid-song changes, which ride the tempo map, lib/tempo-map)
// — and by the format's nature contains no audio and no synth patches, so the
// scope is honest: notes in, pick sounds after.
//
// Pure: no React, no Web Audio. Parses the binary SMF with DataView, converts
// ticks→beats (a DAW beat = one quarter note, matching the engine's tempo units).

import {
  defaultProject, defaultPolyInstrument, DEFAULT_TRACK_HEIGHT,
  type DawProject, type DawTrack, type MidiClip, type MidiNote,
} from './daw-types'

export interface MidiImportReport {
  projectName: string
  tempo: number
  timeSignature: string
  tracks: number
  clips: number
  notes: number
  tempoChanges: number
  meterChanges: number
  warnings: string[]
}

const TRACK_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899']

// ── Low-level SMF parse ──────────────────────────────────────────────────────

interface RawNote { pitch: number; onTick: number; offTick: number; velocity: number; channel: number }
interface RawTrack { name: string; notes: RawNote[] }
interface Smf {
  format: number
  division: number          // ticks per quarter note (metrical)
  smpte: boolean
  tracks: RawTrack[]
  tempos: Array<{ tick: number; bpm: number }>
  timeSigs: Array<{ tick: number; num: number; den: number }>
}

/** Variable-length quantity: 7 bits per byte, high bit = continuation. */
function readVarint(dv: DataView, pos: number): [value: number, next: number] {
  let value = 0
  let p = pos
  for (let i = 0; i < 4; i++) {
    const b = dv.getUint8(p++)
    value = (value << 7) | (b & 0x7f)
    if ((b & 0x80) === 0) break
  }
  return [value, p]
}

function readChunk(dv: DataView, pos: number): { id: string; length: number; dataStart: number; next: number } {
  const id = String.fromCharCode(dv.getUint8(pos), dv.getUint8(pos + 1), dv.getUint8(pos + 2), dv.getUint8(pos + 3))
  const length = dv.getUint32(pos + 4)
  return { id, length, dataStart: pos + 8, next: pos + 8 + length }
}

export function parseSmf(buf: ArrayBuffer): Smf {
  const dv = new DataView(buf)
  if (buf.byteLength < 14) throw new Error('That file is too small to be a MIDI file.')
  const head = readChunk(dv, 0)
  if (head.id !== 'MThd') throw new Error('That doesn’t look like a MIDI file (missing MThd header).')
  const format = dv.getUint16(head.dataStart)
  const ntrks = dv.getUint16(head.dataStart + 2)
  const rawDivision = dv.getUint16(head.dataStart + 4)
  const smpte = (rawDivision & 0x8000) !== 0
  // Metrical: ticks per quarter note. SMPTE (frames): approximate as PPQ so notes
  // still land sensibly; flagged in the report by the caller.
  const division = smpte ? 480 : (rawDivision || 480)

  const tracks: RawTrack[] = []
  const tempos: Array<{ tick: number; bpm: number }> = []
  const timeSigs: Array<{ tick: number; num: number; den: number }> = []

  let pos = head.next
  for (let t = 0; t < ntrks && pos + 8 <= buf.byteLength; t++) {
    const chunk = readChunk(dv, pos)
    pos = chunk.next
    if (chunk.id !== 'MTrk') continue // skip unknown chunks

    let p = chunk.dataStart
    const end = Math.min(chunk.dataStart + chunk.length, buf.byteLength)
    let tick = 0
    let runningStatus = 0
    let trackName = ''
    // Open note-ons per (channel,pitch), FIFO so overlapping same-pitch notes pair up.
    const active = new Map<number, RawNote[]>()
    const notes: RawNote[] = []

    // A truncated/malformed final event makes a DataView read throw RangeError;
    // catch it so we keep the notes parsed so far instead of failing the whole file.
    try {
    while (p < end) {
      const [delta, afterDelta] = readVarint(dv, p)
      p = afterDelta
      tick += delta
      let status = dv.getUint8(p)
      if (status & 0x80) { p++; runningStatus = status } // new status byte
      else status = runningStatus                        // running status: reuse
      if (status < 0x80) break // malformed

      if (status === 0xff) {
        // Meta event
        const metaType = dv.getUint8(p++)
        const [len, afterLen] = readVarint(dv, p)
        p = afterLen
        const dataStart = p
        if (metaType === 0x51 && len === 3) {
          const us = (dv.getUint8(dataStart) << 16) | (dv.getUint8(dataStart + 1) << 8) | dv.getUint8(dataStart + 2)
          if (us > 0) tempos.push({ tick, bpm: 60_000_000 / us })
        } else if (metaType === 0x58 && len >= 2) {
          const num = dv.getUint8(dataStart)
          const den = Math.pow(2, dv.getUint8(dataStart + 1))
          if (num >= 1 && den >= 1) timeSigs.push({ tick, num, den })
        } else if (metaType === 0x03 && len > 0) {
          let s = ''
          for (let i = 0; i < len; i++) s += String.fromCharCode(dv.getUint8(dataStart + i))
          if (!trackName) trackName = s.trim()
        }
        p = dataStart + len
        runningStatus = 0 // meta events cancel running status
      } else if (status === 0xf0 || status === 0xf7) {
        // SysEx — skip
        const [len, afterLen] = readVarint(dv, p)
        p = afterLen + len
        runningStatus = 0
      } else {
        const type = status & 0xf0
        const channel = status & 0x0f
        if (type === 0x90 || type === 0x80) {
          const pitch = dv.getUint8(p++)
          const vel = dv.getUint8(p++)
          const key = (channel << 8) | pitch
          if (type === 0x90 && vel > 0) {
            const arr = active.get(key) ?? []
            arr.push({ pitch, onTick: tick, offTick: tick, velocity: vel, channel })
            active.set(key, arr)
          } else {
            // note-off (or note-on vel 0): close the earliest open note of this key
            const arr = active.get(key)
            const n = arr && arr.shift()
            if (n) { n.offTick = tick; notes.push(n) }
          }
        } else if (type === 0xa0 || type === 0xb0 || type === 0xe0) {
          p += 2 // poly-aftertouch / controller / pitch-bend — 2 data bytes, skipped
        } else if (type === 0xc0 || type === 0xd0) {
          p += 1 // program-change / channel-pressure — 1 data byte, skipped
        } else {
          break
        }
      }
    }
    } catch { /* truncated/malformed event — keep the notes parsed so far */ }
    // Close any notes left hanging at track end.
    for (const arr of active.values()) for (const n of arr) { n.offTick = tick; notes.push(n) }
    tracks.push({ name: trackName, notes })
  }

  tempos.sort((a, b) => a.tick - b.tick)
  timeSigs.sort((a, b) => a.tick - b.tick)
  return { format, division, smpte, tracks, tempos, timeSigs }
}

// ── SMF → DawProject ─────────────────────────────────────────────────────────

export async function parseMidiFile(file: File): Promise<{ project: DawProject; report: MidiImportReport }> {
  const smf = parseSmf(await file.arrayBuffer())
  const warnings: string[] = []
  const div = smf.division
  const projectName = file.name.replace(/\.midi?$/i, '') || 'Imported MIDI'

  // Tempo: first event (or 120) is the global; the rest are change markers.
  const bpm0 = smf.tempos[0] && smf.tempos[0].tick < div ? Math.round(smf.tempos[0].bpm) : Math.round(smf.tempos[0]?.bpm ?? 120)
  const tempoChanges = smf.tempos.filter(t => t.tick / div > 0.001)

  // Meter: first event (or 4/4) is the global; the rest are change markers.
  const sig0 = smf.timeSigs.find(s => s.tick / div < 0.001) ?? smf.timeSigs[0] ?? { num: 4, den: 4 }
  const meterChanges = smf.timeSigs.filter(s => s.tick / div > 0.001)

  // Group notes into DAW tracks: one per source track that has notes; if a single
  // track carries several MIDI channels (common in format-0 files), split by
  // channel so drums/bass/keys don't collapse into one track.
  const tracks: DawTrack[] = []
  const arrangementClips: MidiClip[] = []
  let colorIdx = 0
  let clipCount = 0
  let noteCount = 0
  let maxBeat = 0

  for (const rt of smf.tracks) {
    if (rt.notes.length === 0) continue
    const byChannel = new Map<number, RawNote[]>()
    for (const n of rt.notes) {
      const arr = byChannel.get(n.channel) ?? []
      arr.push(n)
      byChannel.set(n.channel, arr)
    }
    const multi = byChannel.size > 1
    for (const [channel, chNotes] of byChannel) {
      const trackId = crypto.randomUUID()
      const baseName = rt.name || 'MIDI'
      const name = multi ? `${baseName} · ch${channel + 1}` : baseName
      tracks.push({
        id: trackId, name,
        type: 'audio',
        color: TRACK_COLORS[colorIdx++ % TRACK_COLORS.length],
        volume: 0.8, pan: 0, mute: false, solo: false, armed: false,
        inputSource: null, height: DEFAULT_TRACK_HEIGHT, effects: [],
        // MIDI carries no synth patch — every track opens on the default synth.
        instrument: defaultPolyInstrument(),
      })

      const notes: MidiNote[] = chNotes
        .map(n => ({
          id: crypto.randomUUID(),
          pitch: Math.max(0, Math.min(127, n.pitch)),
          startBeat: Math.max(0, n.onTick / div),
          durationBeats: Math.max(0.0625, (n.offTick - n.onTick) / div),
          velocity: Math.max(1, Math.min(127, n.velocity)),
        }))
        .sort((a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch)

      const trackEnd = notes.reduce((m, n) => Math.max(m, n.startBeat + n.durationBeats), 0)
      maxBeat = Math.max(maxBeat, trackEnd)
      // One clip per track spanning its content — SMF has no clip boundaries, so a
      // single continuous clip is the faithful representation of the note stream.
      arrangementClips.push({
        kind: 'midi', id: crypto.randomUUID(), trackId, name,
        startBeat: 0, durationBeats: Math.max(1, Math.ceil(trackEnd)),
        notes, isDrumClip: false, presetId: undefined,
      })
      clipCount++
      noteCount += notes.length
    }
  }

  if (tracks.length === 0) warnings.push('No notes were found in that MIDI file.')
  if (smf.smpte) warnings.push('This file uses SMPTE (frame-based) timing — note positions are approximate.')
  if (tracks.length > 0) warnings.push('MIDI carries no sounds — every track opens on the default synth. Pick instruments from the library.')

  const base = defaultProject()
  const project: DawProject = {
    ...base,
    id: crypto.randomUUID(),
    name: projectName,
    tempo: bpm0,
    timeSignatureNum: sig0.num,
    timeSignatureDen: sig0.den,
    tracks,
    arrangementClips,
    loopStart: 0,
    loopEnd: Math.max(16, Math.ceil(maxBeat / 4) * 4),
    loopEnabled: false,
    tempoMarkers: tempoChanges.length
      ? [{ id: crypto.randomUUID(), beat: 0, tempo: bpm0 },
         ...tempoChanges.map(t => ({ id: crypto.randomUUID(), beat: t.tick / div, tempo: Math.round(t.bpm) }))]
      : undefined,
    meterMarkers: meterChanges.length
      ? [{ id: crypto.randomUUID(), beat: 0, num: sig0.num, den: sig0.den },
         ...meterChanges.map(s => ({ id: crypto.randomUUID(), beat: s.tick / div, num: s.num, den: s.den }))]
      : undefined,
  }

  const report: MidiImportReport = {
    projectName,
    tempo: bpm0,
    timeSignature: `${sig0.num}/${sig0.den}`,
    tracks: tracks.length,
    clips: clipCount,
    notes: noteCount,
    tempoChanges: tempoChanges.length,
    meterChanges: meterChanges.length,
    warnings,
  }
  return { project, report }
}
