/**
 * Pad layout presets — save/load custom pad configurations to localStorage.
 * A pad preset captures which samples/presets are assigned to each pad so
 * users can share configurations across projects or restore them later.
 */

const STORAGE_KEY = '100lights-pad-presets-v1'

export interface PadPresetSound {
  id: string
  name: string
  volume?: number
  pitch?: number
}

export interface PadPresetPad {
  id: string
  pitch: number
  drumLabel: string
  key: string
  customSounds?: PadPresetSound[]
  sampleSustain?: number
  sampleLoop?: boolean
  sampleReverse?: boolean
  sampleVibratoDepth?: number
  sampleVibratoRate?: number
  sampleTrimStart?: number
  sampleTrimEnd?: number
}

export interface PadPreset {
  id: string
  name: string
  createdAt: string
  pads: PadPresetPad[]
}

function load(): PadPreset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as PadPreset[]) : []
  } catch { return [] }
}

function save(presets: PadPreset[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(presets))
}

export function getPadPresets(): PadPreset[] {
  return load()
}

export function savePadPreset(name: string, pads: PadPresetPad[]): PadPreset {
  const stored = load()
  const p: PadPreset = { id: crypto.randomUUID(), name, createdAt: new Date().toISOString(), pads }
  save([...stored, p])
  return p
}

export function deletePadPreset(id: string): void {
  save(load().filter(p => p.id !== id))
}
