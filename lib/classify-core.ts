// The Lightning Bug genre classifier core — ONE source of truth shared by the live app
// (components/apps/LightningBug.tsx) and the offline calibrator (scripts/calibrate-classifier.mjs),
// so what we tune offline is exactly what runs live.
//
// Inputs are rough DSP reads from the live AnalyserNode, each ~0-1 except bpm:
//   energy (loudness), bass (low-band ratio), bright (high-band ratio),
//   density (spectral flux / busyness), beaty (pulse clarity), bpm.
// Thresholds were retuned against the tagged Jamendo corpus (npm run calibrate:looks).
// Type-only import is erased at runtime, so plain Node (calibrator) never has to resolve it; the
// FAMILIES value is declared locally to keep this module import-free at runtime.
import type { Family } from './genre-map'

const FAMILIES: Family[] = ['Ambient', 'Lofi / Chill', 'Hip-hop', 'Electronic', 'Rock / Band', 'Pop', 'Orchestral']

export interface SonicFeatures { bpm: number; energy: number; bass: number; bright: number; density: number; beaty: number }

// A known genre (station tag / recognized track) adds this to its family's score — a strong nudge the
// DSP can still override if it strongly disagrees.
export const PRIOR_BONUS = 1.6

export function scoreFamilies(o: SonicFeatures): Record<Family, number> {
  const { bpm, energy, bass, bright, density, beaty } = o
  const s = {} as Record<Family, number>
  for (const f of FAMILIES) s[f] = 0
  const add = (k: Family, v: number) => { s[k] += v }
  add('Ambient', (density < 0.28 ? 1 : 0) + (energy < 0.4 ? 0.8 : 0) + (beaty < 0.3 ? 0.9 : 0) + (bpm === 0 ? 0.6 : 0) + (bright < 0.4 ? 0.3 : 0))
  add('Lofi / Chill', (bpm > 60 && bpm < 112 ? 0.7 : 0) + (energy >= 0.3 && energy < 0.6 ? 0.7 : 0) + (bright >= 0.35 && bright < 0.55 ? 0.5 : 0) + (density >= 0.3 && density < 0.55 ? 0.5 : 0) + (bass > 0.45 && bass < 0.7 ? 0.3 : 0))
  add('Hip-hop', (bass > 0.55 ? 1 : 0) + (bpm >= 70 && bpm <= 108 ? 0.8 : 0) + (beaty > 0.45 ? 0.6 : 0) + (density < 0.6 ? 0.4 : 0) + (bright < 0.55 ? 0.2 : 0))
  add('Electronic', (bpm >= 118 && bpm <= 140 ? 1 : 0) + (energy > 0.55 ? 0.8 : 0) + (beaty > 0.55 ? 0.8 : 0) + (bright > 0.45 ? 0.4 : 0) + (density > 0.5 ? 0.3 : 0))
  add('Rock / Band', (energy > 0.55 ? 0.7 : 0) + (density > 0.55 ? 0.8 : 0) + (bright >= 0.4 && bright < 0.7 ? 0.5 : 0) + (bass < 0.5 ? 0.4 : 0) + (bpm >= 100 && bpm <= 165 ? 0.4 : 0) + (beaty > 0.5 ? 0.3 : 0))
  add('Pop', (bpm >= 100 && bpm <= 132 ? 0.6 : 0) + (bright > 0.5 ? 0.7 : 0) + (energy > 0.5 ? 0.5 : 0) + (density >= 0.4 && density < 0.75 ? 0.4 : 0) + (beaty > 0.4 && beaty < 0.75 ? 0.3 : 0))
  // Orchestral is the darkest + sparsest family (calibration: bright≈0.20, density≈0.25) — score those
  // directions, not their opposites. Ambient overlaps heavily here; the genre prior separates the two.
  add('Orchestral', (bright < 0.35 ? 0.7 : 0) + (density < 0.4 ? 0.5 : 0) + (energy < 0.45 ? 0.4 : 0) + (bass < 0.45 ? 0.4 : 0) + (beaty < 0.5 ? 0.3 : 0))
  return s
}

export interface FamilyResult { family: Family; confidence: number; scores: Record<Family, number> }

// prior = a known genre (from station tags / recognition) to bias toward.
export function classifyFamily(o: SonicFeatures, prior?: Family | null): FamilyResult {
  const scores = scoreFamilies(o)
  if (prior && scores[prior] != null) scores[prior] += PRIOR_BONUS
  const ranked = (Object.entries(scores) as [Family, number][]).sort((a, b) => b[1] - a[1])
  const family = ranked[0][0], top = ranked[0][1], second = ranked[1]?.[1] ?? 0
  const confidence = Math.max(0, Math.min(1, (top - second) / 1.4))
  return { family, confidence, scores }
}
