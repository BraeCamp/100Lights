'use client'

import React, { createContext, useContext, useEffect, useState, type Dispatch } from 'react'
import type {
  DawProject, DawTrack, DawClip, AudioClip, MidiClip, MidiNote,
  Scene, DawView, EditTarget,
  TrackEffect, AutomationLane, AutomationPoint, ClipEffect, Modulator, ModRoute,
  ReturnTrack, TakeLane, MidiEffect, CueMarker, CollabPeer, DawHistoryEntry,
} from './daw-types'
import { repairAutomationPoints } from './automation-repair'
import { fatPatch } from './apollo/patch-diff'
import { restoreNoteIds } from './note-ids'
import type { MidiPreset } from './midi-presets'
import type { PodcastMeta } from './project-serializer'
import {
  defaultProject, TRACK_COLORS, DEFAULT_TRACK_HEIGHT, GROUP_TRACK_HEIGHT,
  defaultTrackInstrument,
} from './daw-types'
import { DawEngine } from './daw-engine'
import { legacyToBar } from './effect-bar'
import { resolveOverlaps } from './note-ops'
import { clipDefaultsFor, clipDefaultsKey } from './clip-defaults'

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
  // Live's Clip Activator (key `0`): park clips without deleting them. One
  // action for the whole selection so it undoes as one step.
  | { type: 'SET_CLIPS_ACTIVE'; clipIds: string[]; active: boolean }
  | { type: 'MOVE_CLIP'; clipId: string; startBeat: number; trackId?: string }
  // Session grid
  | { type: 'SET_SESSION_SLOT'; trackId: string; sceneIndex: number; clip: DawClip | null }
  // Scenes
  | { type: 'SET_LANE_OVERRIDDEN'; laneId: string; overridden: boolean }
  | { type: 'REENABLE_ALL_AUTOMATION' }
  | { type: 'ADD_SCENE'; id?: string }
  | { type: 'REMOVE_SCENE'; sceneIndex: number }
  | { type: 'UPDATE_SCENE'; sceneIndex: number; patch: Partial<Scene> }
  // Transport / project
  | { type: 'SET_TEMPO'; tempo: number }
  | { type: 'SET_TIME_SIG'; num: number; den: number }
  | { type: 'ADD_TEMPO_MARKER'; marker: { id: string; beat: number; tempo: number } }
  | { type: 'UPDATE_TEMPO_MARKER'; markerId: string; tempo: number }
  | { type: 'REMOVE_TEMPO_MARKER'; markerId: string }
  | { type: 'ADD_METER_MARKER'; marker: { id: string; beat: number; num: number; den: number } }
  | { type: 'REMOVE_METER_MARKER'; markerId: string }
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
  | { type: 'UPDATE_MIDI_NOTES'; clipId: string; notes: Array<{ id: string; patch: Partial<MidiNote> }> }
  | { type: 'ADD_MIDI_NOTES'; clipId: string; notes: MidiNote[] }
  /** Split / Chop / Join: some notes out, some in, one undo step (lib/note-ops.ts). */
  | { type: 'SPLICE_MIDI_NOTES'; clipId: string; remove: string[]; add: MidiNote[] }
  /** Live's overlap rule for notes that just landed — after a move or resize ends. */
  | { type: 'RESOLVE_NOTE_OVERLAPS'; clipId: string; noteIds: string[] }
  | { type: 'SET_CHANCE_GROUP'; clipId: string; noteIds: string[]; group: string | null; mode?: 'all' | 'one' }
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
  | { type: 'ADD_MODULATOR'; modulator: Modulator }
  | { type: 'UPDATE_MODULATOR'; modulatorId: string; patch: Partial<Modulator> }
  | { type: 'REMOVE_MODULATOR'; modulatorId: string }
  | { type: 'ADD_MOD_ROUTE'; modulatorId: string; route: ModRoute }
  | { type: 'UPDATE_MOD_ROUTE'; modulatorId: string; routeId: string; patch: Partial<ModRoute> }
  | { type: 'REMOVE_MOD_ROUTE'; modulatorId: string; routeId: string }
  | { type: 'ADD_AUTOMATION_POINT'; laneId: string; point: AutomationPoint }
  | { type: 'REMOVE_AUTOMATION_POINT'; laneId: string; pointId: string }
  | { type: 'UPDATE_AUTOMATION_POINT'; laneId: string; pointId: string; patch: Partial<AutomationPoint> }
  | { type: 'CLEAR_AUTOMATION_LANE'; laneId: string }
  // Clip effects (region-based FX)
  | { type: 'ADD_CLIP_EFFECT'; effect: ClipEffect }
  | { type: 'REMOVE_CLIP_EFFECT'; effectId: string }
  | { type: 'UPDATE_CLIP_EFFECT'; effectId: string; patch: Partial<ClipEffect> }
  // Project-embedded MIDI presets (custom sounds that travel with the file)
  | { type: 'ADD_PRESET'; preset: MidiPreset }
  | { type: 'UPDATE_PRESET'; id: string; patch: Partial<MidiPreset> }
  | { type: 'REMOVE_PRESET'; id: string }
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
  | { type: 'SET_DELAY_COMPENSATION'; on: boolean }
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
  | { type: 'SET_TRACK_HELIOS_FX'; trackId: string; on: boolean }
  | { type: 'SET_TRACK_HELIOS_SYNTH'; trackId: string; on: boolean }
  | { type: 'SET_TRACK_EFFECTS'; trackId: string; effects: TrackEffect[] }
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

