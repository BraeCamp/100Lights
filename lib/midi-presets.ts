/**
 * MIDI instrument presets.
 * A preset maps a name to a sound library folder that contains per-note samples.
 * When voice MIDI uses a preset it plays the exact sample for each detected note
 * instead of pitch-shifting a single sample.
 *
 * Storage: localStorage JSON (small metadata, no blobs).
 */

const STORAGE_KEY = '100lights-midi-presets-v1'

export interface MidiPreset {
  id:        string
  name:      string   // display name, e.g. "Violin"
  folder:    string   // library folder, e.g. "Violin – All Notes"
  loNote:    number   // lowest MIDI note covered
  hiNote:    number   // highest MIDI note covered
  category:  string   // BeatType string for color/icon hints
  builtIn:   boolean  // true = seeded; cannot be deleted
  createdAt: string
}

// ── Built-in presets (mirrors KEYBOARD_PRESETS in default-samples.ts) ─────────

const BUILT_IN: Omit<MidiPreset, 'id' | 'builtIn' | 'createdAt'>[] = [
  { name: 'Piano',          folder: 'Piano – All Notes',          loNote: 36, hiNote: 84, category: 'piano-grand'    },
  { name: 'Electric Piano', folder: 'Elec. Piano – All Notes',    loNote: 36, hiNote: 84, category: 'piano-electric'  },
  { name: 'Rhodes',         folder: 'Rhodes – All Notes',         loNote: 36, hiNote: 84, category: 'piano-rhodes'   },
  { name: 'Synth Lead',     folder: 'Synth Lead – All Notes',     loNote: 48, hiNote: 72, category: 'synth-lead'     },
  { name: 'Strings',        folder: 'Strings – All Notes',        loNote: 36, hiNote: 84, category: 'synth-strings'  },
  { name: 'Organ',          folder: 'Organ – All Notes',          loNote: 36, hiNote: 84, category: 'synth-organ'    },
  { name: 'Choir',          folder: 'Choir – All Notes',          loNote: 36, hiNote: 84, category: 'synth-choir'    },
  { name: 'Bass',           folder: 'Bass – All Notes',           loNote: 24, hiNote: 48, category: 'synth-bass'     },
  { name: 'Dark Synth',     folder: 'Dark Synth – All Notes',     loNote: 36, hiNote: 72, category: 'synth-dark'     },
  { name: 'Metallic Pluck', folder: 'Metallic Pluck – All Notes', loNote: 36, hiNote: 72, category: 'synth-pluck'    },
  { name: 'Violin',         folder: 'Violin – All Notes',         loNote: 55, hiNote: 88, category: 'violin'         },
  { name: 'Viola',          folder: 'Viola – All Notes',          loNote: 48, hiNote: 77, category: 'viola'          },
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
  const builtInIds = new Set(BUILT_IN.map(b => b.folder))
  const hasAllBuiltIns = BUILT_IN.every(b => stored.some(p => p.folder === b.folder && p.builtIn))

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

  // Keep built-ins in canonical order, user presets at the end
  const builtIns = stored.filter(p => p.builtIn).sort((a, b) => {
    const ai = BUILT_IN.findIndex(x => x.folder === a.folder)
    const bi = BUILT_IN.findIndex(x => x.folder === b.folder)
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi)
  })
  const userPresets = stored.filter(p => !p.builtIn)
  return [...builtIns, ...userPresets]
}

export function addPreset(preset: Omit<MidiPreset, 'id' | 'builtIn' | 'createdAt'>): MidiPreset {
  const stored = load()
  const p: MidiPreset = { ...preset, id: crypto.randomUUID(), builtIn: false, createdAt: new Date().toISOString() }
  save([...stored, p])
  return p
}

export function deletePreset(id: string): void {
  const stored = load()
  save(stored.filter(p => p.id !== id || p.builtIn))
}

/** Clamp a MIDI note to the preset's covered range. */
export function clampToPreset(preset: MidiPreset, midi: number): number {
  return Math.max(preset.loNote, Math.min(preset.hiNote, midi))
}
