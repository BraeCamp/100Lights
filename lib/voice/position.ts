// WHERE and HOW LONG, in the terms musicians actually use.
//
// Brae: "keep in mind time signatures, bpm, locations (which bar, what time)".
//
// The first version of the voice layer took a single tempo and a single
// beats-per-bar off the project and multiplied. That is right for exactly one
// kind of song — constant tempo, constant meter — and quietly wrong for every
// other. "Move everything over by one bar" is four beats in 4/4 and three in
// 3/4; "the first 8 seconds" is sixteen beats at 120 and eleven at 80; and a
// song that changes tempo half way through has no single answer at all.
//
// lib/tempo-map.ts already solves this properly and is the app's source of
// truth for both maps, so everything here goes through it. The rules that fall
// out are the ones a musician would state:
//
//   A bar is as long as the meter says AT THAT POINT in the song.
//   A second is as long as the tempo says AT THAT POINT in the song.
//   Bars and beats are counted from ONE, because that is how they are spoken
//   and printed. Internally everything is a 0-based beat, and the conversion
//   happens here rather than in five different callers.

import {
  tempoSegments, meterSegments, beatToSeconds, secondsToBeat,
  beatsPerBarAt, barLines, type TempoSegment, type MeterSegment,
} from '../tempo-map'

/** Both maps for one song, built once and passed around. */
export interface MusicMaps { tempo: TempoSegment[]; meter: MeterSegment[] }

export interface MapSource {
  tempo?: number
  timeSignatureNum?: number
  timeSignatureDen?: number
  tempoMarkers?: { id: string; beat: number; tempo: number }[]
  meterMarkers?: { id: string; beat: number; num: number; den: number }[]
}

export function musicMaps(p: MapSource): MusicMaps {
  return {
    tempo: tempoSegments({
      tempo: p.tempo ?? 120,
      tempoMarkers: p.tempoMarkers ?? [],
    } as Parameters<typeof tempoSegments>[0]),
    meter: meterSegments({
      timeSignatureNum: p.timeSignatureNum ?? 4,
      timeSignatureDen: p.timeSignatureDen ?? 4,
      meterMarkers: p.meterMarkers ?? [],
    } as Parameters<typeof meterSegments>[0]),
  }
}

// ── Where ───────────────────────────────────────────────────────────────────

/**
 * A place in the song, said the way people say it.
 *
 *   { bar: 5 }             the downbeat of bar 5
 *   { bar: 5, beat: 3 }    the third beat of bar 5
 *   { seconds: 32 }        thirty-two seconds in
 *   { beats: 16 }          sixteen beats in — the app's own unit, for exactness
 *
 * All four are absolute positions in the arrangement. Relative moves are a
 * DURATION, which is a different type on purpose: "at bar 5" and "by 5 bars"
 * are not the same instruction and conflating them is how a command puts a
 * crash in the wrong place.
 */
export interface MusicPosition {
  bar?: number | null
  beat?: number | null
  seconds?: number | null
  beats?: number | null
}

/** The absolute beat a bar's downbeat sits on. Bars are counted from 1. */
export function barStartBeat(bar: number, maps: MusicMaps): number {
  const want = Math.max(1, Math.round(bar))
  // Ask the map for enough bars to reach it rather than multiplying, so a meter
  // change part-way through moves every later bar by the right amount.
  const lines = barLines(maps.meter, 0, (want + 2) * 32)
  const line = lines.find(l => l.bar === want - 1)
  if (line) return line.beat
  // Past the end of what we asked for: extend using the final meter.
  const last = lines[lines.length - 1]
  if (!last) return 0
  return last.beat + (want - 1 - last.bar) * Math.max(1, last.num)
}

