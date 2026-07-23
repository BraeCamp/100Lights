'use client'

import React, { createContext, useContext, type Dispatch } from 'react'
import type {
  DawProject, DawTrack, DawClip, AudioClip, MidiClip, MidiNote,
  Scene, DawView, EditTarget,
  TrackEffect, AutomationLane, AutomationPoint, ClipEffect,
  ReturnTrack, TakeLane, MidiEffect, CueMarker, CollabPeer,
} from './daw-types'
import type { PodcastMeta } from './project-serializer'
import {
  defaultProject, TRACK_COLORS, DEFAULT_TRACK_HEIGHT, GROUP_TRACK_HEIGHT,
  defaultTrackInstrument,
} from './daw-types'
import { DawEngine } from './daw-engine'
import { legacyToBar } from './effect-bar'

// ── Action types ────────────────────────────────────────────────────────

export type DawAction =
  // Tracks
  | { type: 'ADD_TRACK'; instrument?: DawTrack['instrument']; id?: string; name?: string; kind?: 'group'; groupId?: string }
  | { type: 'REMOVE_TRACK'; trackId: string }
  | { type: 'DUPLICATE_TRACK'; trackId: string; seed?: string }
  | { type: 'UPDATE_TRACK'; trackId: string; patch: Partial<DawTrack> }
  | { type: 'REORDER_TRACKS'; ids: string[] }
  // Move a track (with its children if it's a group) before `beforeId` (null =
  // end) and optionally set its parent group. Keeps group children contiguous.
  | { type: 'MOVE_TRACK'; trackId: string; beforeId: string | null; groupId?: string | null }
  // Wrap the given tracks in a new group (bus). Component supplies the group id.
  | { type: 'GROUP_TRACKS'; trackIds: string[]; groupId: string; name?: string }
  // Clips (arrangement)
  | { type: 'ADD_CLIP'; clip: DawClip }
  | { type: 'REMOVE_CLIP'; clipId: string }
  | { type: 'UPDATE_CLIP'; clipId: string; patch: Partial<AudioClip> | Partial<MidiClip> }
  | { type: 'MOVE_CLIP'; clipId: string; startBeat: number; trackId?: string }
  // Session grid
  | { type: 'SET_SESSION_SLOT'; trackId: string; sceneIndex: number; clip: DawClip | null }
  // Scenes
  | { type: 'ADD_SCENE'; id?: string }
  | { type: 'REMOVE_SCENE'; sceneIndex: number }
  | { type: 'UPDATE_SCENE'; sceneIndex: number; patch: Partial<Scene> }
  // Transport / project
  | { type: 'SET_TEMPO'; tempo: number }
  | { type: 'SET_TIME_SIG'; num: number; den: number }
  | { type: 'ADD_TEMPO_MARKER'; marker: { id: string; beat: number; tempo: number } }
  | { type: 'REMOVE_TEMPO_MARKER'; markerId: string }
  | { type: 'ADD_SECTION'; section: { id: string; beat: number; name: string; color: string } }
  | { type: 'REMOVE_SECTION'; sectionId: string }
  | { type: 'ADD_COMMENT'; comment: import('./daw-types').TimelineComment }
  | { type: 'UPDATE_COMMENT'; commentId: string; patch: Partial<import('./daw-types').TimelineComment> }
  | { type: 'REMOVE_COMMENT'; commentId: string }
  /** Shallow project patch — collab-safe undo/redo reverts exactly the slices it computed. */
  | { type: 'PATCH_PROJECT'; patch: Partial<DawProject> }
  | { type: 'SET_LOOP'; start: number; end: number }
  | { type: 'SET_LOOP_ENABLED'; enabled: boolean }
  | { type: 'SET_MASTER_VOLUME'; volume: number }
  | { type: 'SET_PROJECT_NAME'; name: string }
  // MIDI notes
  | { type: 'ADD_MIDI_NOTE'; clipId: string; note: MidiNote }
  | { type: 'REMOVE_MIDI_NOTE'; clipId: string; noteId: string }
  | { type: 'UPDATE_MIDI_NOTE'; clipId: string; noteId: string; patch: Partial<MidiNote> }
  // Effects chain
  | { type: 'ADD_EFFECT'; trackId: string; effect: TrackEffect }
  | { type: 'REMOVE_EFFECT'; trackId: string; effectId: string }
  | { type: 'UPDATE_EFFECT'; trackId: string; effectId: string; patch: Partial<TrackEffect> }
  | { type: 'REORDER_EFFECTS'; trackId: string; ids: string[] }
  // Instruments
  | { type: 'SET_INSTRUMENT'; trackId: string; instrument: DawTrack['instrument'] }
  // Automation
  | { type: 'ADD_AUTOMATION_LANE'; lane: AutomationLane }
  | { type: 'REMOVE_AUTOMATION_LANE'; laneId: string }
  | { type: 'UPDATE_AUTOMATION_LANE'; laneId: string; patch: Partial<AutomationLane> }
  | { type: 'ADD_AUTOMATION_POINT'; laneId: string; point: AutomationPoint }
  | { type: 'REMOVE_AUTOMATION_POINT'; laneId: string; pointId: string }
  | { type: 'UPDATE_AUTOMATION_POINT'; laneId: string; pointId: string; patch: Partial<AutomationPoint> }
  | { type: 'CLEAR_AUTOMATION_LANE'; laneId: string }
  // Clip effects (region-based FX)
  | { type: 'ADD_CLIP_EFFECT'; effect: ClipEffect }
  | { type: 'REMOVE_CLIP_EFFECT'; effectId: string }
  | { type: 'UPDATE_CLIP_EFFECT'; effectId: string; patch: Partial<ClipEffect> }
  // Return tracks
  | { type: 'ADD_RETURN_TRACK'; track: ReturnTrack }
  | { type: 'REMOVE_RETURN_TRACK'; trackId: string }
  | { type: 'UPDATE_RETURN_TRACK'; trackId: string; patch: Partial<ReturnTrack> }
  | { type: 'ADD_RETURN_EFFECT'; returnId: string; effect: TrackEffect }
  | { type: 'REMOVE_RETURN_EFFECT'; returnId: string; effectId: string }
  | { type: 'UPDATE_RETURN_EFFECT'; returnId: string; effectId: string; patch: Partial<TrackEffect> }
  // Take lanes
  | { type: 'ADD_TAKE_LANE'; lane: TakeLane }
  | { type: 'REMOVE_TAKE_LANE'; laneId: string }
  | { type: 'UPDATE_TAKE_LANE'; laneId: string; patch: Partial<TakeLane> }
  // Crossfader / waveform zoom
  | { type: 'SET_CROSSFADER'; value: number }
  | { type: 'SET_WAVEFORM_ZOOM'; zoom: number }
  // Swing + key/scale
  | { type: 'SET_SWING'; swing: number }
  | { type: 'SET_KEY_SCALE'; key: number; scale: string }
  // Cue markers
  | { type: 'ADD_CUE_MARKER'; marker: CueMarker }
  | { type: 'REMOVE_CUE_MARKER'; markerId: string }
  | { type: 'UPDATE_CUE_MARKER'; markerId: string; patch: Partial<CueMarker> }
  // MIDI effects
  | { type: 'ADD_MIDI_EFFECT'; trackId: string; effect: MidiEffect }
  | { type: 'REMOVE_MIDI_EFFECT'; trackId: string; effectId: string }
  | { type: 'UPDATE_MIDI_EFFECT'; trackId: string; effectId: string; patch: Partial<MidiEffect> }
  // Track freeze
  | { type: 'SET_TRACK_FROZEN'; trackId: string; frozen: boolean }
  // Full replace (load from saved)
  | { type: 'LOAD_PROJECT'; project: DawProject }

