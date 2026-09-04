// Naming notes inside a clip, out loud — and telling when a chord plays.
//
// Brae: "I asked Light to recreate the first chord in a chord progression and
// it gave me every note in the track item. Fixing that for note level
// addressing so that it can tell when chords play would be ideal."
//
// ⚠️ THE RECORD, 23:37: "What is the chord, the 1st chord in pad intro, about
// a 2nd into it?" → fourteen notes, every note in the clip, "that's E". The
// clip had a whole progression in it and nothing could name a part of it.
//
// A chord is a moment when two or more notes START together — within a fifth
// of a beat, because a strummed or slightly humanised chord is still one chord,
// and an arpeggio (a note every quarter beat) is not. The chords of a clip are
// those moments in order. A chord lasts until the next chord starts, or until
// its last note stops, whichever is sooner — a melody note in between does not
// end it.

import type { MidiNote } from './daw-types'

export interface Chord { n: number; startBeat: number; endBeat: number; notes: MidiNote[] }

/** How far apart two onsets can be and still be one chord, in beats. */
export const CHORD_TOLERANCE = 0.2

export function chordsOf(notes: MidiNote[], tol = CHORD_TOLERANCE): Chord[] {
  const sorted = [...notes].sort((a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch)
  const clusters: MidiNote[][] = []
  for (const n of sorted) {
    const last = clusters[clusters.length - 1]
    if (last && n.startBeat - last[0].startBeat <= tol + 1e-9) last.push(n)
    else clusters.push([n])
  }
  const chords = clusters.filter(c => c.length >= 2)
  return chords.map((c, i) => {
    const start = c[0].startBeat
    // Held for as long as its longest note, measured from the chord's own
    // start — a strummed note's few hundredths do not stretch the chord.
    const held = start + Math.max(...c.map(n => n.durationBeats))
    const next = chords[i + 1]?.[0].startBeat ?? Infinity
    return { n: i + 1, startBeat: start, endBeat: Math.max(start + 0.25, Math.min(held, next)), notes: c }
  })
}

export interface NoteAddress {
  /** Which chord: 1-based by order, first/last, or every chord. */
  chord?: number | 'first' | 'last' | 'all'
  /** "the first two chords" — how many from the one named. */
  count?: number
  /** Which note: 1-based by onset order, first/last, highest/lowest. */
  note?: number | 'first' | 'last' | 'highest' | 'lowest' | 'all'
  /** Only notes strictly above / below this MIDI pitch. */
  above?: number
  below?: number
  /** Only notes of this pitch class (0 = C) — "every C", "the Cs". */
  pitchClass?: number
  /** Only notes starting in [from, to), beats relative to the clip. */
  from?: number
  to?: number
  /** Only notes sounding at this beat, relative to the clip. */
  at?: number
}

const ORDINALS: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
  eleventh: 11, twelfth: 12,
}
const COUNTS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 }
const ORD_RE = '(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|last|opening|top|bottom|highest|lowest|\\d{1,2}(?:st|nd|rd|th))'

/** "C#4", "E flat 3", "c" → MIDI pitch; without an octave, octave 4. */
export function pitchOf(said: string): { pitch: number; hadOctave: boolean } | null {
  const t = String(said ?? '').toLowerCase().trim()
    .replace(/\bsharp\b/g, '#').replace(/\bflat\b/g, 'b').replace(/\s+/g, '')
  const m = /^([a-g])(#|b)?(-?\d)?$/.exec(t)
  if (!m) return null
  const base = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }[m[1]]
  if (base == null) return null
  const accidental = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0
  const octave = m[3] != null ? Number(m[3]) : 4
  const pitch = (octave + 1) * 12 + base + accidental
  return pitch >= 0 && pitch <= 127 ? { pitch, hadOctave: m[3] != null } : null
}

export interface ParsedNoteAddress {
  addr: NoteAddress
  /** A place said in song terms ("bar 3", "the chorus") for the planner to resolve. */
  atSaid?: string
  fromSaid?: string
  toSaid?: string
  /** "about a second into it" — seconds from the clip's start. */
  atSeconds?: number
  /** What was understood, for the read-back. */
  label: string
}

/**
 * Read a spoken note address. Null when the words name no part of a clip —
 * a whole-clip command stays a whole-clip command.
 *
 *   "the first chord"            → chord 1
 *   "the third chord"            → chord 3
 *   "the last chord"             → chord last
 *   "chord 2" / "chord number 2" → chord 2
 *   "the first two chords"       → chord 1, count 2
 *   "the second note"            → note 2
 *   "the highest note"           → note highest
 *   "the notes above C5"         → above 72
 *   "the notes below C3"         → below 48
 *   "every C" / "all the Cs"     → pitchClass 0
 *   "the chord at bar 3"         → chord at "bar 3"
 *   "the notes in bar 2"         → from "bar 2" to "bar 3"
 *   "the chord about a second in"→ chord at 1 s
 */
