/**
 * MIDI instrument presets.
 * A preset maps a name to a sound library folder that contains per-note samples.
 * When voice MIDI uses a preset it plays the exact sample for each detected note
 * instead of pitch-shifting a single sample.
 *
 * Storage: localStorage JSON (small metadata, no blobs).
 */

import type { PresetSound } from './daw-types'

const STORAGE_KEY = '100lights-midi-presets-v1'

export interface MidiPreset {
  id:        string
  name:      string   // display name, e.g. "Violin"
  folder:    string   // library folder, e.g. "Violin – All Notes"
  loNote:    number   // lowest MIDI note covered
  hiNote:    number   // highest MIDI note covered
  category:  string   // BeatType string for color/icon hints
  group:     string   // display group, e.g. "Piano", "Synth", "Strings"
  builtIn:   boolean  // true = seeded; cannot be deleted
  createdAt: string
  /** The preset's own sound shaping — applied to every note that uses it.
   *  Set in the preset creator; travels with the preset (and community share). */
  sound?:    PresetSound
}

export const PRESET_GROUPS = ['Piano', 'Mallets', 'Organ', 'Guitar', 'Bass', 'Strings', 'Brass', 'Woodwinds', 'World', 'Synth', 'Custom'] as const
export type PresetGroup = typeof PRESET_GROUPS[number]

// ── Built-in presets (mirrors KEYBOARD_PRESETS in default-samples.ts) ─────────

