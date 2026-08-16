// Built-in drum kits and beat patterns for the step sequencer.
//
// A "kit" is just a drum TrackInstrument config (which pack + per-pad tuning) —
// the same thing a piano preset is for melodic tracks, so applying a kit is a
// SET_INSTRUMENT. A "pattern" is a grid of hits (lane → step indices) that gets
// materialised into a drum clip's MidiNotes. Both are picked from the sequencer
// panel. The canonical lane list here is the single source of truth for
// lane → GM pitch (the piano-roll drum grid mirrors it).

import type { TrackInstrument, DrumPadSettings, MidiNote } from './daw-types'
import { EXTRA_PATTERNS } from './drum-patterns-extra'

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
  /** Synth VOICE timbres (BeatMaker / Firefly synth playback): distinct kick(pack)/snare/hat per
   *  kit so kits differ in character, not just per-pad volume/pitch. The sample-based studio path
   *  ignores this. snare: 'acoustic'|'tight'|'fat'; hat: 'normal'|'tight'|'loose'. */
  voices?: { snare?: 'acoustic' | 'tight' | 'fat'; hat?: 'normal' | 'tight' | 'loose' }
  builtIn?: boolean    // seeded kit — can't be deleted
  createdAt?: string
}

/** Compact pad-setting builder — only deviations from the neutral pad. */
const d = (volume = 0.8, pitch = 0, pan = 0): DrumPadSettings => ({ volume, pitch, pan, mute: false })

// Pitches used below: 36 kick · 38 snare · 39 clap · 42 closed hat · 46 open hat
// · 49 crash · 41/45/48 toms · 51 rim.
// Curated to 8 kits that sound genuinely DISTINCT — each combines a kick pack (synth vs 808),
// a snare timbre, and a hat timbre (the `voices` field), not just per-pad volume/pitch tweaks.
export const DRUM_KITS: DrumKit[] = [
  { id: 'studio',   name: 'Studio',    desc: 'Clean, balanced acoustic kit',
    instrument: { type: 'drum', params: { pack: 'synth' } },
    voices: { snare: 'acoustic', hat: 'normal' } },
  { id: 'boombap',  name: 'Boom Bap',  desc: 'Dusty hip-hop — fat snare, loose hats',
    instrument: { type: 'drum', params: { pack: 'synth', pads: { 36: d(0.98, -3), 38: d(0.9, -2), 42: d(0.6) } } },
    voices: { snare: 'fat', hat: 'loose' } },
  { id: 'rock',     name: 'Rock',      desc: 'Big room — loud tight snare + toms',
    instrument: { type: 'drum', params: { pack: 'synth', pads: { 36: d(1, -1), 38: d(1, 1), 48: d(0.9), 45: d(0.9), 41: d(0.9) } } },
    voices: { snare: 'tight', hat: 'normal' } },
  { id: 'pop',      name: 'Pop',       desc: 'Balanced, clap-forward, crisp tops',
    instrument: { type: 'drum', params: { pack: 'synth', pads: { 39: d(0.95), 38: d(0.85), 42: d(0.72) } } },
    voices: { snare: 'acoustic', hat: 'tight' } },
  { id: 'house',    name: 'House',     desc: 'Four-on-the-floor, open hats + claps',
    instrument: { type: 'drum', params: { pack: 'synth', pads: { 36: d(0.95), 46: d(0.9, 2), 39: d(0.85), 42: d(0.7) } } },
    voices: { snare: 'tight', hat: 'tight' } },
  { id: 'lofi',     name: 'Lo-Fi',     desc: 'Soft, dark, laid-back',
    instrument: { type: 'drum', params: { pack: 'synth', pads: { 36: d(0.78, -4), 38: d(0.68, -3), 42: d(0.42), 46: d(0.5) } } },
    voices: { snare: 'fat', hat: 'loose' } },
  { id: 'trap808',  name: '808 Trap',  desc: 'Deep 808 sub kick, bright snare, tight hats',
    instrument: { type: 'drum', params: { pack: '808', pads: { 36: d(0.98, -4), 38: d(0.85, 2), 42: d(0.6) } } },
    voices: { snare: 'tight', hat: 'tight' } },
  { id: 'techno',   name: 'Techno',    desc: 'Hard driving 808 kick, raw and minimal',
    instrument: { type: 'drum', params: { pack: '808', pads: { 36: d(1, -1), 42: d(0.55), 38: d(0.7) } } },
    voices: { snare: 'acoustic', hat: 'normal' } },
]

