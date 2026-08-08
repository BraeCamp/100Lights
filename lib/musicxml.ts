// ── MusicXML reader ──────────────────────────────────────────────────────────
// Parses MusicXML (.xml / .musicxml) and compressed .mxl into the same
// `ParsedMidi` shape the SMF importer produces (notes in quarter-note beats), so
// sheet music exported from MuseScore/Finale/Sibelius/etc. imports exactly like a
// MIDI file — no recognition needed, it's already structured. Handles multi-part
// (flattened like the MIDI reader), chords, rests, backup/forward (multi-voice /
// multi-staff cursor), mid-piece divisions changes, ties (merged), and tempo.

import type { MidiNote } from './daw-types'
import type { ParsedMidi } from './midi-file'

const STEP_SEMI: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

const num = (el: Element | null, tag: string, def = 0): number => {
  const t = el?.querySelector(tag)?.textContent
  const n = t != null ? Number(t) : NaN
  return Number.isFinite(n) ? n : def
}

/** Parse a MusicXML document string into notes (quarter-note beats). */
export function parseMusicXmlText(xml: string): ParsedMidi {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (doc.querySelector('parsererror')) throw new Error('Not valid MusicXML')
  const scoreName = doc.querySelector('work > work-title, movement-title')?.textContent?.trim() || undefined
  const notes: Omit<MidiNote, 'id'>[] = []
  let tempo: number | undefined

  // score-partwise: <part> → <measure> → children in document order.
  const parts = Array.from(doc.querySelectorAll('score-partwise > part, part'))
  for (const part of parts) {
    let divisions = 1            // divisions per quarter note (from <attributes>)
    let partTime = 0             // beats accumulated at the start of the current measure
    let cursor = 0               // beats from part start (measure cursor)
    let prevStart = 0            // onset of the last non-chord note (for <chord/>)
    let prevDur = 0
    // Open ties keyed by pitch, so a tie-stop extends the tie-start note.
    const openTies = new Map<number, Omit<MidiNote, 'id'>>()

    const measures = Array.from(part.querySelectorAll(':scope > measure'))
    for (const measure of measures) {
      cursor = partTime
      let measureMax = partTime   // furthest the cursor reached (fallback measure length)

      for (const el of Array.from(measure.children)) {
        const tag = el.tagName
        if (tag === 'attributes') {
          const d = el.querySelector('divisions')?.textContent
          if (d) divisions = Number(d) || divisions
        } else if (tag === 'sound' && el.getAttribute('tempo')) {
          if (tempo == null) tempo = Math.round(Number(el.getAttribute('tempo')))
        } else if (tag === 'direction') {
          const mm = el.querySelector('metronome > per-minute')?.textContent
          const snd = el.querySelector('sound[tempo]')?.getAttribute('tempo')
          if (tempo == null && (mm || snd)) tempo = Math.round(Number(mm || snd))
        } else if (tag === 'backup') {
          cursor -= num(el, 'duration') / divisions
        } else if (tag === 'forward') {
          cursor += num(el, 'duration') / divisions
          measureMax = Math.max(measureMax, cursor)
        } else if (tag === 'note') {
          const durBeats = num(el, 'duration') / divisions
          const isChord = !!el.querySelector(':scope > chord')
          const isRest = !!el.querySelector(':scope > rest')
          const start = isChord ? prevStart : cursor
          if (!isRest) {
            const p = el.querySelector('pitch')
            if (p) {
              const step = p.querySelector('step')?.textContent ?? 'C'
              const octave = Number(p.querySelector('octave')?.textContent ?? 4)
              const alter = Number(p.querySelector('alter')?.textContent ?? 0)
              const pitch = 12 * (octave + 1) + (STEP_SEMI[step] ?? 0) + alter
              const tieEls = Array.from(el.querySelectorAll(':scope > tie'))
              const tieStart = tieEls.some(t => t.getAttribute('type') === 'start')
              const tieStop = tieEls.some(t => t.getAttribute('type') === 'stop')
              const held = openTies.get(pitch)
              if (tieStop && held) {                       // extend the tied note
                held.durationBeats += Math.max(0, durBeats)
                if (!tieStart) openTies.delete(pitch)
              } else {
                const note: Omit<MidiNote, 'id'> = {
                  pitch,
                  startBeat: +start.toFixed(4),
                  durationBeats: Math.max(0.05, +durBeats.toFixed(4)),
                  velocity: 90,
                }
                notes.push(note)
                if (tieStart) openTies.set(pitch, note)
              }
            }
          }
          if (!isChord) { prevStart = start; prevDur = durBeats; cursor += durBeats }
          else prevDur = Math.max(prevDur, durBeats)
          measureMax = Math.max(measureMax, cursor)
        }
      }
      // Advance to the next measure by the time signature length if present,
      // else by how far the cursor actually reached.
      const time = measure.querySelector('attributes > time, time')
      let measureBeats = 0
      if (time) {
        const beats = num(time, 'beats', 0)
        const beatType = num(time, 'beat-type', 4)
        if (beats && beatType) measureBeats = beats * (4 / beatType)
      }
      partTime = measureBeats > 0 ? partTime + measureBeats : measureMax
    }
  }

  notes.sort((a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch)
  return { notes, tempo, name: scoreName }
}

/** Parse a MusicXML file: plain .xml/.musicxml text or a compressed .mxl (zip). */
export async function parseMusicXml(buf: ArrayBuffer, filename = ''): Promise<ParsedMidi> {
  const looksZip = filename.toLowerCase().endsWith('.mxl') ||
    (new Uint8Array(buf.slice(0, 2))[0] === 0x50 && new Uint8Array(buf.slice(0, 2))[1] === 0x4b) // 'PK'
  if (looksZip) {
    const JSZip = (await import('jszip')).default
    const zip = await JSZip.loadAsync(buf)
    // The container points at the root score; fall back to the first non-META xml.
    let rootPath: string | undefined
    const container = zip.file('META-INF/container.xml')
    if (container) {
      const cx = await container.async('string')
      rootPath = new DOMParser().parseFromString(cx, 'application/xml')
        .querySelector('rootfile')?.getAttribute('full-path') || undefined
    }
    const entry = (rootPath && zip.file(rootPath)) ||
      zip.file(/^(?!META-INF).*\.(musicxml|xml)$/i)[0]
    if (!entry) throw new Error('No MusicXML found inside the .mxl archive')
    return parseMusicXmlText(await entry.async('string'))
  }
  return parseMusicXmlText(new TextDecoder().decode(buf))
}