// ── Reducer ─────────────────────────────────────────────────────────────

// Deterministic id stream for reducer cases that create many entities
// (DUPLICATE_TRACK): with a seed, every client derives the same ids from the
// same action; without one, falls back to random (solo/legacy callers).
function makeIdGen(seed?: string): () => string {
  if (!seed) return () => crypto.randomUUID()
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (Math.imul(h, 31) + seed.charCodeAt(i)) | 0
  let s = h >>> 0
  const next32 = () => {
    s = (s + 0x6D2B79F5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0).toString(16).padStart(8, '0')
  }
  return () => `d-${next32()}${next32()}${next32()}${next32()}`
}

/**
 * Enforce the group layout invariant on the tracks array:
 *  - group tracks are never themselves grouped (no nesting)
 *  - a child's groupId must point at a real group, else it's dropped (orphan → top level)
 *  - every group's children sit immediately after it, in their current relative order
 * Top-level items (ungrouped tracks + groups) keep their relative order.
 */
function normalizeGroups(tracks: DawTrack[]): DawTrack[] {
  const groupIds = new Set(tracks.filter(t => t.kind === 'group').map(t => t.id))
  const cleaned = tracks.map(t => {
    let groupId = t.groupId
    if (t.kind === 'group') groupId = undefined
    else if (groupId && !groupIds.has(groupId)) groupId = undefined
    return groupId === t.groupId ? t : { ...t, groupId }
  })
  const childrenByGroup = new Map<string, DawTrack[]>()
  for (const t of cleaned) {
    if (t.groupId) {
      const arr = childrenByGroup.get(t.groupId) ?? []
      arr.push(t)
      childrenByGroup.set(t.groupId, arr)
    }
  }
  const out: DawTrack[] = []
  for (const t of cleaned) {
    if (t.groupId) continue          // placed under its group below
    out.push(t)
    if (t.kind === 'group') out.push(...(childrenByGroup.get(t.id) ?? []))
  }
  return out
}