// A MIDI clip grows to fit a note the user just added/moved PAST the clip end
// (extends to the next bar boundary). It only ever grows for the note in hand —
// NOT the max of every note — so a clip the user deliberately contracted stays
// contracted when they add a note inside it (notes beyond the end are just a
// hidden tail, not a reason to snap back to full length). Looped clips are
// exempt — their duration means "number of repeats", not content length.
function growToFitNoteEnd(clip: MidiClip, noteEnd: number, timeSignatureNum: number): MidiClip {
  if (clip.loopEnabled) return clip
  if (noteEnd <= clip.durationBeats) return clip
  const bar = timeSignatureNum || 4
  return { ...clip, durationBeats: Math.ceil(noteEnd / bar) * bar }
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
      // Take lanes belong to the track too; left behind they accumulate in the
      // saved project with no track to show them under.
      const takeLanes       = (project.takeLanes ?? []).filter(l => l.trackId !== action.trackId)
      return { ...project, tracks: normalizeGroups(tracks), arrangementClips: clips, sessionGrid: grid, automationLanes, clipEffects, takeLanes }
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
        // MIDI effects get ids of their own too — copies sharing ids with the
        // source made UPDATE_MIDI_EFFECT ambiguous between the two tracks.
        ...(source.midiEffects ? { midiEffects: source.midiEffects.map(m => ({ ...m, id: nextId() })) } : {}),
      }
      const newClips = project.arrangementClips
        .filter(c => c.trackId === source.id)
        .map(c => ({ ...c, id: nextId(), trackId: newTrackId }))
      const newLanes = project.automationLanes
        .filter(l => l.trackId === source.id)
        .map(l => ({ ...l, id: nextId(), trackId: newTrackId }))
      // The effect bars drawn on the track's lane come along as well — a
      // duplicate that lost them was not a duplicate.
      const newBars = (project.clipEffects ?? [])
        .filter(e => e.trackId === source.id)
        .map(e => ({ ...e, id: nextId(), trackId: newTrackId }))
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
        clipEffects:      [...(project.clipEffects ?? []), ...newBars],
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

    case 'SET_CLIPS_ACTIVE': {
      const ids = new Set(action.clipIds)
      if (!ids.size) return project
      const clips = project.arrangementClips.map(c =>
        ids.has(c.id) ? ({ ...c, active: action.active ? undefined : false } as DawClip) : c
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

    case 'SET_LANE_OVERRIDDEN': {
      const automationLanes = project.automationLanes.map(l =>
        l.id === action.laneId ? { ...l, overridden: action.overridden } : l)
      return { ...project, automationLanes }
    }
    case 'REENABLE_ALL_AUTOMATION': {
      if (!project.automationLanes.some(l => l.overridden)) return project
      return { ...project, automationLanes: project.automationLanes.map(l => l.overridden ? { ...l, overridden: false } : l) }
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
      // A marker AT beat 0 is the opening tempo; the global number must agree
      // with it or the transport shows one bpm and the song plays another.
      const tempo = action.marker.beat <= 0.01 ? Math.max(40, Math.min(300, action.marker.tempo)) : project.tempo
      return { ...project, tempo, tempoMarkers: [...filtered, action.marker].sort((a, b) => a.beat - b.beat) }
    }

    case 'UPDATE_TEMPO_MARKER': {
      const markers = project.tempoMarkers ?? []
      const marker = markers.find(m => m.id === action.markerId)
      if (!marker) return project
      const tempo = Math.max(40, Math.min(300, action.tempo))
      const tempoMarkers = markers.map(m => m.id === action.markerId ? { ...m, tempo } : m)
      // Preserve non-warped audio clips' absolute (second) length within THIS
      // marker's segment [marker.beat, next marker) — the same rescale SET_TEMPO
      // does globally for a marker-free project. Without it, retempoing a segment
      // (e.g. editing the opening BPM when tempo markers exist) stretches its audio
      // clips' beat-window past the sample: loop-enabled clips add an extra repeat,
      // non-looping ones trail silence. Warped clips + MIDI are untouched.
      // The opening marker IS the global tempo; keep the number in step here, in
      // the reducer, so every caller agrees — not just the transport box.
      const globalTempo = marker.beat <= 0.01 ? tempo : project.tempo
      const ratio = tempo / marker.tempo
      if (Math.abs(ratio - 1) < 1e-9) return { ...project, tempo: globalTempo, tempoMarkers }
      const nextBeat = markers.reduce((n, m) => (m.beat > marker.beat + 1e-6 && m.beat < n ? m.beat : n), Infinity)
      const arrangementClips = project.arrangementClips.map(c =>
        c.kind === 'audio' && !c.warpEnabled && c.startBeat >= marker.beat - 1e-6 && c.startBeat < nextBeat - 1e-6
          ? { ...c, durationBeats: Math.max(0.125, c.durationBeats * ratio) }
          : c)
      return { ...project, tempo: globalTempo, tempoMarkers, arrangementClips }
    }

    case 'REMOVE_TEMPO_MARKER':
      return { ...project, tempoMarkers: (project.tempoMarkers ?? []).filter(m => m.id !== action.markerId) }

    case 'ADD_METER_MARKER': {
      const markers = [...(project.meterMarkers ?? [])]
      // first marker at beat>0: pin the current global meter at beat 0 so the
      // song's opening keeps its time signature (mirrors ADD_TEMPO_MARKER).
      if (markers.length === 0 && action.marker.beat > 0.01) {
        markers.push({ id: crypto.randomUUID(), beat: 0, num: project.timeSignatureNum, den: project.timeSignatureDen })
      }
      const num = Math.max(1, Math.round(action.marker.num) || 4)
      const den = Math.max(1, Math.round(action.marker.den) || 4)
      const filtered = markers.filter(m => Math.abs(m.beat - action.marker.beat) > 0.01)
      const meterMarkers = [...filtered, { ...action.marker, num, den }].sort((a, b) => a.beat - b.beat)
      // Keep the global time sig equal to the meter at beat 0, so consumers that
      // still read the scalar (metronome downbeat, launch quant) see the opening meter.
      const head = meterMarkers.find(m => m.beat < 0.01)
      return { ...project, meterMarkers,
        timeSignatureNum: head?.num ?? project.timeSignatureNum,
        timeSignatureDen: head?.den ?? project.timeSignatureDen }
    }

    case 'REMOVE_METER_MARKER':
      return { ...project, meterMarkers: (project.meterMarkers ?? []).filter(m => m.id !== action.markerId) }

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
      // ⚠️ WITH TEMPO MARKERS, THE GLOBAL NUMBER DRIVES NOTHING ON ITS OWN. The
      // first marker pins beat 0, and from then on the tempo map plays the
      // markers — so a SET_TEMPO that only changed `tempo` changed the transport
      // read-out (and the engine's curve lengths, synced delays and Apollo's
      // clock, which read the scalar) while every note kept its old grid.
      // Brae: "It changes in the UI, but the sound is off by a bit which just
      // ends up making it look normal but sound like a mess." The global tempo
      // IS the opening section's tempo: retempo that marker with it.
      const markers = project.tempoMarkers ?? []
      const opening = markers.find(m => m.beat <= 0.01)
      const prevTempo = opening ? opening.tempo : project.tempo
      const tempoMarkers = opening ? markers.map(m => m === opening ? { ...m, tempo } : m) : project.tempoMarkers
      // Non-warped audio keeps its absolute length: its BEAT length rescales
      // with tempo. Without this, lowering the BPM stretches the beat-window
      // past the sample's audio and loop-enabled clips audibly start an extra
      // repeat (and non-looping ones trail silence). Warped clips stretch
      // with tempo by design; MIDI is beat-native — both untouched.
      // seconds = beats × 60/tempo, so keeping seconds fixed means
      // beats scale by NEW/OLD (faster tempo → same audio spans more beats).
      // Only clips in the section that changed — everything before the next
      // marker; with no markers that is the whole song, as before.
      const nextBeat = markers.reduce((n, m) => (m.beat > 0.01 && m.beat < n ? m.beat : n), Infinity)
      const ratio = tempo / prevTempo
      const arrangementClips = Math.abs(ratio - 1) < 1e-9 ? project.arrangementClips : project.arrangementClips.map(c =>
        c.kind === 'audio' && !c.warpEnabled && c.startBeat < nextBeat - 1e-6
          ? { ...c, durationBeats: Math.max(0.125, c.durationBeats * ratio) }
          : c
      )
      return { ...project, tempo, tempoMarkers, arrangementClips }
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
        const noteEnd = action.note.startBeat + action.note.durationBeats
        return growToFitNoteEnd({ ...c, notes: [...c.notes, action.note] } as MidiClip, noteEnd, project.timeSignatureNum)
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

    // Many notes, one undo step — the lanes' Randomize and Ramp, a voice
    // "make the hats 50% chance", ⌘↑ on a selection.
    case 'UPDATE_MIDI_NOTES': {
      const byId = new Map(action.notes.map(n => [n.id, n.patch]))
      const clips = project.arrangementClips.map(c => {
        if (c.id !== action.clipId || c.kind !== 'midi') return c
        const notes = c.notes.map(n => (byId.has(n.id) ? { ...n, ...byId.get(n.id) } : n))
        // Stretch ×2 can push the phrase past the clip's end; grow to fit, the
        // way a single note's move does, so nothing is silently cut off.
        const end = Math.max(0, ...notes.filter(n => byId.has(n.id)).map(n => n.startBeat + n.durationBeats))
        return growToFitNoteEnd({ ...c, notes } as MidiClip, end, project.timeSignatureNum)
      })
      return { ...project, arrangementClips: clips }
    }
    // Many notes added as one undo step — Add Interval's copies, a voice
    // "harmonize the lead a third above".
    case 'ADD_MIDI_NOTES': {
      if (!action.notes.length) return project
      const clips = project.arrangementClips.map(c => {
        if (c.id !== action.clipId || c.kind !== 'midi') return c
        const end = Math.max(...action.notes.map(n => n.startBeat + n.durationBeats))
        return growToFitNoteEnd({ ...c, notes: [...c.notes, ...action.notes] } as MidiClip, end, project.timeSignatureNum)
      })
      return { ...project, arrangementClips: clips }
    }
    case 'SPLICE_MIDI_NOTES': {
      if (!action.remove.length && !action.add.length) return project
      const gone = new Set(action.remove)
      const clips = project.arrangementClips.map(c => {
        if (c.id !== action.clipId || c.kind !== 'midi') return c
        const notes = [...c.notes.filter(n => !gone.has(n.id)), ...action.add]
        const end = Math.max(0, ...action.add.map(n => n.startBeat + n.durationBeats))
        return growToFitNoteEnd({ ...c, notes } as MidiClip, end, project.timeSignatureNum)
      })
      return { ...project, arrangementClips: clips }
    }
    // Live's overlap rule (lib/note-ops.ts): a note that lands on the start
    // of another on the same key replaces it; one that lands inside another
    // shortens it. Run when a gesture ENDS — not per move, or a group drag
    // would eat its own notes on the way.
    case 'RESOLVE_NOTE_OVERLAPS': {
      const clips = project.arrangementClips.map(c => {
        if (c.id !== action.clipId || c.kind !== 'midi') return c
        const { remove, patches } = resolveOverlaps(c.notes, new Set(action.noteIds))
        if (!remove.length && !patches.length) return c
        const gone = new Set(remove)
        const byId = new Map(patches.map(p => [p.id, p.patch]))
        return { ...c, notes: c.notes.filter(n => !gone.has(n.id)).map(n => (byId.has(n.id) ? { ...n, ...byId.get(n.id) } : n)) }
      })
      return { ...project, arrangementClips: clips }
    }
    case 'SET_CHANCE_GROUP': {
      const ids = new Set(action.noteIds)
      const clips = project.arrangementClips.map(c => {
        if (c.id !== action.clipId || c.kind !== 'midi') return c
        const notes = c.notes.map(n => (ids.has(n.id) ? { ...n, chanceGroup: action.group ?? undefined } : n))
        const groups = { ...(c.chanceGroups ?? {}) }
        if (action.group) groups[action.group] = action.mode ?? groups[action.group] ?? 'one'
        // Drop groups nobody is in any more.
        for (const g of Object.keys(groups)) if (!notes.some(n => n.chanceGroup === g)) delete groups[g]
        return { ...c, notes, chanceGroups: Object.keys(groups).length ? groups : undefined }
      })
      return { ...project, arrangementClips: clips }
    }
    case 'UPDATE_MIDI_NOTE': {
      const clips = project.arrangementClips.map(c => {
        if (c.id !== action.clipId || c.kind !== 'midi') return c
        const notes = c.notes.map(n => n.id === action.noteId ? { ...n, ...action.patch } : n)
        const moved = notes.find(n => n.id === action.noteId)
        const noteEnd = moved ? moved.startBeat + moved.durationBeats : 0
        return growToFitNoteEnd({ ...c, notes } as MidiClip, noteEnd, project.timeSignatureNum)
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
      const was = project.tracks.find(t => t.id === action.trackId)
        ?.effects.find(e => e.id === action.effectId)
      const tracks = project.tracks.map(t => {
        if (t.id !== action.trackId) return t
        const effects = t.effects.map(e =>
          e.id === action.effectId ? { ...e, ...action.patch } : e
        )
        return { ...t, effects }
      })

      // ── Touching a control overrides its lane ────────────────────────────
      //
      // Brae: "When I set reverb on pad to 80% it shows in the device chain
      // menu but not on the graph."
      //
      // ⚠️ AND THE GRAPH WAS STILL DRIVING THE SOUND. The Ableton semantics are
      // written down on AutomationLane, honoured by the engine (an overridden
      // lane keeps its curve and stops driving the parameter) and drawn by the
      // lane view in grey — but NOTHING SET THE FLAG except the volume fader on
      // the track head. Pan never did, and no effect parameter ever did.
      //
      // So a reverb with a wet lane ignored the number you set: the device
      // chain said 80%, the curve went on playing, and what you heard was the
      // curve. That is the same failure as a bypassed effect reporting its
      // stored amount — a value shown that reaches no audio.
      //
      // Done in the reducer rather than at the control, because there are four
      // ways to change an effect parameter (the chain, the popped-out card, the
      // voice assistant, the learned cache) and only one of them was ever going
      // to remember. This is the one place all four pass through.
      const params = (action.patch as { params?: Record<string, unknown> }).params
      const before = was?.params as Record<string, unknown> | undefined
      if (!params || !project.automationLanes?.length) return { ...project, tracks }

      const prefix = `fx:${action.effectId}:`
      const automationLanes = project.automationLanes.map(l => {
        if (l.overridden || !l.points.length) return l
        if (l.trackId !== action.trackId || !l.parameter.startsWith(prefix)) return l
        const key = l.parameter.slice(prefix.length)
        // Only a parameter that actually MOVED. Re-saving an effect unchanged,
        // or changing its decay, must not switch off the lane driving its wet.
        return before && Object.is(before[key], params[key]) ? l : { ...l, overridden: true }
      })
      return { ...project, tracks, automationLanes }
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

    // ── Modulators ──────────────────────────────────────────────────────────
    case 'ADD_MODULATOR': {
      const mods = project.modulators ?? []
      if (mods.some(m => m.id === action.modulator.id)) return project
      return { ...project, modulators: [...mods, action.modulator] }
    }
    case 'UPDATE_MODULATOR':
      return { ...project, modulators: (project.modulators ?? []).map(m => m.id === action.modulatorId ? { ...m, ...action.patch } : m) }
    case 'REMOVE_MODULATOR':
      return { ...project, modulators: (project.modulators ?? []).filter(m => m.id !== action.modulatorId) }
    case 'ADD_MOD_ROUTE':
      return { ...project, modulators: (project.modulators ?? []).map(m => {
        if (m.id !== action.modulatorId || m.routes.some(r => r.id === action.route.id)) return m
        return { ...m, routes: [...m.routes, action.route] }
      }) }
    case 'UPDATE_MOD_ROUTE':
      return { ...project, modulators: (project.modulators ?? []).map(m => m.id !== action.modulatorId ? m
        : { ...m, routes: m.routes.map(r => r.id === action.routeId ? { ...r, ...action.patch } : r) }) }
    case 'REMOVE_MOD_ROUTE':
      return { ...project, modulators: (project.modulators ?? []).map(m => m.id !== action.modulatorId ? m
        : { ...m, routes: m.routes.filter(r => r.id !== action.routeId) }) }

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

    case 'ADD_PRESET': {
      // Replace an existing entry with the same id (idempotent), else append.
      const rest = (project.presets ?? []).filter(p => p.id !== action.preset.id)
      return { ...project, presets: [...rest, action.preset] }
    }
    case 'UPDATE_PRESET':
      return { ...project, presets: (project.presets ?? []).map(p => p.id === action.id ? { ...p, ...action.patch } : p) }
    case 'REMOVE_PRESET':
      return { ...project, presets: (project.presets ?? []).filter(p => p.id !== action.id) }

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
      // Note ids come back HERE and not only in migrateProject, because this is
      // the one gate every project must pass to become state. migrateProject is
      // supposed to be that gate and its own comment claims it is, but a project
      // handed in as initialDawProject skipped it for a long time — which is
      // exactly how slim Apollo patches once reached the editor unexpanded.
      // Restoring here is a no-op scan when the ids are already present.
      const p = restoreNoteIds(action.project)
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

    case 'SET_DELAY_COMPENSATION':
      return { ...project, delayCompensation: action.on ? undefined : false }

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

    case 'SET_TRACK_HELIOS_FX': {
      const tracks = project.tracks.map(t =>
        t.id === action.trackId ? { ...t, heliosFx: action.on } : t
      )
      return { ...project, tracks }
    }

    case 'SET_TRACK_HELIOS_SYNTH': {
      const tracks = project.tracks.map(t =>
        t.id === action.trackId ? { ...t, heliosSynth: action.on } : t
      )
      return { ...project, tracks }
    }

    case 'SET_TRACK_EFFECTS': {
      const tracks = project.tracks.map(t =>
        t.id === action.trackId ? { ...t, effects: action.effects } : t
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
  /** This session's live construction log (for the History capture/replay mode),
   *  so replay works without saving + reopening. Falls back to project.history. */
  getBuildHistory?: () => DawHistoryEntry[]
  /** Collapse repeated same-control tweaks in the build log to their net value
   *  (the History panel's "Consolidate" button). Returns the new step count. */
  consolidateBuildHistory?: () => number
  // History. Both editors provide these now; they return whether there was
  // anything to undo, so a caller can report honestly instead of assuming.
  // A number is how many entries came off — a grouped request undoes as one.
  undo?: () => number | boolean | void
  redo?: () => number | boolean | void
  canUndo?: boolean
  canRedo?: boolean
  /**
   * Group everything dispatched from now until endUndoGroup (or the next
   * beginUndoGroup) into ONE undo step. Brae: "If I ask it to do 4 things in
   * one request, an undo request after that should undo the whole thing."
   * Returns the group id. Voice commands and macros use it; a drag could.
   */
  beginUndoGroup?: (label?: string) => string
  endUndoGroup?: () => void
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
  /** The open Apollo Rack window. It lives at the editor level, NOT inside the
   *  Devices panel that opens it — closing that panel must not tear the window
   *  down, since the whole point is to keep working in Beacon while it is up. */
  /** `seed: null` means "build it from the track on open". `follow` retargets
   *  the window as the track selection changes, which is what makes it usable
   *  as a left-open panel rather than a per-track dialog. */
  apolloRack: { trackId: string; seed: unknown; follow?: boolean; detached?: boolean } | null
  setApolloRack: (v: { trackId: string; seed: unknown; follow?: boolean; detached?: boolean } | null) => void
  selectedEffectIds: Set<string>
  setSelectedEffectIds: React.Dispatch<React.SetStateAction<Set<string>>>
  /** The studio's own colours and patterns. Local to the editor until Light
   *  needed to open it — "let's edit the UI colours" is a navigation request
   *  like any other, and it had no route because nothing outside AudioEditor
   *  could see this. */
  showAppearance?: boolean
  setShowAppearance?: (v: boolean) => void
  /**
   * An overlay on the arrangement: one question about the song, answered in
   * grey. Brae: "One overlay will be 'Loading' where the user can see
   * unloaded parts of the song in gray." Clips that are not the answer are
   * drawn grey; everything else is untouched.
   */
  overlay?: OverlayKind
  setOverlay?: (v: OverlayKind) => void
  // Pad/voice MIDI card
  showPads: boolean
  setShowPads: (v: boolean | ((prev: boolean) => boolean)) => void
  // Piano roll (inline, under track)
  expandedPianoRollClipId: string | null
  // Step sequencer (inline, under track — sibling to the piano roll)
  expandedStepSeqClipId: string | null
  setExpandedStepSeqClipId: (id: string | null) => void
  /** Loop tool: armed by the transport's loop button — the next drag across
   *  the ruler or track lanes draws the loop region. */
  loopToolArmed: boolean
  setLoopToolArmed: (v: boolean) => void
  setExpandedPianoRollClipId: (id: string | null) => void
  // Save
  onSave?: () => void | Promise<void>
  /** Save the project to the user's own computer (.cfproj) — the free-tier
   *  alternative to cloud save (no project limit), available to everyone. */
  onSaveLocal?: () => void | Promise<void>
  isSaving: boolean
  dawDirty?: boolean   // unsaved-changes indicator for the header switcher
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
  // NB: the playhead is NOT here. It moves ten times a second, and anything in
  // this object rebuilds it, invalidating every useDaw() consumer in the editor
  // — every track row, clip and note. Read it from useDawPlayhead() instead,
  // which only re-renders whoever actually asked for it.
  setPosition: (b: number) => void
  metronome: boolean
  setMetronome: (on: boolean) => void
  // Blink guidance — purely local UI, never synced to collaborators
  blinkIds: Set<string>
  triggerBlink: (ids: string[]) => void
  // Connected collaborators' live focus (empty when working solo)
  collabPeers: CollabPeer[]
  /** Surface a "someone else is editing this clip" notice (collab locks). */
  notifyLocked?: (byName: string) => void
  /** Offline-sync 3-way merge conflicts awaiting the user's Yours/Theirs pick,
   *  and the resolver that applies their choices. */
  mergeConflicts?: import('./project-merge').MergeConflict[] | null
  resolveMerge?: (choices: Record<string, 'mine' | 'theirs'>) => void
}

export const DawContext = createContext<DawContextValue | null>(null)

/**
 * The transport position, on its own channel.
 *
 * Kept out of DawContextValue deliberately. It updates ~10x a second while
 * playing, and when it lived in the main context every flush built a new
 * context object and re-rendered the entire editor tree — a CPU profile put a
 * quarter of the main thread in React rendering during playback, against 0.6%
 * for actual audio work. Exactly one component needs the number.
 */
export const DawPlayheadContext = createContext<number>(0)

/**
 * Owns the playhead state so the editor does not.
 *
 * The position used to be useState inside AudioEditor. Moving it into a child
 * context did nothing, because the flush still re-rendered AudioEditor — and
 * therefore every component under it. A profile during playback put 22% of the
 * main thread in React, led by SoundLibrary at 6.3%, which has nothing to do
 * with playback at all.
 *
 * Children arrive as a prop, so they are the same elements across this
 * component's re-renders and React skips them. Only actual useDawPlayhead()
 * consumers re-render as the playhead moves.
 */
export function DawPlayheadProvider(
  { engine, playing, seekNonce, children }:
  { engine: { currentBeat: number } | null; playing: boolean; seekNonce: number; children: React.ReactNode },
) {
  const [position, setPosition] = useState(0)
  useEffect(() => {
    if (!engine) return
    if (!playing) {
      // Stopped: one flush so the parked playhead is right, then no loop.
      setPosition(engine.currentBeat)
      return
    }
    let raf = 0
    let lastFlush = 0
    const frame = (now: number) => {
      // Flushed at ~10Hz, not per frame: the playhead only has to look smooth,
      // and every flush is a render for whoever reads it.
      if (now - lastFlush > 100) { setPosition(engine.currentBeat); lastFlush = now }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [engine, playing, seekNonce])
  return React.createElement(DawPlayheadContext.Provider, { value: position }, children)
}

/** Transport position in beats. Re-renders only the caller. */
export function useDawPlayhead(): number {
  return useContext(DawPlayheadContext)
}

/**
 * The overlays the arrangement can show. Each one asks a single question of
 * every clip; the clips that answer "no" are drawn grey.
 */
export type OverlayKind =
  | 'none'
  | 'loading' | 'sync'
  | 'sections' | 'tempo' | 'key'
  | 'automation' | 'effects' | 'frozen' | 'loudness'
  | 'collab' | 'unused'
export type OverlayGroup = 'Ready' | 'Structure' | 'Sound' | 'People'
/**
 * Every overlay names ONE thing, and that thing is what goes grey. Brae:
 * "'Loading' where the user can see unloaded parts of the song in gray." So
 * the label is what the grey means: Not loaded, Not synced, Out of key, No
 * effects… Everything else keeps its colour. Grouped by the kind of question.
 */
export const OVERLAYS: { kind: OverlayKind; group: OverlayGroup | null; label: string; what: string }[] = [
  { kind: 'none',       group: null,        label: 'Off',           what: 'No overlay.' },
  // Is it here yet?
  { kind: 'loading',    group: 'Ready',     label: 'Not loaded',    what: 'Grey = clips whose sound has not arrived yet.' },
  { kind: 'sync',       group: 'Ready',     label: 'Not synced',    what: 'Grey = audio that is not yet in the cloud.' },
  // Where in the song?
  { kind: 'sections',   group: 'Structure', label: 'Other sections', what: 'Grey = everything outside the section the playhead is in.' },
  { kind: 'tempo',      group: 'Structure', label: 'Tempo changes', what: 'Grey = clips in a section at a different tempo from the opening.' },
  { kind: 'key',        group: 'Structure', label: 'Out of key',    what: 'Grey = MIDI clips with notes outside the song\'s key.' },
  // What is happening to the sound?
  { kind: 'automation', group: 'Sound',     label: 'No automation', what: 'Grey = tracks with no automation lanes.' },
  { kind: 'effects',    group: 'Sound',     label: 'No effects',    what: 'Grey = tracks with no effects.' },
  { kind: 'frozen',     group: 'Sound',     label: 'Not frozen',    what: 'Grey = tracks still being synthesised live.' },
  { kind: 'loudness',   group: 'Sound',     label: 'Quiet',         what: 'Grey = clips that peak well below the loudest one.' },
  // Who and whether
  { kind: 'collab',     group: 'People',    label: 'Not being edited', what: 'Grey = clips nobody else is holding; a collaborator\'s clips keep their colour.' },
  { kind: 'unused',     group: 'People',    label: 'Silent',        what: 'Grey = clips that will never sound — on a muted track, or with no notes.' },
]

export function useDaw(): DawContextValue {
  const ctx = useContext(DawContext)
  if (!ctx) throw new Error('useDaw must be used inside DawProvider')
  return ctx
}

/**
 * The studio if there is one, and null if there is not.
 *
 * ⚠️ For things that live OUTSIDE the editor but still want it when it is
 * there. The voice control is the reason this exists: it used to be rendered
 * inside the transport bar, so it only existed while a project was open, and
 * navigating anywhere at all destroyed it mid-conversation — the history, a
 * pending question, whatever had been selected.
 *
 * Throwing is right for a component that cannot work without the studio.
 * Returning null is right for one that can do LESS without it, and this is the
 * hook for the second kind.
 */
export function useOptionalDaw(): DawContextValue | null {
  return useContext(DawContext)
}

// ── Helper hooks ─────────────────────────────────────────────────────────

/** Reactive "is the engine producing audio" flag, for gating meter/analyser
 *  RAF loops so they idle when the transport is stopped. Tracks the arrangement
 *  transport (the 'transport' event) AND session/pad launches (the
 *  'session-state' event), so meters stay live in every playback mode but stop
 *  churning when nothing is sounding. */
export function useEnginePlaying(): boolean {
  const { engine } = useDaw()
  const [playing, setPlaying] = useState<boolean>(() => engine.isPlaying)
  useEffect(() => {
    const active = new Set<string>()
    const sync = () => setPlaying(engine.isPlaying || active.size > 0)
    const onTransport = () => sync()
    const onSession = (e: Event) => {
      const d = (e as CustomEvent<{ clipId?: string; state?: string }>).detail
      if (!d?.clipId) return
      if (d.state === 'playing') active.add(d.clipId)
      else if (d.state === 'idle') active.delete(d.clipId)
      sync()
    }
    engine.addEventListener('transport', onTransport)
    engine.addEventListener('session-state', onSession)
    sync()
    return () => {
      engine.removeEventListener('transport', onTransport)
      engine.removeEventListener('session-state', onSession)
    }
  }, [engine])
  return playing
}

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
    // Save Default Clip (lib/clip-defaults.ts): the sample's remembered
    // settings sit under whatever the caller says explicitly.
    ...(clipDefaultsFor(clipDefaultsKey(opts)) ?? {}),
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
  const tracks = normalizeGroups((raw.tracks ?? []).map(t => {
    const instrument = t.instrument ?? defaultTrackInstrument(t.type)
    return {
      ...t,
      effects:    t.effects ?? [],
      // Apollo patches are stored as what differs from Init (see
      // lib/apollo/patch-diff) — about a tenth the size. Expand once here, on
      // the single path every project load goes through, so nothing downstream
      // has to know. A patch that is already complete passes through unchanged,
      // so projects saved before this still load.
      instrument: instrument.type === 'apollo'
        ? { ...instrument, params: fatPatch(instrument.params) as unknown as typeof instrument.params }
        : instrument,
      height:     t.height ?? DEFAULT_TRACK_HEIGHT,
    }
  }))
  // Note ids are stripped for storage (see lib/note-ids — they are 25% of a
  // project and don't compress). Put them back before anything downstream tries
  // to address a note.
  const withIds = restoreNoteIds({ ...base, ...raw, tracks } as DawProject)
  return {
    ...base,
    ...raw,
    tracks,
    arrangementClips: withIds.arrangementClips,
    sessionGrid:      withIds.sessionGrid,
    clipEffects:     (raw.clipEffects ?? []).map(legacyToBar),
    automationLanes: repairAutomationPoints(raw.automationLanes ?? []),
    returnTracks:    raw.returnTracks    ?? [],
    takeLanes:       raw.takeLanes       ?? [],
    crossfaderValue: raw.crossfaderValue ?? 0.5,
    waveformZoom:    raw.waveformZoom    ?? 1,
  }
}