// NOTE: seeded ids are index-based (builtin-N). Never reorder or remove
// entries — append new ones at the end so saved clips keep their sound.
const BUILT_IN: Omit<MidiPreset, 'id' | 'builtIn' | 'createdAt'>[] = [
  { name: 'Piano',          folder: 'Piano – All Notes',          loNote: 36, hiNote: 84, category: 'piano-grand',    group: 'Piano'   },
  { name: 'Electric Piano', folder: 'Elec. Piano – All Notes',    loNote: 36, hiNote: 84, category: 'piano-electric', group: 'Piano'   },
  { name: 'Rhodes',         folder: 'Rhodes – All Notes',         loNote: 36, hiNote: 84, category: 'piano-rhodes',   group: 'Piano'   },
  { name: 'Synth Lead',     folder: 'Synth Lead – All Notes',     loNote: 36, hiNote: 96, category: 'synth-lead',     group: 'Synth'   },
  { name: 'Synth Bass',     folder: 'Synth Bass – All Notes',     loNote: 24, hiNote: 60, category: 'synth-bass',     group: 'Bass'    },
  { name: 'Organ',          folder: 'Organ – All Notes',          loNote: 36, hiNote: 84, category: 'synth-organ',    group: 'Organ'   },
  { name: 'Choir',          folder: 'Choir – All Notes',          loNote: 36, hiNote: 84, category: 'synth-choir',    group: 'Synth'   },
  { name: 'Dark Synth',     folder: 'Dark Synth – All Notes',     loNote: 24, hiNote: 96, category: 'synth-dark',     group: 'Synth'   },
  { name: 'Metallic Pluck', folder: 'Metallic Pluck – All Notes', loNote: 36, hiNote: 96, category: 'synth-pluck',    group: 'Synth'   },
  { name: 'Synth Strings',  folder: 'Synth Strings – All Notes',  loNote: 36, hiNote: 84, category: 'synth-strings',  group: 'Strings' },
  { name: 'Violin',         folder: 'Violin – All Notes',         loNote: 55, hiNote: 88, category: 'violin',         group: 'Strings' },
  { name: 'Viola',          folder: 'Viola – All Notes',          loNote: 48, hiNote: 77, category: 'viola',          group: 'Strings' },
  // Appended 2026-07 — full library coverage
  { name: 'Synth Pad',       folder: 'Synth Pad – All Notes',       loNote: 36, hiNote: 84, category: 'synth-pad',  group: 'Synth'     },
  { name: 'Drone',           folder: 'Drone – All Notes',           loNote: 36, hiNote: 60, category: 'synth-drone', group: 'Synth'    },
  { name: 'Acoustic Guitar', folder: 'Acoustic Guitar – All Notes', loNote: 40, hiNote: 76, category: 'other',      group: 'Guitar'    },
  { name: 'Electric Guitar', folder: 'Electric Guitar – All Notes', loNote: 40, hiNote: 76, category: 'other',      group: 'Guitar'    },
  { name: 'Nylon Guitar',    folder: 'Nylon Guitar – All Notes',    loNote: 40, hiNote: 76, category: 'other',      group: 'Guitar'    },
  { name: 'Fretless Bass',   folder: 'Fretless Bass – All Notes',   loNote: 24, hiNote: 67, category: 'synth-bass', group: 'Bass'      },
  { name: 'Electric Bass',   folder: 'Electric Bass – All Notes',   loNote: 24, hiNote: 67, category: 'synth-bass', group: 'Bass'      },
  { name: 'Acoustic Bass',   folder: 'Acoustic Bass – All Notes',   loNote: 24, hiNote: 55, category: 'synth-bass', group: 'Bass'      },
  { name: 'Cello',           folder: 'Cello – All Notes',           loNote: 36, hiNote: 81, category: 'viola',      group: 'Strings'   },
  { name: 'Trumpet',         folder: 'Trumpet – All Notes',         loNote: 52, hiNote: 84, category: 'other',      group: 'Brass'     },
  { name: 'Trombone',        folder: 'Trombone – All Notes',        loNote: 40, hiNote: 77, category: 'other',      group: 'Brass'     },
  { name: 'French Horn',     folder: 'French Horn – All Notes',     loNote: 35, hiNote: 77, category: 'other',      group: 'Brass'     },
  { name: 'Flute',           folder: 'Flute – All Notes',           loNote: 60, hiNote: 96, category: 'other',      group: 'Woodwinds' },
  { name: 'Clarinet',        folder: 'Clarinet – All Notes',        loNote: 50, hiNote: 93, category: 'other',      group: 'Woodwinds' },
  // Real sampled instruments (FluidR3) — warm/organic, hold long sustained notes.
  // APPEND ONLY (built-in ids are index-based); never reorder the entries above.
  { name: 'Grand Piano',     folder: 'Grand Piano – All Notes',         loNote: 21, hiNote: 108, category: 'piano-grand',    group: 'Piano'   },
  { name: 'Warm EP',         folder: 'Warm Electric Piano – All Notes', loNote: 28, hiNote: 103, category: 'piano-electric', group: 'Piano'   },
  { name: 'String Ensemble', folder: 'String Ensemble – All Notes',     loNote: 28, hiNote: 96,  category: 'synth-strings',  group: 'Strings' },
  { name: 'Choir Aahs',      folder: 'Choir Aahs – All Notes',          loNote: 43, hiNote: 84,  category: 'synth-choir',    group: 'Synth'   },
  { name: 'Warm Pad',        folder: 'Warm Pad – All Notes',            loNote: 36, hiNote: 96,  category: 'synth-pad',      group: 'Synth'   },
  { name: 'Music Box',       folder: 'Music Box – All Notes',           loNote: 60, hiNote: 96,  category: 'other',          group: 'Mallets' },
  // Real sampled — wave 2 (append only; keep order).
  { name: 'Orchestral Harp', folder: 'Orchestral Harp – All Notes',     loNote: 24, hiNote: 103, category: 'other',          group: 'Strings'   },
  { name: 'Nylon Guitar',    folder: 'Nylon Acoustic Guitar – All Notes', loNote: 40, hiNote: 84, category: 'other',         group: 'Guitar'    },
  { name: 'Steel Guitar',    folder: 'Steel Acoustic Guitar – All Notes', loNote: 40, hiNote: 84, category: 'other',         group: 'Guitar'    },
  { name: 'Clean Guitar',    folder: 'Clean Electric Guitar – All Notes', loNote: 40, hiNote: 86, category: 'other',         group: 'Guitar'    },
  { name: 'Vibraphone',      folder: 'Vibraphone – All Notes',          loNote: 53, hiNote: 89,  category: 'other',          group: 'Mallets'   },
  { name: 'Marimba',         folder: 'Marimba – All Notes',             loNote: 45, hiNote: 96,  category: 'other',          group: 'Mallets'   },
  { name: 'Glockenspiel',    folder: 'Glockenspiel – All Notes',        loNote: 72, hiNote: 108, category: 'other',          group: 'Mallets'   },
  { name: 'Kalimba',         folder: 'Kalimba – All Notes',             loNote: 48, hiNote: 84,  category: 'other',          group: 'Mallets'   },
  { name: 'Violin (Vibrato)', folder: 'Solo Violin – All Notes',        loNote: 55, hiNote: 100, category: 'violin',         group: 'Strings'   },
  { name: 'Pizzicato',       folder: 'Pizzicato Strings – All Notes',   loNote: 36, hiNote: 96,  category: 'other',          group: 'Strings'   },
  { name: 'Oboe',            folder: 'Oboe – All Notes',                loNote: 58, hiNote: 91,  category: 'other',          group: 'Woodwinds' },
  { name: 'Pan Flute',       folder: 'Pan Flute – All Notes',           loNote: 60, hiNote: 96,  category: 'other',          group: 'Woodwinds' },
  { name: 'Church Organ',    folder: 'Church Organ – All Notes',        loNote: 36, hiNote: 96,  category: 'synth-organ',    group: 'Organ'     },
  { name: 'Harpsichord',     folder: 'Harpsichord – All Notes',         loNote: 41, hiNote: 89,  category: 'other',          group: 'Piano'     },
  // A sustained SUB DRONE: a deep sampled bass shaped to start strong (instant
  // attack + a short pitch-drop thump + a punchy filter-open front) then hold as
  // a long, low drone (near-full sustain + a release pedal, sub/bass weight).
  // Built for held one-note-per-chord basslines (Artemas-style), not repeated hits.
  { name: 'Sub Drone', folder: 'Synth Bass – All Notes', loNote: 24, hiNote: 60, category: 'synth-bass', group: 'Bass',
    sound: { fx: { attack: 0, decay: 0.09, sustainLevel: 0.92, sustain: 0.35, gain: 1.12, filterHz: 2400, filterQ: 1.1, filterEnv: 0.45, drive: 0.18, sub: 0.7, bass: 0.5, pitchEnv: -3, pitchEnvTime: 0.05 } } },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']

export function midiNoteLabel(midi: number): string {
  return `${NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`
}

export function noteRangeLabel(preset: Pick<MidiPreset, 'loNote' | 'hiNote'>): string {
  return `${midiNoteLabel(preset.loNote)}→${midiNoteLabel(preset.hiNote)}`
}

export function presetDisplayName(preset: MidiPreset): string {
  return `${preset.name} — ${noteRangeLabel(preset)}`
}

// ── Storage ───────────────────────────────────────────────────────────────────

function load(): MidiPreset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as MidiPreset[]) : []
  } catch { return [] }
}

