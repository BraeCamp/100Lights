// The status bar's arithmetic (Live's Status Bar and Info View, bottom of
// the screen): what the selection is — start, end, length, in bars.beats and
// in clock time — and how a clock reads. Pure; the bar itself is
// components/editor/daw/StatusBar.tsx.

import { tempoSegments, beatToSeconds } from './tempo-map'
import type { DawClip, DawProject } from './daw-types'

/** 0:04.500 — minutes, seconds, milliseconds. */
export function formatClock(sec: number): string {
  const s = Math.max(0, sec)
  const m = Math.floor(s / 60)
  const rest = s - m * 60
  const whole = Math.floor(rest)
  const ms = Math.round((rest - whole) * 1000)
  return `${m}:${String(whole).padStart(2, '0')}.${String(ms).padStart(3, '0')}`
}

/** bar.beat.sixteenth — 1-based, the way the ruler counts. */
export function formatPosition(beat: number, beatsPerBar = 4): string {
  const bar = Math.floor(beat / beatsPerBar) + 1
  const inBar = beat - (bar - 1) * beatsPerBar
  const b = Math.floor(inBar) + 1
  const sixteenth = Math.floor((inBar - Math.floor(inBar)) * 4) + 1
  return `${bar}.${b}.${sixteenth}`
}

/** "2 bars", "1 bar 2 beats", "3 beats" — a length in words the ruler uses. */
export function formatLength(beats: number, beatsPerBar = 4): string {
  const bars = Math.floor(beats / beatsPerBar)
  const rest = Math.round((beats - bars * beatsPerBar) * 100) / 100
  const parts: string[] = []
  if (bars) parts.push(`${bars} bar${bars === 1 ? '' : 's'}`)
  if (rest) parts.push(`${rest} beat${rest === 1 ? '' : 's'}`)
  return parts.join(' ') || '0 beats'
}

export interface SelectionSummary {
  count: number
  startBeat: number
  endBeat: number
  position: string
  end: string
  length: string
  startClock: string
  endClock: string
  lengthClock: string
}

/** The span the selected clips cover, in both the grid's and the clock's terms. */
export function summarizeSelection(clips: DawClip[], project: Pick<DawProject, 'tempo' | 'tempoMarkers' | 'timeSignatureNum'>): SelectionSummary | null {
  if (!clips.length) return null
  const bpb = project.timeSignatureNum ?? 4
  const startBeat = Math.min(...clips.map(c => c.startBeat))
  const endBeat = Math.max(...clips.map(c => c.startBeat + c.durationBeats))
  const segs = tempoSegments(project)
  const s0 = beatToSeconds(startBeat, segs), s1 = beatToSeconds(endBeat, segs)
  return {
    count: clips.length,
    startBeat, endBeat,
    position: formatPosition(startBeat, bpb),
    end: formatPosition(endBeat, bpb),
    length: formatLength(endBeat - startBeat, bpb),
    startClock: formatClock(s0),
    endClock: formatClock(s1),
    lengthClock: formatClock(s1 - s0),
  }
}
