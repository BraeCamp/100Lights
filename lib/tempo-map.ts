// ── Tempo + meter map ────────────────────────────────────────────────────────
// Single source of truth for how BEAT positions relate to wall-clock SECONDS and
// to bar/beat notation across the timeline. Tempo and time signature can both
// change at points in the song; everything positional stays beat-native and only
// the beat→seconds mapping (for playback) and the bar grid (for notation/snap)
// consult this map.
//
// SAFETY PROPERTY — a project with no tempoMarkers / no meterMarkers collapses to
// a single segment, and the piecewise conversions below reduce to exactly the old
// single-tempo math (`beats * 60/bpm`) and a uniform `num`-beat bar. So marker-free
// projects (every existing project) cannot change behavior. The unit tests assert
// this collapse explicitly.
//
// Pure module: no React, no Web Audio, no DOM — Node-importable and unit-tested
// (scripts/tempo-map.test.mjs).

export interface TempoSegment { beat: number; bpm: number }
export interface MeterSegment { beat: number; num: number; den: number }

export interface TempoMarker { id: string; beat: number; tempo: number }
export interface MeterMarker { id: string; beat: number; num: number; den: number }

export interface TempoMapInput {
  tempo: number
  tempoMarkers?: TempoMarker[] | null
}
export interface MeterMapInput {
  timeSignatureNum: number
  timeSignatureDen: number
  meterMarkers?: MeterMarker[] | null
}

const EPS = 1e-6
export const MIN_BPM = 40
export const MAX_BPM = 300
export const clampBpm = (b: number) => Math.max(MIN_BPM, Math.min(MAX_BPM, b))

// ── Tempo ────────────────────────────────────────────────────────────────────

/**
 * Normalized, beat-sorted tempo segments, guaranteed to start at beat 0.
 * The segment at (or synthesized for) beat 0 uses `tempo` unless a marker already
 * pins beat 0 — matching the existing ADD_TEMPO_MARKER convention (it inserts a
 * beat-0 marker = project.tempo the first time a later marker is added).
 */
export function tempoSegments(p: TempoMapInput): TempoSegment[] {
  const raw = (p.tempoMarkers ?? [])
    .filter(m => m && Number.isFinite(m.beat) && Number.isFinite(m.tempo) && m.tempo > 0)
    .map(m => ({ beat: Math.max(0, m.beat), bpm: clampBpm(m.tempo) }))
    .sort((a, b) => a.beat - b.beat)
  const segs: TempoSegment[] = []
  for (const s of raw) {
    const last = segs[segs.length - 1]
    if (last && Math.abs(last.beat - s.beat) < EPS) segs[segs.length - 1] = s // same beat: last wins
    else if (last && Math.abs(last.bpm - s.bpm) < EPS) continue               // no-op change: drop
    else segs.push(s)
  }
  if (segs.length === 0 || segs[0].beat > EPS) {
    segs.unshift({ beat: 0, bpm: clampBpm(p.tempo) })
  }
  return segs
}

/** Wall-clock seconds from song start (beat 0) to `beat`, integrated over segments. */
export function beatToSeconds(beat: number, segs: TempoSegment[]): number {
  if (beat <= 0) return 0
  let sec = 0
  for (let i = 0; i < segs.length; i++) {
    const start = segs[i].beat
    if (beat <= start) break
    const end = i + 1 < segs.length ? segs[i + 1].beat : Infinity
    const span = Math.min(beat, end) - start
    sec += span * (60 / segs[i].bpm)
  }
  return sec
}

/** Inverse of {@link beatToSeconds}: the beat reached `sec` seconds into the song. */
export function secondsToBeat(sec: number, segs: TempoSegment[]): number {
  if (sec <= 0) return 0
  let acc = 0 // seconds elapsed at the current segment's start
  for (let i = 0; i < segs.length; i++) {
    const start = segs[i].beat
    const end = i + 1 < segs.length ? segs[i + 1].beat : Infinity
    const segSeconds = (end - start) * (60 / segs[i].bpm) // Infinity on the last segment
    if (sec <= acc + segSeconds) return start + (sec - acc) * (segs[i].bpm / 60)
    acc += segSeconds
  }
  const last = segs[segs.length - 1]
  return last.beat + (sec - acc) * (last.bpm / 60)
}

/** Seconds spanned between two absolute beats (signed; fromBeat may exceed toBeat). */
export function spanSeconds(fromBeat: number, toBeat: number, segs: TempoSegment[]): number {
  return beatToSeconds(toBeat, segs) - beatToSeconds(fromBeat, segs)
}

