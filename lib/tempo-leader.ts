// Tempo leader (Live's "Master" switch in the clip's warp section, "Leader"
// since 11): ONE audio clip's own tempo drives the set. The song's tempo map
// is rewritten from the clip's warp markers — every pair of markers is a
// segment whose BPM is its beats over its seconds — so the leader plays as
// recorded (each warp span's wall time is its own seconds; the warp is the
// identity) and everything else follows its pushes and pulls. Without
// markers the clip is straight: one tempo, its Seg BPM.
//
// The map lives in project.tempo / project.tempoMarkers like any other tempo
// change, so the engine, the ruler, synced delays, Apollo's clock and the
// video's score-to-picture (B11) all follow through lib/tempo-map.ts with
// nothing new to read. The reducer re-derives it whenever the leader clip
// changes or moves (lib/daw-state.ts: SET_TEMPO_LEADER, UPDATE_CLIP,
// MOVE_CLIP), and SET_TEMPO releases the leader — a tempo the user typed wins
// over a clip. Only ever one leader.

import type { AudioClip, DawClip, DawProject } from './daw-types'
import { clampBpm } from './tempo-map'
import { validMarkers } from './warp'
import { segBpmOf } from './sample-editor'

export interface LeaderMap {
  tempo: number
  tempoMarkers: Array<{ id: string; beat: number; tempo: number }>
  /** How many tempo segments the clip's markers made. */
  segments: number
}

type LeaderProject = Pick<DawProject, 'arrangementClips' | 'tempo' | 'tempoMarkers'>

const round3 = (n: number) => Math.round(n * 1000) / 1000

/** The clip flagged as leader, if any. */
export function leaderOf(project: Pick<DawProject, 'arrangementClips'>): AudioClip | null {
  const c = project.arrangementClips.find(c => c.kind === 'audio' && (c as AudioClip).tempoLeader === true)
  return (c as AudioClip | undefined) ?? null
}

/**
 * The tempo map a clip dictates as leader, or null when its length is not yet
 * known (no markers and no Seg BPM) — nothing to follow until the sample loads.
 * Marker ids are deterministic (`leader-N`) so a replayed history is identical.
 */
export function leaderMap(clip: AudioClip): LeaderMap | null {
  const ms = validMarkers(clip.warpMarkers)
  const segs: Array<{ beat: number; bpm: number }> = []
  if (ms && ms.length >= 2) {
    for (let i = 0; i + 1 < ms.length; i++) {
      const db = ms[i + 1].beat - ms[i].beat, ds = ms[i + 1].sec - ms[i].sec
      if (!(db > 1e-6) || !(ds > 1e-6)) continue
      segs.push({ beat: clip.startBeat + ms[i].beat, bpm: clampBpm((db / ds) * 60) })
    }
  }
  if (!segs.length) {
    const bpm = segBpmOf(clip)
    if (bpm == null || !Number.isFinite(bpm)) return null
    segs.push({ beat: clip.startBeat, bpm: clampBpm(bpm) })
  }
  // Beat 0 carries the first segment's tempo (the ADD_TEMPO_MARKER convention:
  // the opening marker IS the global tempo); every later segment gets a marker
  // where it begins. A segment at the previous tempo needs no marker.
  const markers: LeaderMap['tempoMarkers'] = [{ id: 'leader-0', beat: 0, tempo: round3(segs[0].bpm) }]
  for (let i = 1; i < segs.length; i++) {
    const beat = round3(segs[i].beat), tempo = round3(segs[i].bpm)
    if (Math.abs(markers[markers.length - 1].tempo - tempo) < 1e-9) continue
    if (beat <= 1e-6) { markers[0] = { ...markers[0], tempo }; continue }
    markers.push({ id: `leader-${i}`, beat, tempo })
  }
  return { tempo: markers[0].tempo, tempoMarkers: markers, segments: segs.length }
}

function sameMarkers(a: ReadonlyArray<{ beat: number; tempo: number }>, b: ReadonlyArray<{ beat: number; tempo: number }>): boolean {
  return a.length === b.length && a.every((m, i) => Math.abs(m.beat - b[i].beat) < 1e-9 && Math.abs(m.tempo - b[i].tempo) < 1e-9)
}

/**
 * Re-derive the tempo map from the leader clip. The same object back when
 * there is no leader, its length is unknown, or nothing changed — so a reducer
 * can call this on every clip change without churning the project.
 */
export function followLeader<P extends LeaderProject>(project: P): P {
  const leader = leaderOf(project)
  if (!leader) return project
  const map = leaderMap(leader)
  if (!map) return project
  if (project.tempo === map.tempo && sameMarkers(project.tempoMarkers ?? [], map.tempoMarkers)) return project
  return { ...project, tempo: map.tempo, tempoMarkers: map.tempoMarkers }
}

/** Flag one clip as the leader (null: none); the map follows. */
export function setLeader<P extends LeaderProject>(project: P, clipId: string | null): P {
  let changed = false
  const clips = project.arrangementClips.map(c => {
    if (c.kind !== 'audio') return c
    const on = c.id === clipId
    if (on === ((c as AudioClip).tempoLeader === true)) return c
    changed = true
    return { ...c, tempoLeader: on ? true : undefined } as DawClip
  })
  return followLeader(changed ? { ...project, arrangementClips: clips } : project)
}

/** Clear the flag. The tempo stays where the leader left it. */
export function releaseLeader<P extends Pick<DawProject, 'arrangementClips'>>(project: P): P {
  if (!leaderOf(project)) return project
  return {
    ...project,
    arrangementClips: project.arrangementClips.map(c => c.kind === 'audio' && (c as AudioClip).tempoLeader ? ({ ...c, tempoLeader: undefined } as DawClip) : c),
  }
}

/** The clip fields the leader's map is made of — a patch touching one re-derives it. */
export const LEADER_FIELDS = ['warpMarkers', 'startBeat', 'durationBeats', 'segBpm', 'bufferDuration', 'trimStart', 'trimEnd', 'tempoLeader'] as const
export function touchesLeader(patch: Record<string, unknown>): boolean {
  return LEADER_FIELDS.some(f => f in patch)
}

export function describeLeaderMap(map: LeaderMap): string {
  if (map.tempoMarkers.length <= 1) return `${map.tempo} BPM, straight`
  const tempos = map.tempoMarkers.map(m => m.tempo)
  const lo = Math.min(...tempos), hi = Math.max(...tempos)
  return `${map.tempoMarkers.length} tempos, ${lo}–${hi} BPM`
}