export function parseNoteAddress(spoken: string): ParsedNoteAddress | null {
  let s = String(spoken ?? '').toLowerCase().replace(/[.,!?]+$/, '').replace(/\s+/g, ' ').trim()
  if (!s) return null
  const addr: NoteAddress = {}
  const labels: string[] = []
  let atSaid: string | undefined
  let fromSaid: string | undefined
  let toSaid: string | undefined
  let atSeconds: number | undefined

  // Places inside the clip.
  const secM = /\b(?:about|around|roughly|at)?\s*(a|an|one|two|three|four|half a|\d+(?:\.\d+)?)\s+(?:seconds?|secs?|s)\s+(?:in|into|from the start|after the start)\b(?:\s+(?:it|the clip|the part))?/.exec(s)
  if (secM) {
    atSeconds = secM[1] === 'a' || secM[1] === 'an' || secM[1] === 'one' ? 1 : secM[1] === 'half a' ? 0.5 : (COUNTS[secM[1]] ?? Number(secM[1]))
    s = s.replace(secM[0], ' ')
  }
  const betweenM = /\b(?:between|from)\s+(?:bars?|measures?)?\s*(\d{1,3})\s+(?:and|to)\s+(?:bars?|measures?)?\s*(\d{1,3})\b/.exec(s)
  if (betweenM) { fromSaid = `bar ${betweenM[1]}`; toSaid = `bar ${betweenM[2]}`; s = s.replace(betweenM[0], ' ') }
  const inBarM = /\b(?:in|inside|within|during)\s+(?:bar|measure)\s+(\d{1,3})\b/.exec(s)
  if (inBarM && !fromSaid) { fromSaid = `bar ${inBarM[1]}`; toSaid = `bar ${Number(inBarM[1]) + 1}`; s = s.replace(inBarM[0], ' ') }
  const atM = /\b(?:at|on|around)\s+((?:bar|measure)\s+\d{1,3}(?:\s+beat\s+\d)?|beat\s+\d{1,2})\b/.exec(s)
  if (atM) { atSaid = atM[1]; s = s.replace(atM[0], ' ') }

  // Pitch windows.
  const aboveM = /\b(?:above|over|higher than|from)\s+([a-g](?:\s?(?:sharp|flat|#|b))?\s?-?\d?)\b(?:\s+(?:up|upwards|and up|and above))?/.exec(s)
  if (aboveM) { const p = pitchOf(aboveM[1]); if (p) { addr.above = p.pitch - (/\bfrom\b|and up|and above/.test(aboveM[0]) ? 1 : 0); labels.push(`above ${aboveM[1].toUpperCase()}`); s = s.replace(aboveM[0], ' ') } }
  const belowM = /\b(?:below|under|lower than|beneath)\s+([a-g](?:\s?(?:sharp|flat|#|b))?\s?-?\d?)\b(?:\s+(?:down|downwards|and down|and below))?/.exec(s)
  if (belowM) { const p = pitchOf(belowM[1]); if (p) { addr.below = p.pitch + (/and down|and below/.test(belowM[0]) ? 1 : 0); labels.push(`below ${belowM[1].toUpperCase()}`); s = s.replace(belowM[0], ' ') } }
  const everyM = /\b(?:every|each|all the|all of the)\s+([a-g](?:\s?(?:sharp|flat|#))?)(?:s|'s|\s+notes)?\b/.exec(s)
    ?? /\bthe\s+([a-g](?:\s?(?:sharp|flat|#))?)(?:s|'s|\s+notes)\b/.exec(s)
  if (everyM) { const p = pitchOf(everyM[1]); if (p) { addr.pitchClass = ((p.pitch % 12) + 12) % 12; labels.push(`every ${everyM[1].toUpperCase().replace(/\s+/g, '')}`); s = s.replace(everyM[0], ' ') } }

  // Chords.
  const chordOrdM = new RegExp(`\\b(?:the\\s+)?${ORD_RE}\\s+(one|two|three|four|five|six|\\d)?\\s*chords?\\b`).exec(s)
  const chordNumM = /\bchord\s+(?:number\s+|#)?(\d{1,2})\b/.exec(s)
  const chordAllM = /\b(?:every|all the|all of the|each|all)\s+chords?\b|\bthe chords\b/.exec(s)
  const chordBareM = /\b(?:the\s+)?chord\b/.exec(s)
  if (chordOrdM) {
    const w = chordOrdM[1]
    addr.chord = w === 'last' ? 'last' : w === 'opening' ? 1 : (ORDINALS[w] ?? Number(w.replace(/\D/g, '')))
    if (chordOrdM[2]) { addr.count = COUNTS[chordOrdM[2]] ?? Number(chordOrdM[2]); labels.push(`the ${w} ${chordOrdM[2]} chords`) }
    else labels.push(`the ${w} chord`)
  } else if (chordNumM) { addr.chord = Number(chordNumM[1]); labels.push(`chord ${chordNumM[1]}`) }
  else if (chordAllM) { addr.chord = 'all'; labels.push('the chords') }
  else if (chordBareM && (atSaid || atSeconds != null)) { addr.chord = 'first'; labels.push('the chord') }

  // Notes.
  if (addr.chord == null) {
    const noteOrdM = new RegExp(`\\b(?:the\\s+)?${ORD_RE}\\s+(?:(one|two|three|four|five|six|\\d)\\s+)?notes?\\b`).exec(s)
    const noteNumM = /\bnote\s+(?:number\s+|#)?(\d{1,3})\b/.exec(s)
    if (noteOrdM) {
      const w = noteOrdM[1]
      addr.note = w === 'last' ? 'last' : w === 'highest' || w === 'top' ? 'highest' : w === 'lowest' || w === 'bottom' ? 'lowest' : w === 'opening' ? 1 : (ORDINALS[w] ?? Number(w.replace(/\D/g, '')))
      if (noteOrdM[2]) { addr.count = COUNTS[noteOrdM[2]] ?? Number(noteOrdM[2]); labels.push(`the ${w} ${noteOrdM[2]} notes`) }
      else labels.push(`the ${w} note`)
    } else if (noteNumM) { addr.note = Number(noteNumM[1]); labels.push(`note ${noteNumM[1]}`) }
  }

  const anything = addr.chord != null || addr.note != null || addr.above != null || addr.below != null
    || addr.pitchClass != null || atSaid || fromSaid || atSeconds != null
  if (!anything) return null
  if (!labels.length) labels.push(atSaid ? `the notes at ${atSaid}` : fromSaid ? `the notes from ${fromSaid}` : 'those notes')
  return { addr, atSaid, fromSaid, toSaid, atSeconds, label: labels.join(' ') }
}

export interface PickedNotes {
  notes: MidiNote[]
  /** The moment those notes occupy, relative to the clip — a chord's span, or the earliest onset to the latest end. */
  startBeat: number
  endBeat: number
  /** The chord(s) picked, when a chord was named. */
  chords?: Chord[]
}

/** The notes an address names, in onset order. Empty when it names nothing. */
export function addressNotes(all: MidiNote[], addr: NoteAddress): PickedNotes {
  let pool = [...all].sort((a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch)
  let chords: Chord[] | undefined
  if (addr.at != null) pool = pool.filter(n => n.startBeat <= addr.at! + 1e-6 && n.startBeat + n.durationBeats > addr.at! + 1e-6)
  if (addr.from != null) pool = pool.filter(n => n.startBeat >= addr.from! - 1e-6)
  if (addr.to != null) pool = pool.filter(n => n.startBeat < addr.to! - 1e-6)
  if (addr.chord != null) {
    // "The chord at bar 3": whatever is sounding there, as one chord — a
    // bass note held from earlier is part of what is heard at that moment.
    const list = addr.at != null && addr.chord !== 'all' && pool.length >= 2
      ? [{ n: 1, startBeat: Math.min(...pool.map(n => n.startBeat)), endBeat: Math.min(...pool.map(n => n.startBeat + n.durationBeats)), notes: pool }]
      : chordsOf(pool)
    const w = addr.chord
    const count = Math.max(1, addr.count ?? 1)
    chords = w === 'all' ? list
      : w === 'first' ? list.slice(0, count)
        : w === 'last' ? list.slice(-count)
          : list.slice(w - 1, w - 1 + count)
    pool = chords.flatMap(c => c.notes)
  }
  if (addr.above != null) pool = pool.filter(n => n.pitch > addr.above!)
  if (addr.below != null) pool = pool.filter(n => n.pitch < addr.below!)
  if (addr.pitchClass != null) pool = pool.filter(n => ((n.pitch % 12) + 12) % 12 === addr.pitchClass)
  if (addr.note != null && addr.note !== 'all') {
    const w = addr.note
    const count = Math.max(1, addr.count ?? 1)
    if (w === 'highest') pool = [...pool].sort((a, b) => b.pitch - a.pitch).slice(0, count)
    else if (w === 'lowest') pool = [...pool].sort((a, b) => a.pitch - b.pitch).slice(0, count)
    else if (w === 'first') pool = pool.slice(0, count)
    else if (w === 'last') pool = pool.slice(-count)
    else pool = pool.slice(w - 1, w - 1 + count)
  }
  const start = pool.length ? Math.min(...pool.map(n => n.startBeat)) : 0
  const end = chords?.length
    ? Math.max(...chords.map(c => c.endBeat))
    : pool.length ? Math.max(...pool.map(n => n.startBeat + n.durationBeats)) : 0
  return { notes: pool, startBeat: start, endBeat: end, chords }
}