export const DEFAULT_KIT = DRUM_KITS[0]

// User-saved + community-installed kits live in localStorage; built-ins are the
// seed set above. getKits() returns built-ins first, then the user's own.
const KITS_KEY = '100lights-drum-kits-v1'
function loadUserKits(): DrumKit[] {
  try { return (JSON.parse(localStorage.getItem(KITS_KEY) || '[]') as DrumKit[]).map(k => ({ ...k, builtIn: false })) } catch { return [] }
}
export function getKits(): DrumKit[] {
  const builtIns = DRUM_KITS.map(k => ({ ...k, builtIn: true }))
  if (typeof localStorage === 'undefined') return builtIns
  return [...builtIns, ...loadUserKits()]
}
/** Save a user kit (or overwrite one by id, e.g. re-installing from community). */
export function addKit(kit: Omit<DrumKit, 'id' | 'builtIn' | 'createdAt'> & { id?: string; createdAt?: string }): DrumKit {
  const saved: DrumKit = { ...kit, id: kit.id ?? crypto.randomUUID(), builtIn: false, createdAt: kit.createdAt ?? new Date().toISOString() }
  const users = loadUserKits().filter(u => u.id !== saved.id)
  users.push(saved)
  try { localStorage.setItem(KITS_KEY, JSON.stringify(users)) } catch { /* storage off */ }
  void import('./user-library-sync').then(m => m.pushLibraryItem('kit', saved.id, saved.name, saved)).catch(() => {})
  return saved
}
export function deleteKit(id: string): void {
  try { localStorage.setItem(KITS_KEY, JSON.stringify(loadUserKits().filter(u => u.id !== id))) } catch { /* storage off */ }
  void import('./user-library-sync').then(m => m.deleteLibraryItem(id)).catch(() => {})
}
/** Merge account-synced kits from another device into local storage (additive). */
export function upsertSyncedKits(items: DrumKit[]): void {
  if (typeof localStorage === 'undefined' || items.length === 0) return
  const users = loadUserKits()
  const have = new Set(users.map(k => k.id))
  const add = items.filter(k => k && k.id && !have.has(k.id)).map(k => ({ ...k, builtIn: false }))
  if (add.length) try { localStorage.setItem(KITS_KEY, JSON.stringify([...users, ...add])) } catch { /* storage off */ }
}