/** A spoken position as an absolute beat, or null when nothing was said. */
export function positionToBeat(pos: MusicPosition | null | undefined, maps: MusicMaps): number | null {
  if (!pos) return null
  if (pos.beats != null && Number.isFinite(pos.beats)) return Math.max(0, pos.beats)
  if (pos.seconds != null && Number.isFinite(pos.seconds)) {
    return Math.max(0, secondsToBeat(pos.seconds, maps.tempo))
  }
  if (pos.bar != null && Number.isFinite(pos.bar)) {
    const start = barStartBeat(pos.bar, maps)
    // "bar 5 beat 3" — beats within a bar are also counted from 1.
    const within = pos.beat != null && Number.isFinite(pos.beat) ? Math.max(1, pos.beat) - 1 : 0
    return start + within
  }
  // A bare beat number with no bar is a beat WITHIN bar 1, which is how someone
  // says "on beat 3" at the top of a song.
  if (pos.beat != null && Number.isFinite(pos.beat)) return Math.max(0, Math.max(1, pos.beat) - 1)
  return null
}

// ── How long ────────────────────────────────────────────────────────────────

/**
 * A length of time, said the way people say it. Unlike a position, this is
 * relative — and it depends on WHERE it starts, because both the meter and the
 * tempo can change under it.
 */
export interface MusicDuration {
  bars?: number | null
  beats?: number | null
  seconds?: number | null
}

/**
 * A spoken duration in beats, measured from `atBeat`.
 *
 * Bars walk the meter map rather than multiplying, so two bars spanning a 4/4 →
 * 3/4 change is seven beats, not eight. Seconds walk the tempo map for the same
 * reason. Null means nothing was said, which a caller must be able to tell from
 * a duration of zero.
 */
export function durationToBeats(
  d: MusicDuration | null | undefined,
  atBeat: number,
  maps: MusicMaps,
): number | null {
  if (!d) return null
  if (d.beats != null && Number.isFinite(d.beats)) return d.beats
  if (d.bars != null && Number.isFinite(d.bars)) {
    const n = d.bars
    if (n === 0) return 0
    const sign = n < 0 ? -1 : 1
    let beat = atBeat
    let total = 0
    for (let i = 0; i < Math.abs(Math.round(n)); i++) {
      const len = Math.max(1, beatsPerBarAt(sign > 0 ? beat : beat - 1, maps.meter))
      total += len
      beat += sign * len
    }
    return sign * total
  }
  if (d.seconds != null && Number.isFinite(d.seconds)) {
    const startSec = beatToSeconds(atBeat, maps.tempo)
    return secondsToBeat(startSec + d.seconds, maps.tempo) - atBeat
  }
  return null
}

// ── Saying it back ──────────────────────────────────────────────────────────

/**
 * "bar 5", or "bar 5 beat 3" when it is not on the downbeat.
 *
 * Read-back is not decoration: the whole safety story of voice control is that
 * the user can hear where the edit landed. Saying "beat 17" would be true and
 * useless — nobody counts a song in absolute beats.
 */
export function describeBeat(beat: number, maps: MusicMaps): string {
  const lines = barLines(maps.meter, 0, Math.max(beat + 8, 8))
  let line = lines[0]
  for (const l of lines) { if (l.beat <= beat + 1e-6) line = l; else break }
  if (!line) return `beat ${+beat.toFixed(2)}`
  const within = beat - line.beat
  const bar = line.bar + 1
  if (within < 1e-6) return `bar ${bar}`
  return `bar ${bar} beat ${+(within + 1).toFixed(2)}`
}

/** "2 bars", "8 seconds" — whichever unit the user used, for the read-back. */
export function describeDuration(d: MusicDuration, beats: number): string {
  if (d.bars != null) return `${+d.bars.toFixed(2)} bar${Math.abs(d.bars) === 1 ? '' : 's'}`
  if (d.seconds != null) return `${+d.seconds.toFixed(2)}s`
  return `${+beats.toFixed(2)} beat${Math.abs(beats) === 1 ? '' : 's'}`
}

/** Seconds at a point in the song, honouring tempo changes — for read-back. */
export const beatSeconds = (beat: number, maps: MusicMaps): number => beatToSeconds(beat, maps.tempo)