// A MIDI clip grows to fit its notes: adding or moving a note past the clip
// end extends the clip to the next bar boundary. Looped clips are exempt —
// their duration means "number of repeats", not content length.
function growToFitNotes(clip: MidiClip, timeSignatureNum: number): MidiClip {
  if (clip.loopEnabled) return clip
  const bar = timeSignatureNum || 4
  const contentEnd = clip.notes.reduce((m, n) => Math.max(m, n.startBeat + n.durationBeats), 0)
  if (contentEnd <= clip.durationBeats) return clip
  return { ...clip, durationBeats: Math.ceil(contentEnd / bar) * bar }
}

export function reducer(project: DawProject, action: DawAction): DawProject {
  switch (action.type) {

    case 'ADD_TRACK': {
      const colorIdx = project.tracks.length % TRACK_COLORS.length
      const num = project.tracks.length + 1
      const isGroup = action.kind === 'group'
      const track: DawTrack = {
        id: action.id ?? crypto.randomUUID(),
        name: action.name ?? (isGroup ? 'Group' : `Track ${num}`),
        type: 'audio',
        ...(isGroup ? { kind: 'group' as const } : {}),
        color: TRACK_COLORS[colorIdx],
        volume: 0.8,
        pan: 0,
        mute: false,
        solo: false,
        armed: false,
        inputSource: null,
        height: isGroup ? GROUP_TRACK_HEIGHT : DEFAULT_TRACK_HEIGHT,
        effects: [],
        instrument: action.instrument ?? defaultTrackInstrument(),
        ...(action.groupId ? { groupId: action.groupId } : {}),
      }
      const grid = { ...project.sessionGrid, [track.id]: Array(project.scenes.length).fill(null) }
      return { ...project, tracks: normalizeGroups([...project.tracks, track]), sessionGrid: grid }
    }

    case 'GROUP_TRACKS': {
      const ids = new Set(action.trackIds.filter(id => {
        const t = project.tracks.find(x => x.id === id)
        return t && t.kind !== 'group'   // don't nest groups
      }))
      if (ids.size < 1) return project
      const colorIdx = project.tracks.length % TRACK_COLORS.length
      const group: DawTrack = {
        id: action.groupId, name: action.name ?? 'Group', type: 'audio', kind: 'group',
        color: TRACK_COLORS[colorIdx], volume: 0.8, pan: 0, mute: false, solo: false, armed: false,
        inputSource: null, height: GROUP_TRACK_HEIGHT, effects: [], instrument: defaultTrackInstrument(),
      }
      const firstIdx = project.tracks.findIndex(t => ids.has(t.id))
      const tagged = project.tracks.map(t => ids.has(t.id) ? { ...t, groupId: action.groupId } : t)
      const withGroup = [...tagged.slice(0, firstIdx), group, ...tagged.slice(firstIdx)]
      const grid = { ...project.sessionGrid, [group.id]: Array(project.scenes.length).fill(null) }
      return { ...project, tracks: normalizeGroups(withGroup), sessionGrid: grid }
    }

    case 'MOVE_TRACK': {
      const moving = project.tracks.find(t => t.id === action.trackId)
      if (!moving) return project
      let tracks = project.tracks
      // Re-parent (unless it's a group — groups don't nest).
      if (action.groupId !== undefined && moving.kind !== 'group') {
        tracks = tracks.map(t => t.id === action.trackId ? { ...t, groupId: action.groupId ?? undefined } : t)
      }
      // The moving block = the track, plus its children when it's a group.
      const blockIds = new Set<string>([action.trackId])
      if (moving.kind === 'group') for (const t of tracks) if (t.groupId === action.trackId) blockIds.add(t.id)
      const block = tracks.filter(t => blockIds.has(t.id))
      const rest  = tracks.filter(t => !blockIds.has(t.id))
      const idx = action.beforeId ? rest.findIndex(t => t.id === action.beforeId) : rest.length
      const at = idx < 0 ? rest.length : idx
      const next = [...rest.slice(0, at), ...block, ...rest.slice(at)]
      return { ...project, tracks: normalizeGroups(next) }
    }

    case 'REMOVE_TRACK': {
      // Deleting a group ungroups (keeps) its children.
      const tracks = project.tracks
        .filter(t => t.id !== action.trackId)
        .map(t => t.groupId === action.trackId ? { ...t, groupId: undefined } : t)
      const clips  = project.arrangementClips.filter(c => c.trackId !== action.trackId)
      const grid   = { ...project.sessionGrid }
      delete grid[action.trackId]
      const automationLanes = project.automationLanes.filter(l => l.trackId !== action.trackId)
      const clipEffects     = (project.clipEffects ?? []).filter(e => e.trackId !== action.trackId)
      return { ...project, tracks: normalizeGroups(tracks), arrangementClips: clips, sessionGrid: grid, automationLanes, clipEffects }
    }

    case 'UPDATE_TRACK': {
      const tracks = project.tracks.map(t =>
        t.id === action.trackId ? { ...t, ...action.patch } : t
      )
      return { ...project, tracks }
    }

    case 'DUPLICATE_TRACK': {
      const source = project.tracks.find(t => t.id === action.trackId)
      if (!source) return project
      const nextId = makeIdGen(action.seed)
      const newTrackId = nextId()
      const newTrack: DawTrack = {
        ...source,
        id:      newTrackId,
        name:    `${source.name} copy`,
        effects: source.effects.map(e => ({ ...e, id: nextId() })),
      }
      const newClips = project.arrangementClips
        .filter(c => c.trackId === source.id)
        .map(c => ({ ...c, id: nextId(), trackId: newTrackId }))
      const newLanes = project.automationLanes
        .filter(l => l.trackId === source.id)
        .map(l => ({ ...l, id: nextId(), trackId: newTrackId }))
      const srcIdx = project.tracks.findIndex(t => t.id === source.id)
      const tracks = [
        ...project.tracks.slice(0, srcIdx + 1),
        newTrack,
        ...project.tracks.slice(srcIdx + 1),
      ]
      const grid = { ...project.sessionGrid, [newTrackId]: Array(project.scenes.length).fill(null) }
      return {
        ...project, tracks: normalizeGroups(tracks),
        arrangementClips: [...project.arrangementClips, ...newClips],
        automationLanes:  [...project.automationLanes,  ...newLanes],
        sessionGrid: grid,
      }
    }

    case 'REORDER_TRACKS': {
      const map = new Map(project.tracks.map(t => [t.id, t]))
      const tracks = action.ids.map(id => map.get(id)!).filter(Boolean)
      return { ...project, tracks: normalizeGroups(tracks) }
    }

    case 'ADD_CLIP':
      return { ...project, arrangementClips: [...project.arrangementClips, action.clip] }

    case 'REMOVE_CLIP':
      return { ...project, arrangementClips: project.arrangementClips.filter(c => c.id !== action.clipId) }

    case 'UPDATE_CLIP': {
      const clips = project.arrangementClips.map(c =>
        c.id === action.clipId ? ({ ...c, ...action.patch } as DawClip) : c
      )
      return { ...project, arrangementClips: clips }
    }

    case 'MOVE_CLIP': {
      const moved = project.arrangementClips.find(c => c.id === action.clipId)
      const clips = project.arrangementClips.map(c =>
        c.id === action.clipId
          ? { ...c, startBeat: action.startBeat, ...(action.trackId ? { trackId: action.trackId } : {}) } as DawClip
          : c
      )
      // Keep clip effects in sync when moving to a different track
      const clipEffects = (moved && action.trackId && action.trackId !== moved.trackId)
        ? (project.clipEffects ?? []).map(e =>
            e.trackId === moved.trackId && e.startBeat === moved.startBeat
              ? { ...e, trackId: action.trackId! }
              : e
          )
        : (project.clipEffects ?? [])
      return { ...project, arrangementClips: clips, clipEffects }
    }

    case 'SET_SESSION_SLOT': {
      const row = [...(project.sessionGrid[action.trackId] ?? Array(project.scenes.length).fill(null))]
      row[action.sceneIndex] = action.clip
      return { ...project, sessionGrid: { ...project.sessionGrid, [action.trackId]: row } }
    }

    case 'ADD_SCENE': {
      const scene: Scene = { id: action.id ?? crypto.randomUUID(), name: `Scene ${project.scenes.length + 1}` }
      const grid = { ...project.sessionGrid }
      for (const id of Object.keys(grid)) grid[id] = [...(grid[id] ?? []), null]
      return { ...project, scenes: [...project.scenes, scene], sessionGrid: grid }
    }

    case 'REMOVE_SCENE': {
      const scenes = project.scenes.filter((_, i) => i !== action.sceneIndex)
      const grid   = { ...project.sessionGrid }
      for (const id of Object.keys(grid)) {
        grid[id] = (grid[id] ?? []).filter((_, i) => i !== action.sceneIndex)
      }
      return { ...project, scenes, sessionGrid: grid }
    }

    case 'UPDATE_SCENE': {
      const scenes = project.scenes.map((s, i) =>
        i === action.sceneIndex ? { ...s, ...action.patch } : s
      )
      return { ...project, scenes }
    }

    case 'ADD_TEMPO_MARKER': {
      const markers = [...(project.tempoMarkers ?? [])]
      // first marker: pin the current tempo at beat 0 so the song's start keeps its feel
      if (markers.length === 0 && action.marker.beat > 0.01) {
        markers.push({ id: crypto.randomUUID(), beat: 0, tempo: project.tempo })
      }
      const filtered = markers.filter(m => Math.abs(m.beat - action.marker.beat) > 0.01)
      return { ...project, tempoMarkers: [...filtered, action.marker].sort((a, b) => a.beat - b.beat) }
    }

    case 'REMOVE_TEMPO_MARKER':
      return { ...project, tempoMarkers: (project.tempoMarkers ?? []).filter(m => m.id !== action.markerId) }

    case 'ADD_SECTION':
      return { ...project, sections: [...(project.sections ?? []).filter(s => Math.abs(s.beat - action.section.beat) > 0.01), action.section].sort((a, b) => a.beat - b.beat) }

    case 'REMOVE_SECTION':
      return { ...project, sections: (project.sections ?? []).filter(s => s.id !== action.sectionId) }

    case 'ADD_COMMENT':
      return { ...project, comments: [...(project.comments ?? []), action.comment] }

    case 'UPDATE_COMMENT':
      return { ...project, comments: (project.comments ?? []).map(c => c.id === action.commentId ? { ...c, ...action.patch } : c) }

    case 'REMOVE_COMMENT':
      return { ...project, comments: (project.comments ?? []).filter(c => c.id !== action.commentId) }

    case 'PATCH_PROJECT':
      return { ...project, ...action.patch }

    case 'SET_TEMPO': {
      const tempo = Math.max(40, Math.min(300, action.tempo))
      // Non-warped audio keeps its absolute length: its BEAT length rescales
      // with tempo. Without this, lowering the BPM stretches the beat-window
      // past the sample's audio and loop-enabled clips audibly start an extra
      // repeat (and non-looping ones trail silence). Warped clips stretch
      // with tempo by design; MIDI is beat-native — both untouched.
      // seconds = beats × 60/tempo, so keeping seconds fixed means
      // beats scale by NEW/OLD (faster tempo → same audio spans more beats)
      const ratio = tempo / project.tempo
      const arrangementClips = Math.abs(ratio - 1) < 1e-9 ? project.arrangementClips : project.arrangementClips.map(c =>
        c.kind === 'audio' && !c.warpEnabled
          ? { ...c, durationBeats: Math.max(0.125, c.durationBeats * ratio) }
          : c
      )
      return { ...project, tempo, arrangementClips }
    }

    case 'SET_TIME_SIG':
      return { ...project, timeSignatureNum: action.num, timeSignatureDen: action.den }

    case 'SET_LOOP':
      return { ...project, loopStart: action.start, loopEnd: action.end }

    case 'SET_LOOP_ENABLED':
      return { ...project, loopEnabled: action.enabled }

    case 'SET_MASTER_VOLUME':
      return { ...project, masterVolume: Math.max(0, Math.min(1, action.volume)) }

    case 'SET_PROJECT_NAME':
      return { ...project, name: action.name }

    case 'ADD_MIDI_NOTE': {
      const clips = project.arrangementClips.map(c => {
        if (c.id !== action.clipId || c.kind !== 'midi') return c
        return growToFitNotes({ ...c, notes: [...c.notes, action.note] } as MidiClip, project.timeSignatureNum)
      })
      return { ...project, arrangementClips: clips }
    }

    case 'REMOVE_MIDI_NOTE': {
      const clips = project.arrangementClips.map(c => {
        if (c.id !== action.clipId || c.kind !== 'midi') return c
        return { ...c, notes: c.notes.filter(n => n.id !== action.noteId) } as MidiClip
      })
      return { ...project, arrangementClips: clips }
    }

    case 'UPDATE_MIDI_NOTE': {
      const clips = project.arrangementClips.map(c => {
        if (c.id !== action.clipId || c.kind !== 'midi') return c
        return growToFitNotes({ ...c, notes: c.notes.map(n => n.id === action.noteId ? { ...n, ...action.patch } : n) } as MidiClip, project.timeSignatureNum)
      })
      return { ...project, arrangementClips: clips }
    }

    case 'ADD_EFFECT': {
      const tracks = project.tracks.map(t =>
        t.id === action.trackId ? { ...t, effects: [...t.effects, action.effect] } : t
      )
      return { ...project, tracks }
    }

    case 'REMOVE_EFFECT': {
      const tracks = project.tracks.map(t =>
        t.id === action.trackId
          ? { ...t, effects: t.effects.filter(e => e.id !== action.effectId) }
          : t
      )
      return { ...project, tracks }
    }

    case 'UPDATE_EFFECT': {
      const tracks = project.tracks.map(t => {
        if (t.id !== action.trackId) return t
        const effects = t.effects.map(e =>
          e.id === action.effectId ? { ...e, ...action.patch } : e
        )
        return { ...t, effects }
      })
      return { ...project, tracks }
    }

    case 'REORDER_EFFECTS': {
      const tracks = project.tracks.map(t => {
        if (t.id !== action.trackId) return t
        const map = new Map(t.effects.map(e => [e.id, e]))
        const effects = action.ids.map(id => map.get(id)!).filter(Boolean)
        return { ...t, effects }
      })
      return { ...project, tracks }
    }

    case 'SET_INSTRUMENT': {
      const tracks = project.tracks.map(t =>
        t.id === action.trackId ? { ...t, instrument: action.instrument } : t
      )
      return { ...project, tracks }
    }

    case 'ADD_AUTOMATION_LANE': {
      const exists = project.automationLanes.some(l => l.id === action.lane.id)
      if (exists) return project
      return { ...project, automationLanes: [...project.automationLanes, action.lane] }
    }

    case 'REMOVE_AUTOMATION_LANE':
      return { ...project, automationLanes: project.automationLanes.filter(l => l.id !== action.laneId) }

    case 'UPDATE_AUTOMATION_LANE': {
      const automationLanes = project.automationLanes.map(l =>
        l.id === action.laneId ? { ...l, ...action.patch } : l
      )
      return { ...project, automationLanes }
    }

    case 'ADD_AUTOMATION_POINT': {
      const automationLanes = project.automationLanes.map(l => {
        if (l.id !== action.laneId) return l
        return { ...l, points: [...l.points, action.point] }
      })
      return { ...project, automationLanes }
    }

    case 'REMOVE_AUTOMATION_POINT': {
      const automationLanes = project.automationLanes.map(l => {
        if (l.id !== action.laneId) return l
        return { ...l, points: l.points.filter(p => p.id !== action.pointId) }
      })
      return { ...project, automationLanes }
    }

    case 'UPDATE_AUTOMATION_POINT': {
      const automationLanes = project.automationLanes.map(l => {
        if (l.id !== action.laneId) return l
        return { ...l, points: l.points.map(p => p.id === action.pointId ? { ...p, ...action.patch } : p) }
      })
      return { ...project, automationLanes }
    }

    case 'CLEAR_AUTOMATION_LANE': {
      const automationLanes = project.automationLanes.map(l =>
        l.id === action.laneId ? { ...l, points: [] } : l
      )
      return { ...project, automationLanes }
    }

    case 'ADD_CLIP_EFFECT':
      return { ...project, clipEffects: [...(project.clipEffects ?? []), action.effect] }

    case 'REMOVE_CLIP_EFFECT':
      return { ...project, clipEffects: (project.clipEffects ?? []).filter(e => e.id !== action.effectId) }

    case 'UPDATE_CLIP_EFFECT': {
      const clipEffects = (project.clipEffects ?? []).map(e =>
        e.id === action.effectId
          ? { ...e, ...action.patch, params: { ...e.params, ...(action.patch.params ?? {}) } }
          : e
      )
      return { ...project, clipEffects }
    }

    case 'LOAD_PROJECT': {
      const p = action.project
      return {
        ...p,
        tracks:          normalizeGroups(p.tracks ?? []),
        clipEffects:     (p.clipEffects ?? []).map(legacyToBar),
        returnTracks:    p.returnTracks    ?? [],
        takeLanes:       p.takeLanes       ?? [],
        crossfaderValue: p.crossfaderValue ?? 0.5,
        waveformZoom:    p.waveformZoom    ?? 1,
        swing:           p.swing           ?? 0,
        cueMarkers:      p.cueMarkers      ?? [],
        tempoMarkers:    p.tempoMarkers    ?? [],
        sections:        p.sections        ?? [],
        comments:        p.comments        ?? [],
        key:             p.key             ?? 0,
        scale:           p.scale           ?? 'major',
      }
    }

    case 'ADD_RETURN_TRACK':
      return { ...project, returnTracks: [...(project.returnTracks ?? []), action.track] }

    case 'REMOVE_RETURN_TRACK':
      return { ...project, returnTracks: (project.returnTracks ?? []).filter(t => t.id !== action.trackId) }

    case 'UPDATE_RETURN_TRACK': {
      const returnTracks = (project.returnTracks ?? []).map(t =>
        t.id === action.trackId ? { ...t, ...action.patch } : t
      )
      return { ...project, returnTracks }
    }

    case 'ADD_RETURN_EFFECT': {
      return {
        ...project,
        returnTracks: (project.returnTracks ?? []).map(rt =>
          rt.id === action.returnId ? { ...rt, effects: [...rt.effects, action.effect] } : rt
        ),
      }
    }

    case 'REMOVE_RETURN_EFFECT': {
      return {
        ...project,
        returnTracks: (project.returnTracks ?? []).map(rt =>
          rt.id === action.returnId ? { ...rt, effects: rt.effects.filter(e => e.id !== action.effectId) } : rt
        ),
      }
    }

    case 'UPDATE_RETURN_EFFECT': {
      return {
        ...project,
        returnTracks: (project.returnTracks ?? []).map(rt => {
          if (rt.id !== action.returnId) return rt
          return { ...rt, effects: rt.effects.map(e => e.id === action.effectId ? { ...e, ...action.patch } : e) }
        }),
      }
    }

    case 'ADD_TAKE_LANE':
      return { ...project, takeLanes: [...(project.takeLanes ?? []), action.lane] }

    case 'REMOVE_TAKE_LANE':
      return { ...project, takeLanes: (project.takeLanes ?? []).filter(l => l.id !== action.laneId) }

    case 'UPDATE_TAKE_LANE': {
      const takeLanes = (project.takeLanes ?? []).map(l =>
        l.id === action.laneId ? { ...l, ...action.patch } : l
      )
      return { ...project, takeLanes }
    }

    case 'SET_CROSSFADER':
      return { ...project, crossfaderValue: Math.max(0, Math.min(1, action.value)) }

    case 'SET_WAVEFORM_ZOOM':
      return { ...project, waveformZoom: Math.max(1, Math.min(8, action.zoom)) }

    case 'SET_SWING':
      return { ...project, swing: Math.max(0, Math.min(1, action.swing)) }

    case 'SET_KEY_SCALE':
      return { ...project, key: action.key, scale: action.scale }

    case 'ADD_CUE_MARKER':
      return { ...project, cueMarkers: [...(project.cueMarkers ?? []), action.marker].sort((a, b) => a.beat - b.beat) }

    case 'REMOVE_CUE_MARKER':
      return { ...project, cueMarkers: (project.cueMarkers ?? []).filter(m => m.id !== action.markerId) }

    case 'UPDATE_CUE_MARKER':
      return { ...project, cueMarkers: (project.cueMarkers ?? []).map(m => m.id === action.markerId ? { ...m, ...action.patch } : m) }

    case 'ADD_MIDI_EFFECT': {
      const tracks = project.tracks.map(t =>
        t.id === action.trackId ? { ...t, midiEffects: [...(t.midiEffects ?? []), action.effect] } : t
      )
      return { ...project, tracks }
    }

    case 'REMOVE_MIDI_EFFECT': {
      const tracks = project.tracks.map(t =>
        t.id === action.trackId ? { ...t, midiEffects: (t.midiEffects ?? []).filter(e => e.id !== action.effectId) } : t
      )
      return { ...project, tracks }
    }

    case 'UPDATE_MIDI_EFFECT': {
      const tracks = project.tracks.map(t => {
        if (t.id !== action.trackId) return t
        return { ...t, midiEffects: (t.midiEffects ?? []).map(e => e.id === action.effectId ? { ...e, ...action.patch } : e) }
      })
      return { ...project, tracks }
    }

    case 'SET_TRACK_FROZEN': {
      const tracks = project.tracks.map(t =>
        t.id === action.trackId ? { ...t, frozen: action.frozen } : t
      )
      return { ...project, tracks }
    }

    default:
      return project
  }
}