/** Which kit an instrument matches (by pack + kick tuning), for the picker. */
export function kitIdForInstrument(inst: TrackInstrument | undefined): string | null {
  if (!inst || inst.type !== 'drum') return null
  const p = inst.params as { pack?: string; pads?: Record<number, DrumPadSettings> }
  for (const k of getKits()) {
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
  builtIn?: boolean
  createdAt?: string
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
  // +51 genre patterns (deep house → jersey club); see lib/drum-patterns-extra.ts
  ...EXTRA_PATTERNS,
]

/** Smart-Drums groove: density (0=sparse…1=busy) × intensity (0=soft…1=loud)
 *  → clip notes. Kick/snare/hats scale with density; velocity with intensity. */
export function generateGroove(density: number, intensity: number): MidiNote[] {
  const d = Math.max(0, Math.min(1, density)), i = Math.max(0, Math.min(1, intensity))
  const kick = [0, 8]
  if (d > 0.28) kick.push(4, 12)
  if (d > 0.55) kick.push(10)
  if (d > 0.78) kick.push(6, 14)
  const snare = [4, 12]
  if (d > 0.7) snare.push(7)
  let hat: number[]
  if (d < 0.3) hat = [0, 4, 8, 12]
  else if (d < 0.62) hat = [0, 2, 4, 6, 8, 10, 12, 14]
  else hat = [0, 1, 2, 3, 4, 6, 8, 10, 11, 12, 14, 15]
  const hits: Record<string, number[]> = { kick: [...new Set(kick)], snare, closedHat: hat }
  const vBase = 52 + i * 62
  const notes: MidiNote[] = []
  for (const key of Object.keys(hits)) {
    const lane = laneByKey.get(key)
    if (!lane) continue
    for (const s of hits[key]) {
      const accent = (s % 4 === 0) ? 12 : 0
      notes.push({ id: crypto.randomUUID(), pitch: lane.pitch, startBeat: s * STEP_BEATS, durationBeats: STEP_BEATS,
        velocity: Math.max(40, Math.min(127, Math.round(vBase + accent + (Math.random() - 0.5) * 14))) })
    }
  }
  return notes
}

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

/** Capture a clip's current drum notes as a pattern's hit grid (inverse of
 *  patternToNotes). Pitches map back to their lane via the alias table. */
export function notesToHits(notes: MidiNote[]): Record<string, number[]> {
  const pitchToKey = new Map<number, string>()
  for (const l of DRUM_LANES) {
    pitchToKey.set(l.pitch, l.key)
    l.aliases?.forEach(a => pitchToKey.set(a, l.key))
  }
  const hits: Record<string, number[]> = {}
  for (const n of notes) {
    const key = pitchToKey.get(n.pitch)
    if (!key) continue
    const step = Math.round(n.startBeat / STEP_BEATS)
    ;(hits[key] ??= []).push(step)
  }
  for (const k of Object.keys(hits)) hits[k] = [...new Set(hits[k])].sort((a, b) => a - b)
  return hits
}

// User-saved + community-installed patterns, mirroring the kit store.
const PATTERNS_KEY = '100lights-drum-patterns-v1'
function loadUserPatterns(): DrumPattern[] {
  try { return (JSON.parse(localStorage.getItem(PATTERNS_KEY) || '[]') as DrumPattern[]).map(p => ({ ...p, builtIn: false })) } catch { return [] }
}
export function getPatterns(): DrumPattern[] {
  const builtIns = DRUM_PATTERNS.map(p => ({ ...p, builtIn: true }))
  if (typeof localStorage === 'undefined') return builtIns
  return [...builtIns, ...loadUserPatterns()]
}
export function addPattern(pattern: Omit<DrumPattern, 'id' | 'builtIn' | 'createdAt'> & { id?: string; createdAt?: string }): DrumPattern {
  const saved: DrumPattern = { ...pattern, id: pattern.id ?? crypto.randomUUID(), builtIn: false, createdAt: pattern.createdAt ?? new Date().toISOString() }
  const users = loadUserPatterns().filter(u => u.id !== saved.id)
  users.push(saved)
  try { localStorage.setItem(PATTERNS_KEY, JSON.stringify(users)) } catch { /* storage off */ }
  void import('./user-library-sync').then(m => m.pushLibraryItem('pattern', saved.id, saved.name, saved)).catch(() => {})
  return saved
}
export function deletePattern(id: string): void {
  try { localStorage.setItem(PATTERNS_KEY, JSON.stringify(loadUserPatterns().filter(u => u.id !== id))) } catch { /* storage off */ }
  void import('./user-library-sync').then(m => m.deleteLibraryItem(id)).catch(() => {})
}
/** Merge account-synced patterns from another device into local storage (additive). */
export function upsertSyncedPatterns(items: DrumPattern[]): void {
  if (typeof localStorage === 'undefined' || items.length === 0) return
  const users = loadUserPatterns()
  const have = new Set(users.map(p => p.id))
  const add = items.filter(p => p && p.id && !have.has(p.id)).map(p => ({ ...p, builtIn: false }))
  if (add.length) try { localStorage.setItem(PATTERNS_KEY, JSON.stringify([...users, ...add])) } catch { /* storage off */ }
}
