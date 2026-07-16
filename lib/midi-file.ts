// Standard MIDI File (SMF) reader/writer — enough for real interop:
// reads format 0/1 (merging tracks), honors PPQ and tempo events for
// beat math, and writes a single-track format-0 file from a clip.

import type { MidiNote } from './daw-types'

export interface ParsedMidi {
  /** Notes with startBeat/durationBeats in quarter-note beats. */
  notes: Omit<MidiNote, 'id'>[]
  /** First tempo event, if any (BPM). */
  tempo?: number
  name?: string
}

// ── Reading ───────────────────────────────────────────────────────────────────

class Reader {
  pos = 0
  private d: DataView
  constructor(d: DataView) { this.d = d }
  u8()  { return this.d.getUint8(this.pos++) }
  u16() { const v = this.d.getUint16(this.pos); this.pos += 2; return v }
  u32() { const v = this.d.getUint32(this.pos); this.pos += 4; return v }
  skip(n: number) { this.pos += n }
  varlen(): number {
    let v = 0
    for (let i = 0; i < 4; i++) {
      const b = this.u8()
      v = (v << 7) | (b & 0x7f)
      if ((b & 0x80) === 0) break
    }
    return v
  }
  str(n: number): string {
    let s = ''
    for (let i = 0; i < n; i++) s += String.fromCharCode(this.u8())
    return s
  }
}

export function parseMidiFile(buf: ArrayBuffer): ParsedMidi {
  const r = new Reader(new DataView(buf))
  if (r.str(4) !== 'MThd') throw new Error('Not a MIDI file')
  const headerLen = r.u32()
  const format = r.u16()
  const nTracks = r.u16()
  const division = r.u16()
  r.skip(headerLen - 6)
  if (division & 0x8000) throw new Error('SMPTE-timed MIDI files are not supported')
  const ppq = division || 480
  if (format > 1) throw new Error('Only MIDI format 0 and 1 are supported')

  const notes: Omit<MidiNote, 'id'>[] = []
  let tempo: number | undefined
  let name: string | undefined

  for (let t = 0; t < nTracks; t++) {
    if (r.str(4) !== 'MTrk') throw new Error('Malformed MIDI track')
    const len = r.u32()
    const end = r.pos + len
    let tick = 0
    let running = 0
    // note-ons awaiting their note-off, keyed by channel<<8|pitch
    const open = new Map<number, { startTick: number; velocity: number }>()

    const closeNote = (key: number, pitch: number, endTick: number) => {
      const o = open.get(key)
      if (!o) return
      open.delete(key)
      notes.push({
        pitch,
        startBeat: o.startTick / ppq,
        durationBeats: Math.max(0.05, (endTick - o.startTick) / ppq),
        velocity: o.velocity,
      })
    }

    while (r.pos < end) {
      tick += r.varlen()
      let status = r.u8()
      if (status < 0x80) { r.pos--; status = running }
      running = status

      if (status === 0xff) {
        const type = r.u8()
        const mlen = r.varlen()
        if (type === 0x51 && mlen === 3) {
          const us = (r.u8() << 16) | (r.u8() << 8) | r.u8()
          tempo ??= Math.round(60_000_000 / us)
        } else if (type === 0x03 && !name) {
          name = r.str(mlen)
        } else {
          r.skip(mlen)
        }
      } else if (status === 0xf0 || status === 0xf7) {
        r.skip(r.varlen())
      } else {
        const kind = status & 0xf0
        const ch = status & 0x0f
        if (kind === 0x90) {
          const pitch = r.u8(), vel = r.u8()
          const key = (ch << 8) | pitch
          if (vel === 0) closeNote(key, pitch, tick)
          else {
            closeNote(key, pitch, tick)  // retrigger without off
            open.set(key, { startTick: tick, velocity: vel })
          }
        } else if (kind === 0x80) {
          const pitch = r.u8(); r.u8()
          closeNote((ch << 8) | pitch, pitch, tick)
        } else if (kind === 0xc0 || kind === 0xd0) {
          r.skip(1)
        } else {
          r.skip(2)
        }
      }
    }
    // close any dangling notes at track end
    for (const [key, o] of open) {
      const pitch = key & 0xff
      notes.push({ pitch, startBeat: o.startTick / ppq, durationBeats: Math.max(0.05, (tick - o.startTick) / ppq), velocity: o.velocity })
    }
    r.pos = end
  }

  notes.sort((a, b) => a.startBeat - b.startBeat)
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