function save(presets: MidiPreset[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(presets))
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns all presets (built-in + user-created), seeding built-ins on first call.
 * Safe to call on every render — the seed check is O(1) localStorage read.
 */
export function getPresets(): MidiPreset[] {
  const stored = load()
  // Identity is folder + name (not folder alone) so a second built-in can reuse
  // an existing sample folder as a distinct preset (e.g. "Sub Drone" over the
  // Synth Bass samples with its own sound shaping). Samples still resolve by
  // folder; only the preset's identity/metadata is name-scoped.
  const bkey = (p: { folder: string; name: string }) => `${p.folder} ${p.name}`
  const hasAllBuiltIns = BUILT_IN.every(b => stored.some(p => p.builtIn && bkey(p) === bkey(b)))

  if (!hasAllBuiltIns) {
    const now = new Date().toISOString()
    const existing = stored.filter(p => !p.builtIn)
    const seeded: MidiPreset[] = BUILT_IN.map((b, i) => ({
      ...b,
      id:        `builtin-${i}`,
      builtIn:   true,
      createdAt: now,
    }))
    const merged = [...seeded, ...existing]
    save(merged)
    return merged
  }

  // Keep built-ins in canonical order, user presets at the end. Overlay each
  // built-in's metadata (note range, name, group) from the code definition so
  // range widenings (e.g. Synth Lead) reach users whose localStorage still has
  // the old values — playback is unaffected either way, this fixes the piano
  // roll's out-of-range flag and the picker's displayed range.
  const defByFolder = new Map(BUILT_IN.map(b => [bkey(b), b]))
  const builtIns = stored.filter(p => p.builtIn).sort((a, b) => {
    const ai = BUILT_IN.findIndex(x => bkey(x) === bkey(a))
    const bi = BUILT_IN.findIndex(x => bkey(x) === bkey(b))
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi)
  }).map(p => {
    const def = defByFolder.get(bkey(p))
    return def ? { ...p, name: def.name, loNote: def.loNote, hiNote: def.hiNote, category: def.category, group: def.group } : p
  })
  const userPresets = stored.filter(p => !p.builtIn)
  return [...builtIns, ...userPresets]
}

