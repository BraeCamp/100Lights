// Apollo's arpeggiator, printed into real Beacon notes.
//
// The arp is a live performer inside the worklet: it reads the held chord and
// fires notes as the clock passes. Nothing it plays is ever written down, so a
// pattern you like exists only as long as you hold the keys. This reproduces
// its note choices as data, so the result lands in the piano roll where it can
// be edited, quantised, or handed to another instrument.
//
// The ordering, gate, swing, transpose and scale-lock logic below is a
// deliberate line-for-line port of engine.js (arpPool / stepSequencer /
// snapScale). It has to stay a port: if the two drift, printing an arp stops
// matching what you just heard, which is worse than not printing at all.

import { SCALES, SYNC_RATES, type ApolloPatch, type ArpConfig } from '@/lib/apollo/patch'

export interface PrintedNote { pitch: number; startBeat: number; durationBeats: number; velocity: number }

/** Arp notes carry a fixed velocity in the engine — the per-step `vel` in a
 *  pattern is read for `on` only. Mirrored here so a print sounds like the
 *  performance rather than like an improvement on it. */
const ARP_VELOCITY = 0.85

/** engine.js snapScale, verbatim in behaviour. */
export function snapToScale(note: number, scaleName: string, scaleRoot: number): number {
  const iv = SCALES[scaleName] ?? SCALES.Minor
  const rel = (((note - scaleRoot) % 12) + 12) % 12
  let delta = 0, bd = 99
  for (const s of iv) {
    let d = s - rel
    if (d > 6) d -= 12
    if (d < -6) d += 12
    if (Math.abs(d) < bd) { bd = Math.abs(d); delta = d }
  }
  return note + delta
}

/** engine.js arpPool: held notes, octave-stacked, then reordered by mode. */
export function arpPool(arp: ArpConfig, held: number[]): number[] {
  if (!held.length) return []
  const base = arp.mode === 'asplayed' ? held.slice() : held.slice().sort((a, b) => a - b)
  const pool: number[] = []
  for (let o = 0; o < Math.max(1, arp.octaves); o++) for (const n of base) pool.push(n + o * 12)
  switch (arp.mode) {
    case 'down': pool.reverse(); break
    case 'updown': return pool.concat(pool.slice(1, -1).reverse())
    case 'downup': {
      const r = pool.slice().reverse()
      return r.concat(r.slice(1, -1).reverse())
    }
    case 'converge': {
      const out: number[] = []
      let lo = 0, hi = pool.length - 1
      while (lo <= hi) { out.push(pool[lo++]); if (lo <= hi) out.push(pool[hi--]) }
      return out
    }
    case 'diverge': {
      const out: number[] = []
      const mid = pool.length >> 1
      let l = mid - 1, r2 = mid
      while (r2 < pool.length || l >= 0) { if (r2 < pool.length) out.push(pool[r2++]); if (l >= 0) out.push(pool[l--]) }
      return out
    }
  }
  return pool
}

/**
 * Run the arp over `lengthBeats` against a held chord and return the notes.
 *
 * `random` mode takes a seed so a print is reproducible — an arp you can't
 * reproduce isn't something you can commit to a clip and keep working on.
 */
export function printArp(
  patch: ApolloPatch,
  held: number[],
  lengthBeats: number,
  opts: { seed?: number } = {},
): PrintedNote[] {
  const arp = patch.arp
  const pool = arpPool(arp, held)
  if (!pool.length || lengthBeats <= 0) return []

  const stepBeats = SYNC_RATES[Math.max(0, Math.min(SYNC_RATES.length - 1, Math.round(arp.syncRate)))]?.beats ?? 0.25
  if (stepBeats <= 0) return []
  const gate = Math.max(0.05, Math.min(2, arp.gate))
  const snap = arp.scaleLock || patch.global.scaleLock

  // Small deterministic PRNG, so 'random' prints the same notes every time.
  let seed = (opts.seed ?? 1) >>> 0
  const rng = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 0x100000000
  }

  const out: PrintedNote[] = []
  let step = 0
  let beat = 0
  while (beat < lengthBeats) {
    const swing = step % 2 === 1 ? arp.swing * stepBeats * 0.33 : 0
    const at = beat + swing
    if (at >= lengthBeats) break

    let note: number | null = null
    if (arp.mode === 'random') note = pool[Math.floor(rng() * pool.length)]
    else if (arp.mode === 'pattern') {
      const pat = arp.pattern
      const ps = pat.length ? pat[step % pat.length] : null
      if (ps && ps.on) note = pool[(((ps.step % pool.length) + pool.length) % pool.length)]
    } else note = pool[step % pool.length]

    if (note != null) {
      let n = note + arp.transpose
      if (snap) n = snapToScale(n, patch.global.scaleName, patch.global.scaleRoot)
      // The engine holds a note for gate*step and releases on the next step,
      // so the printed length is clamped to the span for the final note.
      out.push({
        pitch: Math.max(0, Math.min(127, Math.round(n))),
        startBeat: at,
        durationBeats: Math.max(1 / 32, Math.min(stepBeats * gate, lengthBeats - at)),
        velocity: ARP_VELOCITY,
      })
    }
    step++
    beat += stepBeats
  }
  return out
}

/** The chord an arp should run against when the user has not played one:
 *  the notes already under the playhead in the track's clip, deduped. */
export function chordFromNotes(pitches: number[]): number[] {
  return [...new Set(pitches)].sort((a, b) => a - b)
}
