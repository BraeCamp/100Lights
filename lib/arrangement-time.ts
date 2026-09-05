// ── Time commands across the whole song ─────────────────────────────────────
//
// Live's Insert Silence, Delete Time and Duplicate Time: a span of the
// arrangement opens up, closes up, or repeats, and EVERYTHING moves with it.
// The clip-level versions landed in Batch 2 (lib/clip-time.ts); these are the
// arrangement's, and the difference is what has to move.
//
// ⚠️ EVERYTHING MEANS EVERYTHING. A time command that moved the clips and left
// the automation, the markers and the tempo changes where they were would look
// right for about a bar and then be wrong for the rest of the song — the fade
// that belonged to the chorus now happening two bars early, and no obvious
// reason why. Clips, automation points, cue markers, tempo markers and meter
// markers all shift together, or none of them do.
//
// Everything here is pure and works in BEATS. The tempo map is what turns
// beats into seconds, and it moves with the rest — so inserting four beats at
// bar 5 keeps every later section the same length in bars, which is what
// "insert four beats" means to a person.

import type { AutomationLane, CueMarker, DawClip, DawProject } from './daw-types'

/** The part of a project a time command touches. */
export type TimeShiftable = Pick<DawProject,
  'arrangementClips' | 'automationLanes' | 'cueMarkers' | 'tempoMarkers' | 'meterMarkers'>

const EPS = 1e-6

/** Move one beat position by a command that inserts `amount` at `from`. */
function shifted(beat: number, from: number, amount: number): number {
  return beat >= from - EPS ? beat + amount : beat
}

/**
 * Everything at or after `from` moves later by `amount` beats.
 *
 * A clip that STRADDLES the point is stretched rather than moved: the silence
 * is being inserted inside it, and a clip that jumped forward instead would
 * leave a hole where its first half was.
 */
export function insertTime<P extends TimeShiftable>(project: P, from: number, amount: number): P {
  if (!(amount > 0)) return project
  return {
    ...project,
    arrangementClips: project.arrangementClips.map(c => {
      if (c.startBeat >= from - EPS) return { ...c, startBeat: c.startBeat + amount } as DawClip
      if (c.startBeat + c.durationBeats > from + EPS) return { ...c, durationBeats: c.durationBeats + amount } as DawClip
      return c
    }),
    automationLanes: (project.automationLanes ?? []).map(l => ({
      ...l, points: (l.points ?? []).map(p => ({ ...p, beat: shifted(p.beat, from, amount) })),
    })) as AutomationLane[],
    cueMarkers: (project.cueMarkers ?? []).map(m => ({ ...m, beat: shifted(m.beat, from, amount) })) as CueMarker[],
    // ⚠️ Never the marker at beat 0: it is the song's opening tempo and meter,
    // and moving it would leave the first bars with no tempo at all.
    tempoMarkers: (project.tempoMarkers ?? []).map(m => (m.beat <= EPS ? m : { ...m, beat: shifted(m.beat, from, amount) })),
    meterMarkers: (project.meterMarkers ?? []).map(m => (m.beat <= EPS ? m : { ...m, beat: shifted(m.beat, from, amount) })),
  }
}

/**
 * The span [from, to) is taken out and everything after it closes up.
 *
 * A clip wholly inside the span goes. One that overlaps it loses the part
 * inside — trimmed at the edge rather than deleted, because deleting a clip
 * somebody only meant to shorten is the kind of surprise that costs an undo
 * and a bit of trust.
 */
