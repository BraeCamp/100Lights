// Single source of truth for the studio's DRAWN-GRAPH system — every place the
// user sketches a curve instead of setting a slider. Centralised here so a
// change to the drawing system propagates everywhere at once:
//
//  - `GRAPH_AREAS` is the registry of every drawable area (label, default shape,
//    axis captions, which drawing primitive it uses). Add/retune an area here
//    and the shared <DrawnGraphModal> + Sound-panel presentation pick it up.
//  - `MotionCurve` (the freehand primitive) is what the 'motion' areas render;
//    changing it changes all of them. 'eq' / 'pitch' areas use their own
//    editors (EqCurve / PitchGraphEditor) — mapped here so the whole system is
//    visible in one file even where the primitive differs.
//  - The drawn-graph suite is its own UI dimension (see UITierProvider `graphs`
//    + UITierSwitcher). GRAPHS_LS_KEY / isGraphsOn live here so the toggle and
//    its persistence agree.

import type { AutoPoint } from './daw-types'

// The accent used across every drawn graph (kept here so recolouring the whole
// system is one edit).
export const GRAPH_COLOR = 'var(--accent-light)'

// ── the UI dimension ────────────────────────────────────────────────────────
export const GRAPHS_LS_KEY = '100lights-ui-graphs'
export const isGraphsOn = (v: unknown): v is boolean => v === true || v === false

// ── the registry ────────────────────────────────────────────────────────────
export type GraphEditor = 'motion' | 'eq' | 'pitch'

/** The freehand curve (0..1) areas, opened in the shared <DrawnGraphModal>. */
export type MotionAreaId = 'amplitude' | 'lfo' | 'pitch' | 'volume' | 'groove' | 'fxmotion'

export interface GraphAreaDef {
  id: MotionAreaId
  label: string                       // section header (UPPERCASE)
  short: string                       // compact display name (chips / menu / modal title)
  onLabel: string                     // button text to turn it on (e.g. '◠ Draw', '+ Add')
  offLabel: string                    // button text to turn it off (e.g. 'Sliders', 'Sine', 'Off', 'Remove')
  onTitle: string
  offTitle: string
  height: number
  /** Bottom caption(s): 3 = left/centre/right, 1 = centred, 0 = none (custom children). */
  axis: string[]
  /** A fresh default curve (unique point ids each call). */
  defaultCurve: () => AutoPoint[]
}

// Unique-id helper so two defaults created in one render never collide.
let _pid = 0
const P = (t: number, v: number): AutoPoint => ({ id: `dg${_pid++}`, t, v, smooth: false, h1: [0, 0], h2: [0, 0] })

export const GRAPH_AREAS: Record<MotionAreaId, GraphAreaDef> = {
  amplitude: {
    id: 'amplitude', label: 'AMPLITUDE', short: 'Amplitude', onLabel: '◠ Draw', offLabel: 'Sliders',
    onTitle: "Draw the note's volume shape", offTitle: 'Back to attack/decay/sustain sliders',
    height: 78, axis: ['note start', 'volume shape · per note · scaled by velocity', 'end'],
    defaultCurve: () => [P(0, 0), P(0.08, 1), P(0.6, 0.75), P(1, 0)],
  },
  lfo: {
    id: 'lfo', label: 'LFO SHAPE', short: 'LFO', onLabel: '◠ Draw', offLabel: 'Sine',
    onTitle: 'Draw a custom LFO waveform', offTitle: 'Back to a sine LFO',
    height: 68, axis: ['one cycle · drives tremolo · auto-pan · wah · vibrato'],
    defaultCurve: () => [P(0, 1), P(1, 0)],
  },
  pitch: {
    id: 'pitch', label: 'PITCH', short: 'Pitch', onLabel: '◠ Draw', offLabel: 'Off',
    onTitle: 'Draw a per-note pitch bend', offTitle: 'Remove pitch contour',
    height: 78, axis: ['−12 st', 'middle line = in tune · per note', '+12 st'],
    defaultCurve: () => [P(0, 0.4), P(0.12, 0.5), P(1, 0.5)],
  },
  volume: {
    id: 'volume', label: 'VOLUME', short: 'Volume', onLabel: '◠ Draw', offLabel: 'Off',
    onTitle: "Draw the clip's volume over time", offTitle: 'Remove volume automation',
    height: 72, axis: ['loudness across the clip · top = full'],
    defaultCurve: () => [P(0, 1), P(1, 0)],
  },
  groove: {
    id: 'groove', label: 'GROOVE', short: 'Groove', onLabel: '◠ Draw', offLabel: 'Off',
    onTitle: 'Draw the timing feel (push/pull) across a bar', offTitle: 'Remove groove',
    height: 68, axis: ['bar start', 'middle = on the grid · up = laid-back · down = pushed', 'end'],
    defaultCurve: () => [P(0, 0.5), P(1, 0.5)],
  },
  fxmotion: {
    id: 'fxmotion', label: 'FX MOTION', short: 'FX Motion', onLabel: '+ Add', offLabel: 'Remove',
    onTitle: 'Add an FX motion curve', offTitle: 'Remove FX motion',
    height: 88, axis: [],   // custom children (per-note toggle + fx picker)
    defaultCurve: () => [P(0, 1), P(1, 0)],
  },
}

/** Default for a per-slider ◠ graph (a single FX control drawn over the clip). */
export const defaultFieldGraph = (): AutoPoint[] => [P(0, 1), P(1, 0)]

// ── the whole map (incl. the non-'motion' editors) ──────────────────────────
// Lets one place describe every drawn surface in the studio, even where the
// drawing primitive differs. Used for docs/discovery; gating of the motion
// suite is via the `graphs` UI dimension.
export const DRAWN_SURFACES: { id: string; label: string; editor: GraphEditor; where: string }[] = [
  ...Object.values(GRAPH_AREAS).map(a => ({ id: a.id, label: a.label, editor: 'motion' as const, where: 'clip Sound panel' })),
  { id: 'fxparam', label: 'Per-slider FX curve (◠)', editor: 'motion', where: 'clip Sound panel · FX sliders' },
  { id: 'eq', label: 'EQ curve', editor: 'eq', where: 'Mixer / track tone' },
  { id: 'pitchgraph', label: 'Pitch→amount graph', editor: 'pitch', where: 'Preset creator' },
]