/** BPM in effect at `beat`. */
export function tempoAt(beat: number, segs: TempoSegment[]): number {
  let cur = segs[0]
  for (const s of segs) { if (s.beat <= beat + EPS) cur = s; else break }
  return cur.bpm
}

// ── Meter ──────────────────────────────────────────────────────────────────
// This app treats one BEAT as one grid division and puts `num` beats in a bar
// (the denominator is notation/metronome only — it does not change beat spacing),
// so meter math here is expressed in beats-per-bar = num, preserving the existing
// single-meter convention exactly.

/** Normalized, beat-sorted meter segments, guaranteed to start at beat 0. */
export function meterSegments(p: MeterMapInput): MeterSegment[] {
  const raw = (p.meterMarkers ?? [])
    .filter(m => m && Number.isFinite(m.beat) && m.num >= 1 && m.den >= 1)
    .map(m => ({ beat: Math.max(0, m.beat), num: Math.round(m.num), den: Math.round(m.den) }))
    .sort((a, b) => a.beat - b.beat)
  const segs: MeterSegment[] = []
  for (const s of raw) {
    const last = segs[segs.length - 1]
    if (last && Math.abs(last.beat - s.beat) < EPS) segs[segs.length - 1] = s
    else if (last && last.num === s.num && last.den === s.den) continue
    else segs.push(s)
  }
  const num0 = Math.max(1, Math.round(p.timeSignatureNum) || 4)
  const den0 = Math.max(1, Math.round(p.timeSignatureDen) || 4)
  if (segs.length === 0 || segs[0].beat > EPS) segs.unshift({ beat: 0, num: num0, den: den0 })
  return segs
}

/** Meter (num/den) in effect at `beat`. */
export function meterAt(beat: number, segs: MeterSegment[]): MeterSegment {
  let cur = segs[0]
  for (const s of segs) { if (s.beat <= beat + EPS) cur = s; else break }
  return cur
}

/** Beats-per-bar in effect at `beat` (= num, per this app's convention). */
export function beatsPerBarAt(beat: number, segs: MeterSegment[]): number {
  return meterAt(beat, segs).num
}

export interface BarLine { beat: number; bar: number; num: number; den: number }

/**
 * Bar-start lines whose start beat falls in [fromBeat, toBeat]. Bars are `num`
 * beats long; a meter change that lands mid-bar forces a new bar at the change
 * (standard DAW behavior), so bars can have irregular length only across a change.
 * `bar` is the 0-based running bar index (display = bar + 1).
 */
export function barLines(segs: MeterSegment[], fromBeat: number, toBeat: number): BarLine[] {
  const out: BarLine[] = []
  if (toBeat < 0) return out
  let beat = 0
  let bar = 0
  let si = 0
  const GUARD = 2_000_000
  for (let n = 0; beat <= toBeat + EPS && n < GUARD; n++) {
    while (si + 1 < segs.length && segs[si + 1].beat <= beat + EPS) si++
    const seg = segs[si]
    if (beat >= fromBeat - EPS) out.push({ beat, bar, num: seg.num, den: seg.den })
    const nextMeterBeat = si + 1 < segs.length ? segs[si + 1].beat : Infinity
    let next = beat + Math.max(1, seg.num)
    if (nextMeterBeat < next - EPS) next = nextMeterBeat // meter change breaks the bar early
    beat = next
    bar++
  }
  return out
}

/** Nearest bar boundary to `beat`, honoring meter changes (for 'bar' snapping). */
export function nearestBarBeat(beat: number, segs: MeterSegment[]): number {
  if (beat <= 0) return 0
  // Walk bars until we pass `beat`; compare the bracketing boundaries.
  let cur = 0
  let si = 0
  let prev = 0
  const GUARD = 2_000_000
  for (let n = 0; n < GUARD; n++) {
    while (si + 1 < segs.length && segs[si + 1].beat <= cur + EPS) si++
    const nextMeterBeat = si + 1 < segs.length ? segs[si + 1].beat : Infinity
    let next = cur + Math.max(1, segs[si].num)
    if (nextMeterBeat < next - EPS) next = nextMeterBeat
    if (next >= beat - EPS) {
      return (beat - cur) <= (next - beat) ? cur : next
    }
    prev = cur
    cur = next
  }
  return prev
}