// ── Context ──────────────────────────────────────────────────────────────

export interface DawContextValue {
  project: DawProject
  dispatch: Dispatch<DawAction>
  engine: DawEngine
  // UI state (not in reducer — ephemeral)
  view: DawView
  setView: (v: DawView) => void
  editTarget: EditTarget
  setEditTarget: (t: EditTarget) => void
  selectedTrackId: string | null
  setSelectedTrackId: (id: string | null) => void
  selectedReturnId: string | null
  setSelectedReturnId: (id: string | null) => void
  selectedClipId: string | null
  setSelectedClipId: (id: string | null) => void
  selectedClipIds: Set<string>
  setSelectedClipIds: React.Dispatch<React.SetStateAction<Set<string>>>
  /** Screen position of the shared clip Sound panel, or null when closed. The
   *  panel follows the current clip selection, so it retargets on select. */
  soundPanel: { x: number; y: number } | null
  setSoundPanel: (p: { x: number; y: number } | null) => void
  selectedEffectIds: Set<string>
  setSelectedEffectIds: React.Dispatch<React.SetStateAction<Set<string>>>
  // Pad/voice MIDI card
  showPads: boolean
  setShowPads: (v: boolean | ((prev: boolean) => boolean)) => void
  // Piano roll (inline, under track)
  expandedPianoRollClipId: string | null
  /** Loop tool: armed by the transport's loop button — the next drag across
   *  the ruler or track lanes draws the loop region. */
  loopToolArmed: boolean
  setLoopToolArmed: (v: boolean) => void
  setExpandedPianoRollClipId: (id: string | null) => void
  // Save
  onSave?: () => void | Promise<void>
  isSaving: boolean
  isGuest?: boolean
  requireAccount?: (action: 'save' | 'export') => void
  resumeExport?: boolean
  clearResumeExport?: () => void
  // Podcast / audio mode
  audioMode?: 'music' | 'podcast'
  podcastMeta?: PodcastMeta
  // Transport (live)
  playing: boolean
  recording: boolean
  position: number  // beats — updates via RAF
  setPosition: (b: number) => void
  metronome: boolean
  setMetronome: (on: boolean) => void
  // Blink guidance — purely local UI, never synced to collaborators
  blinkIds: Set<string>
  triggerBlink: (ids: string[]) => void
  // Connected collaborators' live focus (empty when working solo)
  collabPeers: CollabPeer[]
}

