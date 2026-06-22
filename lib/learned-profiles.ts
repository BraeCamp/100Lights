export interface ProfileFeatures {
  noteCount: number
  avgDurationMs: number
  pitchVarianceCents: number
  medianMidi: number
  gapRatio: number          // fraction of note transitions with gap > 30ms
  totalDuration: number
}

export interface LearnedProfile {
  id: string
  created: number
  features: ProfileFeatures
  code: string
  label: string
  timesUsed: number
}

const STORAGE_KEY = 'beatlab-learned-profiles'
const MAX_PROFILES = 60

// Normalize features into [0,1] for Euclidean distance
function normalize(f: ProfileFeatures): number[] {
  return [
    Math.min(f.noteCount, 50) / 50,
    Math.min(f.avgDurationMs, 2000) / 2000,
    Math.min(f.pitchVarianceCents, 200) / 200,
    (Math.max(36, Math.min(f.medianMidi, 84)) - 36) / 48,
    Math.max(0, Math.min(f.gapRatio, 1)),
    Math.min(f.totalDuration, 60) / 60,
  ]
}

function distance(a: ProfileFeatures, b: ProfileFeatures): number {
  const na = normalize(a), nb = normalize(b)
  return Math.sqrt(na.reduce((s, x, i) => s + (x - nb[i]) ** 2, 0) / na.length)
}

export function getAllProfiles(): LearnedProfile[] {
  if (typeof window === 'undefined') return []
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as LearnedProfile[]
  } catch { return [] }
}

function persist(profiles: LearnedProfile[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles))
}

export function saveProfile(features: ProfileFeatures, code: string, label: string): string {
  const profiles = getAllProfiles()
  const id = crypto.randomUUID()
  profiles.unshift({ id, created: Date.now(), features, code, label, timesUsed: 0 })
  persist(profiles.slice(0, MAX_PROFILES))
  return id
}

// Returns the closest profile if it's within maxDistance (0 = identical, 1 = maximally different)
export function findBestMatch(features: ProfileFeatures, maxDistance = 0.28): LearnedProfile | null {
  const profiles = getAllProfiles()
  if (profiles.length === 0) return null
  let best: LearnedProfile | null = null
  let bestDist = Infinity
  for (const p of profiles) {
    const d = distance(features, p.features)
    if (d < bestDist) { bestDist = d; best = p }
  }
  return best && bestDist <= maxDistance ? best : null
}

export function incrementUsage(id: string): void {
  const profiles = getAllProfiles()
  const p = profiles.find(x => x.id === id)
  if (p) { p.timesUsed++; persist(profiles) }
}

export function deleteProfile(id: string): void {
  persist(getAllProfiles().filter(p => p.id !== id))
}

export function profileLabel(f: ProfileFeatures): string {
  const midiNames = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']
  const noteName  = `${midiNames[f.medianMidi % 12]}${Math.floor(f.medianMidi / 12) - 1}`
  const style     = f.avgDurationMs < 200 ? 'staccato' : f.avgDurationMs < 600 ? 'medium' : 'legato'
  const expr      = f.pitchVarianceCents > 40 ? 'expressive' : f.pitchVarianceCents > 15 ? 'moderate' : 'steady'
  return `${f.noteCount} notes · ${noteName} · ${style} · ${expr}`
}
