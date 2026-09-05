// Warp markers — the map between a clip's beats and its sample's seconds.
//
// Live's warping is one idea: a list of markers, each pinning a moment in
// the sample (seconds into the buffer) to a moment in the clip (beats from
// its start). Between two markers the sample plays at whatever speed makes
// them both land; beyond the ends it keeps the nearest span's speed. Every
// warp command is an edit to that list — Set 1.1.1 Here, Warp From Here
// (Straight), Warp as N-Bar Loop, Warp at a BPM, Quantize the transients —
// and the engine renders the sample through the map (lib/warp-render.ts).
// All of it is pure and unit-tested; the Sample Editor, the palette and the
// voice path share it.
//
// Markers are kept sorted and strictly increasing in BOTH beat and second: a
// marker cannot sit before its neighbour in time, or audio would have to run
// backwards.

export interface WarpMarker {
  /** Beats from the clip's start. */
  beat: number
  /** Seconds into the sample's buffer. */
  sec: number
}

const EPS = 1e-6
const round = (n: number) => Math.round(n * 1e6) / 1e6

/** Sorted by beat, duplicates dropped. */
export function sortMarkers(ms: WarpMarker[]): WarpMarker[] {
  const out = [...ms].sort((a, b) => a.beat - b.beat || a.sec - b.sec)
  return out.filter((m, i) => i === 0 || m.beat > out[i - 1].beat + EPS)
}

/** Two or more markers, strictly increasing in beat and in second — the only lists the engine plays. */
export function validMarkers(ms: WarpMarker[] | undefined | null): WarpMarker[] | null {
  if (!ms || ms.length < 2) return null
  const s = sortMarkers(ms)
  for (let i = 1; i < s.length; i++) if (s[i].sec <= s[i - 1].sec + EPS) return null
  return s.length >= 2 ? s : null
}

/** Seconds of sample per beat inside a span. */
const rateOf = (a: WarpMarker, b: WarpMarker) => (b.sec - a.sec) / (b.beat - a.beat)

/** Where a beat sits in the sample, through the map; the nearest span's speed beyond the ends. */
export function beatToSec(ms: WarpMarker[], beat: number): number {
  const s = sortMarkers(ms)
  if (s.length === 0) return beat
  if (s.length === 1) return s[0].sec + (beat - s[0].beat)
  if (beat <= s[0].beat) return s[0].sec + (beat - s[0].beat) * rateOf(s[0], s[1])
  for (let i = 1; i < s.length; i++) {
    if (beat <= s[i].beat + EPS) return s[i - 1].sec + (beat - s[i - 1].beat) * rateOf(s[i - 1], s[i])
  }
  const a = s[s.length - 2], b = s[s.length - 1]
  return b.sec + (beat - b.beat) * rateOf(a, b)
}

/** The inverse: which beat a moment of the sample lands on. */
export function secToBeat(ms: WarpMarker[], sec: number): number {
  const s = sortMarkers(ms)
  if (s.length === 0) return sec
  if (s.length === 1) return s[0].beat + (sec - s[0].sec)
  if (sec <= s[0].sec) return s[0].beat + (sec - s[0].sec) / rateOf(s[0], s[1])
  for (let i = 1; i < s.length; i++) {
    if (sec <= s[i].sec + EPS) return s[i - 1].beat + (sec - s[i - 1].sec) / rateOf(s[i - 1], s[i])
  }
  const a = s[s.length - 2], b = s[s.length - 1]
  return b.beat + (sec - b.sec) / rateOf(a, b)
}

/**
 * A marker added at (beat, sec). The second is clamped between its
 * neighbours so the list stays playable; a marker already on that beat is
 * replaced.
 */
export function insertMarker(ms: WarpMarker[], beat: number, sec: number): WarpMarker[] {
  const s = sortMarkers(ms).filter(m => Math.abs(m.beat - beat) > EPS)
  const prev = [...s].reverse().find(m => m.beat < beat)
  const next = s.find(m => m.beat > beat)
  let sc = sec
  if (prev) sc = Math.max(sc, prev.sec + 0.001)
  if (next) sc = Math.min(sc, next.sec - 0.001)
  if (prev && next && sc <= prev.sec + EPS) return s   // no room
  return sortMarkers([...s, { beat: round(beat), sec: round(sc) }])
}