export const DawContext = createContext<DawContextValue | null>(null)

export function useDaw(): DawContextValue {
  const ctx = useContext(DawContext)
  if (!ctx) throw new Error('useDaw must be used inside DawProvider')
  return ctx
}

// ── Helper hooks ─────────────────────────────────────────────────────────

export function useTrack(trackId: string): DawTrack | undefined {
  const { project } = useDaw()
  return project.tracks.find(t => t.id === trackId)
}

export function useClip(clipId: string): DawClip | undefined {
  const { project } = useDaw()
  return project.arrangementClips.find(c => c.id === clipId)
}

// ── Beat/bar formatting ───────────────────────────────────────────────────

export function formatBeat(beat: number, num = 4): string {
  const bar       = Math.floor(beat / num) + 1
  const beatInBar = Math.floor(beat % num) + 1
  const sub       = Math.floor((beat % 1) * 4) + 1
  return `${bar}.${beatInBar}.${sub}`
}

// ── Waveform peak extraction ──────────────────────────────────────────────

export function extractPeaks(buffer: AudioBuffer, numSamples = 200): number[] {
  const data = buffer.getChannelData(0)
  const step = Math.max(1, Math.floor(data.length / numSamples))
  const peaks: number[] = []
  for (let i = 0; i < numSamples; i++) {
    let max = 0
    for (let j = 0; j < step; j++) {
      const v = Math.abs(data[i * step + j] ?? 0)
      if (v > max) max = v
    }
    peaks.push(max)
  }
  return peaks
}