/**
 * Project-embedded presets first (so a shared .cfproj resolves its custom
 * sounds even on a device that never saved them), then the local library —
 * de-duped by id. Pass a project's `presets` and use the result wherever the
 * engine or a picker needs the full set.
 */
export function combinePresets(projectPresets?: MidiPreset[]): MidiPreset[] {
  const local = getPresets()
  if (!projectPresets || projectPresets.length === 0) return local
  const embedded = new Set(projectPresets.map(p => p.id))
  return [...projectPresets, ...local.filter(p => !embedded.has(p.id))]
}

/**
 * The default sound for piano-roll notes: the built-in Piano preset.
 * Used when a MIDI clip has no preset and its track has no instrument,
 * so drawn notes are never silent.
 */
export function defaultPresetId(): string | null {
  if (typeof window === 'undefined') return null
  const presets = getPresets()
  return (presets.find(p => p.builtIn && p.name === 'Piano') ?? presets[0])?.id ?? null
}

/** Returns presets grouped in canonical display order. Groups with no presets are omitted. */
export function getGroupedPresets(presets: MidiPreset[]): { group: string; presets: MidiPreset[] }[] {
  const order = [...PRESET_GROUPS]
  const map = new Map<string, MidiPreset[]>()
  for (const p of presets) {
    const g = p.group || 'Custom'
    if (!map.has(g)) map.set(g, [])
    map.get(g)!.push(p)
  }
  const result: { group: string; presets: MidiPreset[] }[] = []
  for (const g of order) {
    const list = map.get(g)
    if (list?.length) result.push({ group: g, presets: list })
  }
  // any unknown groups
  for (const [g, list] of map) {
    if (!order.includes(g as PresetGroup)) result.push({ group: g, presets: list })
  }
  return result
}

export function addPreset(preset: Omit<MidiPreset, 'id' | 'builtIn' | 'createdAt' | 'group'> & { group?: string }): MidiPreset {
  const stored = load()
  const p: MidiPreset = { ...preset, group: preset.group ?? 'Custom', id: crypto.randomUUID(), builtIn: false, createdAt: new Date().toISOString() }
  save([...stored, p])
  // Mirror to the account so it shows on the user's other devices (best-effort).
  void import('./user-library-sync').then(m => m.pushLibraryItem('preset', p.id, p.name, p)).catch(() => {})
  return p
}

export function deletePreset(id: string): void {
  const stored = load()
  save(stored.filter(p => p.id !== id || p.builtIn))
  void import('./user-library-sync').then(m => m.deleteLibraryItem(id)).catch(() => {})
}

/** Merge account-synced presets pulled from another device into local storage.
 *  Additive: only inserts ids not already present, never re-pushes. */
export function upsertSyncedPresets(items: MidiPreset[]): void {
  if (typeof localStorage === 'undefined' || items.length === 0) return
  const stored = load()
  const have = new Set(stored.map(p => p.id))
  const add = items.filter(p => p && p.id && !have.has(p.id)).map(p => ({ ...p, builtIn: false }))
  if (add.length) save([...stored, ...add])
}

/** Clamp a MIDI note to the preset's covered range. */
export function clampToPreset(preset: MidiPreset, midi: number): number {
  return Math.max(preset.loNote, Math.min(preset.hiNote, midi))
}
