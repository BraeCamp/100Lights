// Quantize, with settings — Live's Quantize dialog (⇧⌘U) and its ⌘U.
//
// The roll always had a Q that snapped starts to the editor grid. Live's
// quantize has four decisions: the GRID (any note value, straight or
// triplet), WHAT moves (the start, the end, or both), how FAR it moves
// (Amount, a percentage — 50 % tightens a performance without flattening
// it), and whether the grid follows the editor's or is its own. The
// settings live in a module store (the lib/perf-mode pattern) persisted in
// the workspace, so Q, the palette, the dialog and the voice path all
// quantise the same way, and the way you set it last is the way it stays.
//
// ⚠️ A triplet grid is two thirds of the note value — an eighth triplet is
// 1/3 of a beat — not a value of its own. The old voice planner multiplied
// by 3/2 and put swung parts onto a grid that does not exist.

import { useSyncExternalStore } from 'react'
import { readWorkspace, writeWorkspace } from './editor-workspace'
import type { MidiNote } from './daw-types'
import { MIN_NOTE_BEATS, type NotePatch } from './pitch-time'

export type QuantizeTarget = 'start' | 'end' | 'both'

// A type alias, not an interface: the workspace writer wants a Record.
export type QuantizeSettings = {
  /** Grid in beats (1 = a quarter note); null follows the editor's grid. */
  grid: number | null
  triplet: boolean
  target: QuantizeTarget
  /** Percent of the way to the grid, 0–100. */
  amount: number
}

export const DEFAULT_QUANTIZE: QuantizeSettings = { grid: null, triplet: false, target: 'start', amount: 100 }

export const QUANTIZE_GRIDS: { label: string; beats: number }[] = [
  { label: '1/4', beats: 1 }, { label: '1/8', beats: 0.5 }, { label: '1/16', beats: 0.25 }, { label: '1/32', beats: 0.125 },
]

/** The grid actually snapped to: a triplet is two thirds of the value. */
export const effectiveGrid = (grid: number, triplet: boolean): number => (triplet ? (grid * 2) / 3 : grid)

const round = (b: number) => Math.round(b * 1e6) / 1e6
const snapTo = (t: number, g: number) => round(Math.round(t / g) * g)

/**
 * The patches that quantise `notes` under `s`. `editorGrid` stands in when
 * the settings follow the editor. Starts keep their length; an end that
 * would land on or before the start goes to the next line instead, so a
 * note never collapses; both snaps the start first and the end after it.
 */
export function quantizeNotes(notes: MidiNote[], s: QuantizeSettings, editorGrid: number): NotePatch[] {
  const g = effectiveGrid(s.grid ?? editorGrid, s.triplet)
  if (!(g > 0)) return []
  const a = Math.max(0, Math.min(100, s.amount)) / 100
  if (a <= 0) return []
  const out: NotePatch[] = []
  for (const n of notes) {
    let start = n.startBeat
    let end = n.startBeat + n.durationBeats
    if (s.target === 'start' || s.target === 'both') {
      start = Math.max(0, round(n.startBeat + (snapTo(n.startBeat, g) - n.startBeat) * a))
      if (s.target === 'start') end = start + n.durationBeats
    }
    if (s.target === 'end' || s.target === 'both') {
      let snappedEnd = snapTo(end, g)
      // Would collapse the note: the next grid LINE after the start instead.
      if (snappedEnd <= start + 1e-6) snappedEnd = round(Math.floor(start / g + 1 + 1e-9) * g)
      end = round(end + (snappedEnd - end) * a)
    }
    const patch: Partial<MidiNote> = {}
    if (Math.abs(start - n.startBeat) > 1e-6) patch.startBeat = start
    const dur = Math.max(MIN_NOTE_BEATS, round(end - start))
    if (Math.abs(dur - n.durationBeats) > 1e-6) patch.durationBeats = dur
    if (Object.keys(patch).length) out.push({ id: n.id, patch })
  }
  return out
}

export function gridLabel(beats: number, triplet = false): string {
  const hit = QUANTIZE_GRIDS.find(q => Math.abs(q.beats - beats) < 1e-9)
  const base = hit ? hit.label : `${+beats.toFixed(3)} beat${beats === 1 ? '' : 's'}`
  return triplet ? `${base}T` : base
}

/** "1/16 triplets · starts · 50 %" — the settings in words. */
export function describeQuantize(s: QuantizeSettings, editorGrid: number): string {
  const grid = s.grid == null ? `${gridLabel(editorGrid)} (the editor's grid)` : gridLabel(s.grid)
  const what = s.target === 'start' ? 'starts' : s.target === 'end' ? 'ends' : 'starts and ends'
  return `${grid}${s.triplet ? ' triplets' : ''} · ${what} · ${Math.round(s.amount)} %`
}

/**
 * A grid the way it is said: "eighth notes", "eighth-note triplets", "1/16",
 * "sixteenth triplets", "quarter", "thirty-second". Null when nothing names one.
 */
export function parseGridSaid(said: string): { grid: number; triplet: boolean } | null {
  const t = said.toLowerCase()
  const triplet = /\btriplets?\b|\btrip\b/.test(t)
  const grid = /thirty[- ]second|1\/32|32nd/.test(t) ? 0.125
    : /sixteenth|1\/16|16th/.test(t) ? 0.25
      : /eighth|1\/8|8th/.test(t) ? 0.5
        : /quarter|1\/4|\bbeat\b/.test(t) ? 1
          : /\bhalf\b|1\/2/.test(t) ? 2
            : null
  if (grid == null) return triplet ? { grid: 0.5, triplet } : null
  return { grid, triplet }
}

// ── The store ────────────────────────────────────────────────────────────────

let state: QuantizeSettings = DEFAULT_QUANTIZE
let loaded = false
const listeners = new Set<() => void>()

function load() {
  if (loaded || typeof window === 'undefined') return
  loaded = true
  const saved = readWorkspace<Partial<QuantizeSettings>>('quantize', {})
  state = {
    grid: typeof saved.grid === 'number' && saved.grid > 0 ? saved.grid : null,
    triplet: saved.triplet === true,
    target: saved.target === 'end' || saved.target === 'both' ? saved.target : 'start',
    amount: typeof saved.amount === 'number' ? Math.max(0, Math.min(100, saved.amount)) : 100,
  }
}
function emit() { for (const l of listeners) l() }

export function quantizeSettings(): QuantizeSettings { load(); return state }
export function setQuantizeSettings(patch: Partial<QuantizeSettings>): QuantizeSettings {
  load()
  state = { ...state, ...patch }
  writeWorkspace('quantize', state)
  emit()
  return state
}
function subscribe(cb: () => void) { listeners.add(cb); return () => { listeners.delete(cb) } }
/** Reactive quantize settings. SSR-safe. */
export function useQuantizeSettings(): QuantizeSettings { return useSyncExternalStore(subscribe, quantizeSettings, () => DEFAULT_QUANTIZE) }