// ── Clip factory helpers ──────────────────────────────────────────────────

export function makeAudioClip(
  trackId: string,
  name: string,
  startBeat: number,
  durationBeats: number,
  opts: Partial<AudioClip> = {}
): AudioClip {
  return {
    kind: 'audio',
    id: crypto.randomUUID(),
    trackId,
    name,
    startBeat,
    durationBeats,
    gain: 1,
    loopEnabled: false,
    reverse: false,
    fadeIn: 0,
    fadeOut: 0,
    trimStart: 0,
    trimEnd: 0,
    ...opts,
  }
}

export function makeMidiClip(
  trackId: string,
  name: string,
  startBeat: number,
  durationBeats: number,
  opts: Partial<MidiClip> = {}
): MidiClip {
  return {
    kind: 'midi',
    id: crypto.randomUUID(),
    trackId,
    name,
    startBeat,
    durationBeats,
    notes: [],
    isDrumClip: false,
    ...opts,
  }
}

// Ensure projects loaded from disk have all required fields
export function migrateProject(raw: Partial<DawProject>): DawProject {
  const base = defaultProject()
  const tracks = normalizeGroups((raw.tracks ?? []).map(t => ({
    ...t,
    effects:    t.effects    ?? [],
    instrument: t.instrument ?? defaultTrackInstrument(t.type),
    height:     t.height     ?? DEFAULT_TRACK_HEIGHT,
  })))
  return {
    ...base,
    ...raw,
    tracks,
    clipEffects:     (raw.clipEffects ?? []).map(legacyToBar),
    automationLanes: raw.automationLanes ?? [],
    returnTracks:    raw.returnTracks    ?? [],
    takeLanes:       raw.takeLanes       ?? [],
    crossfaderValue: raw.crossfaderValue ?? 0.5,
    waveformZoom:    raw.waveformZoom    ?? 1,
  }
}
