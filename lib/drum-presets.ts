// Built-in drum kits and beat patterns for the step sequencer.
//
// A "kit" is just a drum TrackInstrument config (which pack + per-pad tuning) —
// the same thing a piano preset is for melodic tracks, so applying a kit is a
// SET_INSTRUMENT. A "pattern" is a grid of hits (lane → step indices) that gets
// materialised into a drum clip's MidiNotes. Both are picked from the sequencer
// panel. The canonical lane list here is the single source of truth for
// lane → GM pitch (the piano-roll drum grid mirrors it).

import type { TrackInstrument, DrumPadSettings, MidiNote } from './daw-types'

export interface DrumLane {
  key: string
  pitch: number      // canonical GM pitch written into the clip
  label: string
  aliases?: number[] // other pitches that display on this lane
}

// Top-to-bottom row order in the grid (cymbals up top, kick at the bottom).
export const DRUM_LANES: DrumLane[] = [
  { key: 'crash',     pitch: 49, label: 'Crash',      aliases: [57] },
  { key: 'openHat',   pitch: 46, label: 'Open Hat' },
  { key: 'closedHat', pitch: 42, label: 'Closed Hat', aliases: [44] },
  { key: 'tomHi',     pitch: 48, label: 'Tom Hi',     aliases: [50] },
  { key: 'tomMid',    pitch: 45, label: 'Tom Mid',    aliases: [47] },
  { key: 'tomLo',     pitch: 41, label: 'Tom Lo',     aliases: [43] },
  { key: 'rim',       pitch: 51, label: 'Rim',        aliases: [37] },
  { key: 'clap',      pitch: 39, label: 'Clap' },
  { key: 'snare',     pitch: 38, label: 'Snare',      aliases: [40] },
  { key: 'kick',      pitch: 36, label: 'Kick',       aliases: [35] },
]

export const STEP_BEATS = 0.25   // 16th-note grid
export const STEPS_PER_BAR = 16

const laneByKey = new Map(DRUM_LANES.map(l => [l.key, l]))

// ── Kits ──────────────────────────────────────────────────────────────────────
export interface DrumKit {
  id: string
  name: string
  desc: string
  instrument: TrackInstrument
}

/** Compact pad-setting builder — only deviations from the neutral pad. */
const d = (volume = 0.8, pitch = 0, pan = 0): DrumPadSettings => ({ volume, pitch, pan, mute: false })

// Pitches used below: 36 kick · 38 snare · 39 clap · 42 closed hat · 46 open hat
// · 49 crash · 41/45/48 toms · 51 rim.
export const DRUM_KITS: DrumKit[] = [
  { id: 'studio',   name: 'Studio',    desc: 'Clean, balanced acoustic kit',
    instrument: { type: 'drum', params: { pack: 'synth' } } },
  { id: 'boombap',  name: 'Boom Bap',  desc: 'Punchy dusty hip-hop kit',
    instrument: { type: 'drum', params: { pack: 'synth', pads: { 36: d(0.95, -2), 38: d(0.9, -1), 42: d(0.6) } } } },
  { id: 'trap808',  name: '808 Trap',  desc: 'Deep 808 sub kick, crisp snare',
    instrument: { type: 'drum', params: { pack: '808', pads: { 36: d(0.95, -4), 38: d(0.85, 1), 42: d(0.6) } } } },
  { id: 'traphard', name: 'Trap Hard', desc: 'Very deep sub, tight tops',
    instrument: { type: 'drum', params: { pack: '808', pads: { 36: d(1, -7), 38: d(0.8, 2), 42: d(0.55) } } } },
  { id: 'drill',    name: 'Drill',     desc: 'Sliding sub, sparse and dark',
    instrument: { type: 'drum', params: { pack: '808', pads: { 36: d(0.95, -5), 38: d(0.8), 42: d(0.5) } } } },
  { id: 'house',    name: 'House',     desc: 'Four-on-the-floor, bright hats',
    instrument: { type: 'drum', params: { pack: 'synth', pads: { 36: d(0.9), 46: d(0.85, 2), 39: d(0.8) } } } },
  { id: 'techno',   name: 'Techno',    desc: 'Hard kick, minimal and driving',
    instrument: { type: 'drum', params: { pack: '808', pads: { 36: d(1, -1), 42: d(0.55), 38: d(0.7) } } } },
  { id: 'disco',    name: 'Disco',     desc: 'Open hats and claps up front',
    instrument: { type: 'drum', params: { pack: 'synth', pads: { 46: d(0.95, 3), 39: d(0.9), 42: d(0.75) } } } },
  { id: 'rock',     name: 'Rock',      desc: 'Loud snare and kick, big toms',
    instrument: { type: 'drum', params: { pack: 'synth', pads: { 36: d(1, -1), 38: d(1), 48: d(0.9), 45: d(0.9), 41: d(0.9) } } } },
  { id: 'pop',      name: 'Pop',       desc: 'Balanced with an emphasised clap',
    instrument: { type: 'drum', params: { pack: 'synth', pads: { 39: d(0.95), 38: d(0.85), 42: d(0.7) } } } },
  { id: 'lofi',     name: 'Lo-Fi',     desc: 'Soft, dark, laid-back',
    instrument: { type: 'drum', params: { pack: 'synth', pads: { 36: d(0.8, -3), 38: d(0.7, -2), 42: d(0.45), 46: d(0.5) } } } },
  { id: 'minimal',  name: 'Minimal',   desc: 'Tight and quiet, room to breathe',
    instrument: { type: 'drum', params: { pack: '808', pads: { 36: d(0.85, -2), 38: d(0.65), 42: d(0.4) } } } },
]

