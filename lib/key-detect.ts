// Musical key / scale detection from a chroma profile (the 12 pitch classes). Real-time chord-by-chord
// reading is noisy; the stable, useful read is the KEY + MODE (major vs minor) over a window, which is
// exactly what maps to mood — minor = darker/moodier, major = brighter/uplifting. Uses the classic
// Krumhansl-Schmuckler key profiles correlated against the accumulated chroma.

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

// Krumhansl-Kessler tonal hierarchy weights (major / natural minor).
const MAJ = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
const MIN = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]

function pearson(a: number[] | Float32Array, b: number[]): number {
  const n = 12
  let ma = 0, mb = 0
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i] }
  ma /= n; mb /= n
  let num = 0, da = 0, db = 0
  for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; num += x * y; da += x * x; db += y * y }
  const den = Math.sqrt(da * db)
  return den ? num / den : 0
}

export interface KeyResult { key: number; mode: 'major' | 'minor'; name: string; conf: number }

// Best-correlating key+mode for a 12-bin chroma. conf = margin of the winner over the runner-up.
export function estimateKey(chroma: Float32Array | number[]): KeyResult | null {
  let sum = 0; for (let i = 0; i < 12; i++) sum += chroma[i]
  if (sum < 1e-6) return null   // silence / no tonal content

  let best = -2, second = -2, bestKey = 0, bestMode: 'major' | 'minor' = 'major'
  for (const [mode, prof] of [['major', MAJ], ['minor', MIN]] as const) {
    for (let root = 0; root < 12; root++) {
      // rotate the profile so index 0 aligns with `root`
      const rot: number[] = new Array(12)
      for (let i = 0; i < 12; i++) rot[i] = prof[(i - root + 12) % 12]
      const c = pearson(chroma, rot)
      if (c > best) { second = best; best = c; bestKey = root; bestMode = mode }
      else if (c > second) second = c
    }
  }
  return { key: bestKey, mode: bestMode, name: NOTE_NAMES[bestKey] + (bestMode === 'minor' ? ' minor' : ' major'), conf: Math.max(0, Math.min(1, (best - second) * 2.5)) }
}

// ── Mood from key mode + energy ────────────────────────────────────────────────
export type Mood = 'melancholic' | 'dark' | 'dreamy' | 'uplifting' | 'energetic' | 'neutral'

// Mode (major/minor) × energy → a mood label. Minor leans dark/moody, major leans bright/happy.
export function moodFrom(mode: 'major' | 'minor' | null, energy: 'calm' | 'mid' | 'hot'): Mood {
  if (mode === 'minor') return energy === 'hot' ? 'dark' : 'melancholic'
  if (mode === 'major') return energy === 'calm' ? 'dreamy' : energy === 'hot' ? 'energetic' : 'uplifting'
  return energy === 'hot' ? 'energetic' : energy === 'calm' ? 'dreamy' : 'neutral'
}

// Mood → visual preferences the picker/Auto use: darker/cooler for minor moods, brighter/warmer for major.
export const MOOD_LOOK: Record<Mood, { brightness: ('dark' | 'mid' | 'bright')[]; palettes: string[] }> = {
  melancholic: { brightness: ['dark', 'mid'], palettes: ['ice', 'ocean', 'mono'] },
  dark: { brightness: ['dark'], palettes: ['mono', 'ocean', 'neon'] },
  dreamy: { brightness: ['mid', 'dark'], palettes: ['aurora', 'ice', 'candy'] },
  uplifting: { brightness: ['mid', 'bright'], palettes: ['sunset', 'aurora', 'candy'] },
  energetic: { brightness: ['bright', 'mid'], palettes: ['fire', 'sunset', 'neon'] },
  neutral: { brightness: [], palettes: ['aurora', 'ocean', 'sunset'] },
}