export function deleteTime<P extends TimeShiftable>(project: P, from: number, to: number): P {
  const span = to - from
  if (!(span > 0)) return project
  const clips: DawClip[] = []
  for (const c of project.arrangementClips) {
    const end = c.startBeat + c.durationBeats
    if (c.startBeat >= to - EPS) { clips.push({ ...c, startBeat: c.startBeat - span } as DawClip); continue }
    if (end <= from + EPS) { clips.push(c); continue }
    if (c.startBeat >= from - EPS && end <= to + EPS) continue          // wholly inside: gone
    if (c.startBeat < from + EPS && end > to - EPS) {                    // straddles: shorter
      clips.push({ ...c, durationBeats: c.durationBeats - span } as DawClip); continue
    }
    if (c.startBeat < from + EPS) {                                      // overlaps the start
      clips.push({ ...c, durationBeats: from - c.startBeat } as DawClip); continue
    }
    clips.push({ ...c, startBeat: from, durationBeats: end - to } as DawClip)   // overlaps the end
  }
  const move = (beat: number) => (beat >= to - EPS ? beat - span : beat >= from - EPS ? from : beat)
  return {
    ...project,
    arrangementClips: clips.filter(c => c.durationBeats > EPS),
    automationLanes: (project.automationLanes ?? []).map(l => ({
      ...l,
      // A point inside the span lands on the seam; two on the same beat are
      // one point, and the later one is what the song sounded like there.
      points: dedupe((l.points ?? []).map(p => ({ ...p, beat: move(p.beat) }))),
    })) as AutomationLane[],
    cueMarkers: (project.cueMarkers ?? []).filter(m => !(m.beat >= from - EPS && m.beat < to - EPS)).map(m => ({ ...m, beat: move(m.beat) })) as CueMarker[],
    tempoMarkers: (project.tempoMarkers ?? []).filter(m => m.beat <= EPS || !(m.beat >= from - EPS && m.beat < to - EPS)).map(m => (m.beat <= EPS ? m : { ...m, beat: move(m.beat) })),
    meterMarkers: (project.meterMarkers ?? []).filter(m => m.beat <= EPS || !(m.beat >= from - EPS && m.beat < to - EPS)).map(m => (m.beat <= EPS ? m : { ...m, beat: move(m.beat) })),
  }
}

/** Two points on the same beat are one point; the last one wins. */
function dedupe<T extends { beat: number }>(points: T[]): T[] {
  const sorted = [...points].sort((a, b) => a.beat - b.beat)
  const out: T[] = []
  for (const p of sorted) {
    if (out.length && Math.abs(out[out.length - 1].beat - p.beat) < EPS) out[out.length - 1] = p
    else out.push(p)
  }
  return out
}

/**
 * The span happens twice: a copy is inserted directly after it, and everything
 * later moves along. The copies are new objects with new ids, so editing one
 * repeat does not edit the other.
 */
export function duplicateTime<P extends TimeShiftable>(project: P, from: number, to: number, makeId: () => string): P {
  const span = to - from
  if (!(span > 0)) return project
  const opened = insertTime(project, to, span)
  const copies: DawClip[] = []
  for (const c of project.arrangementClips) {
    const end = c.startBeat + c.durationBeats
    if (end <= from + EPS || c.startBeat >= to - EPS) continue
    const start = Math.max(c.startBeat, from)
    const stop = Math.min(end, to)
    copies.push({ ...c, id: makeId(), startBeat: start + span, durationBeats: stop - start } as DawClip)
  }
  const copiedPoints = (l: AutomationLane) =>
    (l.points ?? []).filter(p => p.beat >= from - EPS && p.beat < to - EPS).map(p => ({ ...p, beat: p.beat + span }))
  return {
    ...opened,
    arrangementClips: [...opened.arrangementClips, ...copies],
    automationLanes: opened.automationLanes.map((l, i) => ({
      ...l, points: dedupe([...(l.points ?? []), ...copiedPoints(project.automationLanes[i] ?? l)]),
    })),
    cueMarkers: [
      ...opened.cueMarkers,
      ...(project.cueMarkers ?? []).filter(m => m.beat >= from - EPS && m.beat < to - EPS)
        .map(m => ({ ...m, id: makeId(), beat: m.beat + span })),
    ],
  }
}

/** "four beats at bar 3" — what a time command is about to do, for the read-back. */
export function describeTimeSpan(from: number, amount: number, beatsPerBar: number): string {
  const bar = beatsPerBar > 0 ? beatsPerBar : 4
  const bars = amount / bar
  const length = Math.abs(bars - Math.round(bars)) < 0.01 ? `${Math.round(bars)} bar${Math.round(bars) === 1 ? '' : 's'}` : `${+amount.toFixed(2)} beats`
  return `${length} at bar ${Math.floor(from / bar) + 1}`
}