export const DEFAULT_KIT = DRUM_KITS[0]

/** Which kit an instrument matches (by pack + kick tuning), for the picker. */
export function kitIdForInstrument(inst: TrackInstrument | undefined): string | null {
  if (!inst || inst.type !== 'drum') return null
  const p = inst.params as { pack?: string; pads?: Record<number, DrumPadSettings> }
  for (const k of DRUM_KITS) {
    const kp = k.instrument.params as { pack?: string; pads?: Record<number, DrumPadSettings> }
    if (kp.pack !== p.pack) continue
    const a = kp.pads?.[36]?.pitch ?? 0, b = p.pads?.[36]?.pitch ?? 0
    if (a === b) return k.id
  }
  return null
}

// ── Patterns ────────────────────────────────────────────────────────────────
// Step indices are 16ths from the start; a 1-bar pattern spans steps 0–15.
export interface DrumPattern {
  id: string
  name: string
  desc: string
  bars: number
  hits: Record<string, number[]>   // laneKey → step indices that are ON
}

export const DRUM_PATTERNS: DrumPattern[] = [
  { id: 'four',    name: 'Four on the Floor', desc: 'House/EDM foundation', bars: 1,
    hits: { kick: [0, 4, 8, 12], closedHat: [2, 6, 10, 14], clap: [4, 12] } },
  { id: 'boombap', name: 'Boom Bap',          desc: 'Classic hip-hop swing', bars: 1,
    hits: { kick: [0, 10], snare: [4, 12], closedHat: [0, 2, 4, 6, 8, 10, 12, 14] } },
  { id: 'trap',    name: 'Trap',              desc: 'Rolling hats, syncopated kick', bars: 1,
    hits: { kick: [0, 6, 10], snare: [8], closedHat: [0, 2, 4, 6, 8, 10, 11, 12, 14] } },
  { id: 'traproll',name: 'Trap Hi-hat Roll',  desc: 'Trap with a hat roll fill', bars: 1,
    hits: { kick: [0, 10], snare: [8], closedHat: [0, 2, 4, 6, 8, 12, 13, 14, 15] } },
  { id: 'rock',    name: 'Basic Rock',        desc: 'Straight backbeat', bars: 1,
    hits: { kick: [0, 8], snare: [4, 12], closedHat: [0, 2, 4, 6, 8, 10, 12, 14] } },
  { id: 'halftime',name: 'Half-Time',         desc: 'Heavy, snare on the 3', bars: 1,
    hits: { kick: [0], snare: [8], closedHat: [0, 2, 4, 6, 8, 10, 12, 14] } },
  { id: 'disco',   name: 'Disco',             desc: 'Open hats on the offbeat', bars: 1,
    hits: { kick: [0, 4, 8, 12], openHat: [2, 6, 10, 14], snare: [4, 12], closedHat: [0, 4, 8, 12] } },
  { id: 'funk',    name: 'Funk',              desc: 'Syncopated ghost-note feel', bars: 1,
    hits: { kick: [0, 3, 10], snare: [4, 12], closedHat: [0, 2, 4, 6, 8, 10, 12, 14] } },
  { id: 'break',   name: 'Breakbeat',         desc: 'Amen-style broken groove', bars: 1,
    hits: { kick: [0, 10], snare: [4, 7, 12], closedHat: [2, 6, 10, 14] } },
  { id: 'dembow',  name: 'Reggaeton',         desc: 'Dembow rim/snare pattern', bars: 1,
    hits: { kick: [0, 8], rim: [3, 6, 11, 14], closedHat: [0, 2, 4, 6, 8, 10, 12, 14] } },
  { id: 'houseclap', name: 'House + Clap',    desc: 'Four-floor with claps + open hats', bars: 1,
    hits: { kick: [0, 4, 8, 12], clap: [4, 12], openHat: [2, 6, 10, 14] } },
  { id: 'drill',   name: 'Drill',             desc: 'Dark, triplet-leaning hats', bars: 1,
    hits: { kick: [0, 7, 10], snare: [8], closedHat: [0, 3, 6, 8, 11, 14] } },
]

/** Materialise a pattern into fresh clip notes. */
export function patternToNotes(p: DrumPattern): MidiNote[] {
  const notes: MidiNote[] = []
  for (const key of Object.keys(p.hits)) {
    const lane = laneByKey.get(key)
    if (!lane) continue
    for (const s of p.hits[key]) {
      notes.push({ id: crypto.randomUUID(), pitch: lane.pitch, startBeat: s * STEP_BEATS, durationBeats: STEP_BEATS, velocity: 100 })
    }
  }
  return notes
}