/** The marker at `index` moved to a new second — the audio slides under the grid; clamped between its neighbours. */
export function moveMarker(ms: WarpMarker[], index: number, sec: number): WarpMarker[] {
  const s = sortMarkers(ms)
  if (index < 0 || index >= s.length) return s
  const prev = s[index - 1], next = s[index + 1]
  let sc = sec
  if (prev) sc = Math.max(sc, prev.sec + 0.001)
  if (next) sc = Math.min(sc, next.sec - 0.001)
  return s.map((m, i) => (i === index ? { ...m, sec: round(sc) } : m))
}

/** The marker at `index` moved to another beat (⇧-drag) — clamped between its neighbours' beats. */
export function moveMarkerBeat(ms: WarpMarker[], index: number, beat: number): WarpMarker[] {
  const s = sortMarkers(ms)
  if (index < 0 || index >= s.length) return s
  const prev = s[index - 1], next = s[index + 1]
  let b = beat
  if (prev) b = Math.max(b, prev.beat + 0.001)
  if (next) b = Math.min(b, next.beat - 0.001)
  return s.map((m, i) => (i === index ? { ...m, beat: round(b) } : m))
}

export function removeMarker(ms: WarpMarker[], index: number): WarpMarker[] {
  return sortMarkers(ms).filter((_, i) => i !== index)
}

/**
 * Set 1.1.1 Here: the moment `sec` of the sample becomes the clip's first
 * beat. Markers before it go; the ones after keep their place in the sample
 * and take the beats the old map gave them, re-based so this one is 0.
 */
export function set111Here(ms: WarpMarker[], sec: number): WarpMarker[] {
  const s = sortMarkers(ms)
  const beatHere = s.length >= 2 ? secToBeat(s, sec) : 0
  const kept = s.filter(m => m.sec > sec + 0.001).map(m => ({ beat: round(m.beat - beatHere), sec: m.sec }))
  return sortMarkers([{ beat: 0, sec: round(sec) }, ...kept])
}

/** Warp From Here (Straight): one steady speed from `sec` to the end of the sample, spanning `beats` beats. */
export function warpStraight(sec: number, endSec: number, beats: number): WarpMarker[] {
  if (!(endSec > sec) || !(beats > 0)) return []
  return [{ beat: 0, sec: round(sec) }, { beat: round(beats), sec: round(endSec) }]
}

/** Warp as N-Bar Loop: the whole sample (from `sec`) is exactly N bars. */
export function warpAsLoop(sec: number, endSec: number, bars: number, barBeats = 4): WarpMarker[] {
  return warpStraight(sec, endSec, bars * barBeats)
}

/** Warp at a BPM From Here: the sample plays straight at its own tempo — its seconds become beats at that BPM. */
export function warpAtBpm(sec: number, endSec: number, bpm: number): WarpMarker[] {
  if (!(bpm > 0)) return []
  return warpStraight(sec, endSec, ((endSec - sec) * bpm) / 60)
}

/**
 * Quantize the transients: each attack (seconds in the sample) is pinned to
 * the grid beat nearest the beat the current map gives it. Attacks that
 * would fall out of order are skipped — the list stays playable.
 */
export function quantizeTransients(ms: WarpMarker[], onsetsSec: number[], grid: number, amount = 1): WarpMarker[] {
  const base = validMarkers(ms) ?? (ms.length ? sortMarkers(ms) : [])
  if (!(grid > 0) || base.length < 2) return base
  let out = base
  for (const sec of [...onsetsSec].sort((a, b) => a - b)) {
    const b = secToBeat(base, sec)
    const target = b + (Math.round(b / grid) * grid - b) * amount
    if (target < -EPS) continue
    const next = insertMarker(out, target, sec)
    if (next.length > out.length || next.some((m, i) => m.sec !== out[i]?.sec)) out = next
  }
  return out
}

/** The beat the sample's end lands on, through the map — how long the clip is when it follows its markers. */
export function beatsThroughMap(ms: WarpMarker[], endSec: number): number {
  return Math.max(0, round(secToBeat(ms, endSec)))
}

/** A short stable key for a marker list — cache keys and stamps. */
export function markersKey(ms: WarpMarker[]): string {
  return sortMarkers(ms).map(m => `${m.beat.toFixed(4)}@${m.sec.toFixed(4)}`).join(',')
}
