// Which pitches the piano roll shows, top to bottom — the arithmetic behind
// Live's Fold (F: only the key tracks that have notes), Fold to Scale (G:
// only the notes of the clip's scale, plus any out-of-scale pitch that has
// a note, so nothing hides), Highlight Scale (K: tint the scale, the root
// more so), Focus (N: scroll to where the notes are) and step entry (the
// insert marker that advances by the grid). Pure, so each is a test; the
// roll maps rows to pixels through `rows`.

import type { MidiNote } from './daw-types'

export const CHROMATIC_ROWS = Array.from({ length: 128 }, (_, i) => 127 - i)

export interface RowOptions {
  /** Fold to notes: only pitches the clip uses. */
  fold: boolean
  /** Fold to scale: only pitches in the scale — plus any used pitch, so a note never disappears. */
  foldScale: boolean
  /** Pitch classes (0..11) of the scale, for foldScale. */
  inScale: Set<number>
  notes: Pick<MidiNote, 'pitch'>[]
}

/** The pitches shown, highest first. Never empty: with nothing to show, the chromatic range. */
export function visibleRows(o: RowOptions): number[] {
  if (!o.fold && !o.foldScale) return CHROMATIC_ROWS
  const used = new Set(o.notes.map(n => n.pitch))
  const rows = CHROMATIC_ROWS.filter(p => {
    if (o.fold && o.foldScale) return used.has(p)
    if (o.fold) return used.has(p)
    return o.inScale.has(p % 12) || used.has(p)
  })
  return rows.length ? rows : CHROMATIC_ROWS
}

/** pitch → row index, for the rows given. */
export function rowIndexOf(rows: number[]): Map<number, number> {
  return new Map(rows.map((p, i) => [p, i]))
}

/**
 * The scrollTop that puts the notes in view — their middle at the middle of
 * the viewport, clamped to the content. null when there is nothing to focus.
 */
export function focusScrollTop(rows: number[], notes: Pick<MidiNote, 'pitch'>[], rowH: number, viewH: number): number | null {
  const idx = rowIndexOf(rows)
  const ys = notes.map(n => idx.get(n.pitch)).filter((i): i is number => i != null)
  if (!ys.length) return null
  const top = Math.min(...ys) * rowH, bottom = (Math.max(...ys) + 1) * rowH
  const middle = (top + bottom) / 2
  const max = Math.max(0, rows.length * rowH - viewH)
  return Math.max(0, Math.min(max, middle - viewH / 2))
}

/** Step entry: where the marker lands after a note of `quant` beats — never past the clip. */
export function stepAdvance(stepBeat: number, quant: number, clipBeats: number): number {
  const next = stepBeat + quant
  return next >= clipBeats - 1e-9 ? 0 : next
}

/** ← / → on the insert marker, on the grid, inside the clip. */
export function stepMove(stepBeat: number, dir: 1 | -1, quant: number, clipBeats: number): number {
  const next = Math.round((stepBeat + dir * quant) / quant) * quant
  return Math.max(0, Math.min(Math.max(0, clipBeats - quant), next))
}
