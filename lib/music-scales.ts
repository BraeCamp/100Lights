// Shared musical brains (Phase 4 of "Helios as the shared DSP core"): scale
// snapping and arpeggio ordering used by BOTH Beacon's MIDI effects and
// Apollo-side helpers, so a music-theory fix lands once, not per app.
//
// The Apollo worklet (public/apollo/engine.js) cannot import modules — it
// carries its own copy of snapScale. KEEP THE MATH IN SYNC: the signed
// octave-wrap here matches the engine's snapScale (a note just under the
// root must snap UP 1 semitone to the next root, not 11 semitones down).

export const SCALE_INTERVALS: Record<string, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  'harmonic-minor': [0, 2, 3, 5, 7, 8, 11],
  'melodic-minor': [0, 2, 3, 5, 7, 9, 11],
  'penta-maj': [0, 2, 4, 7, 9],
  'penta-min': [0, 3, 5, 7, 10],
  blues: [0, 3, 5, 6, 7, 10],
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
}

/** Snap a MIDI pitch to the nearest tone of a scale, with signed octave wrap. */
export function snapToScale(pitch: number, root: number, intervals: number[]): number {
  if (!intervals.length) return pitch
  const rel = ((pitch - root) % 12 + 12) % 12
  let delta = 0, best = 99
  for (const iv of intervals) {
    let d = iv - rel
    if (d > 6) d -= 12
    if (d < -6) d += 12
    if (Math.abs(d) < best) { best = Math.abs(d); delta = d }
  }
  return pitch + delta
}

export type ArpStyle = 'up' | 'down' | 'updown' | 'downup' | 'converge' | 'random' | 'asplayed'

/**
 * Order a set of pitches the way Apollo's arpeggiator does, expanded across
 * octaves. 'random' uses a Fisher–Yates shuffle (Array.sort(random) is biased).
 */
export function arpeggiate(pitches: number[], style: ArpStyle, octaves = 1): number[] {
  const base = style === 'asplayed' ? [...pitches] : [...pitches].sort((a, b) => a - b)
  const pool: number[] = []
  for (let o = 0; o < Math.max(1, octaves); o++) for (const p of base) pool.push(p + o * 12)
  switch (style) {
    case 'down': return pool.reverse()
    case 'updown': return pool.concat(pool.slice(1, -1).reverse())
    case 'downup': { const r = [...pool].reverse(); return r.concat(r.slice(1, -1).reverse()) }
    case 'converge': {
      const out: number[] = []
      let lo = 0, hi = pool.length - 1
      while (lo <= hi) { out.push(pool[lo++]); if (lo <= hi) out.push(pool[hi--]) }
      return out
    }
    case 'random': {
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[pool[i], pool[j]] = [pool[j], pool[i]]
      }
      return pool
    }
    default: return pool
  }
}
