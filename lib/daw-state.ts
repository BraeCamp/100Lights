'use client'

import { createContext, useContext, useReducer, useRef, useEffect, useCallback, type Dispatch } from 'react'
import type {
  DawProject, DawTrack, DawClip, AudioClip, MidiClip, MidiNote,
  Scene, DawView, EditTarget, TrackType,
} from './daw-types'
import { defaultProject, TRACK_COLORS, DEFAULT_TRACK_HEIGHT, isAudioClip } from './daw-types'
import { DawEngine } from './daw-engine'

// ── Action types ────────────────────────────────────────────────────────

export type DawAction =
  // Tracks
  | { type: 'ADD_TRACK'; trackType: TrackType }
  | { type: 'REMOVE_TRACK'; trackId: string }
  | { type: 'UPDATE_TRACK'; trackId: string; patch: Partial<DawTrack> }
  | { type: 'REORDER_TRACKS'; ids: string[] }
  // Clips (arrangement)
  | { type: 'ADD_CLIP'; clip: DawClip }
  | { type: 'REMOVE_CLIP'; clipId: string }
  | { type: 'UPDATE_CLIP'; clipId: string; patch: Partial<AudioClip> | Partial<MidiClip> }
  | { type: 'MOVE_CLIP'; clipId: string; startBeat: number; trackId?: string }
  // Session grid
  | { type: 'SET_SESSION_SLOT'; trackId: string; sceneIndex: number; clip: DawClip | null }
  // Scenes
  | { type: 'ADD_SCENE' }
  | { type: 'REMOVE_SCENE'; sceneIndex: number }
  | { type: 'UPDATE_SCENE'; sceneIndex: number; patch: Partial<Scene> }
  // Transport / project
  | { type: 'SET_TEMPO'; tempo: number }
  | { type: 'SET_TIME_SIG'; num: number; den: number }
  | { type: 'SET_LOOP'; start: number; end: number }
  | { type: 'SET_LOOP_ENABLED'; enabled: boolean }
  | { type: 'SET_MASTER_VOLUME'; volume: number }
  | { type: 'SET_PROJECT_NAME'; name: string }
  // MIDI notes
  | { type: 'ADD_MIDI_NOTE'; clipId: string; note: MidiNote }
  | { type: 'REMOVE_MIDI_NOTE'; clipId: string; noteId: string }
  | { type: 'UPDATE_MIDI_NOTE'; clipId: string; noteId: string; patch: Partial<MidiNote> }
  // Full replace (load from saved)
  | { type: 'LOAD_PROJECT'; project: DawProject }

// ── Reducer ─────────────────────────────────────────────────────────────

export function reducer(project: DawProject, action: DawAction): DawProject {
  switch (action.type) {

    case 'ADD_TRACK': {
      const colorIdx = project.tracks.length % TRACK_COLORS.length
      const num = project.tracks.filter(t => t.type === action.trackType).length + 1
      const labels: Record<TrackType, string> = { audio: 'Audio', midi: 'MIDI', drum: 'Drum' }
      const track: DawTrack = {
        id: crypto.randomUUID(),
        name: `${labels[action.trackType]} ${num}`,
        type: action.trackType,
        color: TRACK_COLORS[colorIdx],
        volume: 0.8,
        pan: 0,
        mute: false,
        solo: false,
        armed: false,
        height: DEFAULT_TRACK_HEIGHT,
      }
      const grid = { ...project.sessionGrid, [track.id]: Array(project.scenes.length).fill(null) }
      return { ...project, tracks: [...project.tracks, track], sessionGrid: grid }
    }

    case 'REMOVE_TRACK': {
      const tracks = project.tracks.filter(t => t.id !== action.trackId)
      const clips  = project.arrangementClips.filter(c => c.trackId !== action.trackId)
      const grid   = { ...project.sessionGrid }
      delete grid[action.trackId]
      return { ...project, tracks, arrangementClips: clips, sessionGrid: grid }
    }

    case 'UPDATE_TRACK': {
      const tracks = project.tracks.map(t =>
        t.id === action.trackId ? { ...t, ...action.patch } : t
      )
      return { ...project, tracks }
    }

    case 'REORDER_TRACKS': {
      const map = new Map(project.tracks.map(t => [t.id, t]))
      const tracks = action.ids.map(id => map.get(id)!).filter(Boolean)
      return { ...project, tracks }
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
      const clips = project.arrangementClips.map(c =>
        c.id === action.clipId
          ? { ...c, startBeat: action.startBeat, ...(action.trackId ? { trackId: action.trackId } : {}) } as DawClip
          : c
      )
      return { ...project, arrangementClips: clips }
    }

    case 'SET_SESSION_SLOT': {
      const row = [...(project.sessionGrid[action.trackId] ?? Array(project.scenes.length).fill(null))]
      row[action.sceneIndex] = action.clip
      return { ...project, sessionGrid: { ...project.sessionGrid, [action.trackId]: row } }
    }

    case 'ADD_SCENE': {
      const scene: Scene = { id: crypto.randomUUID(), name: `Scene ${project.scenes.length + 1}` }
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

    case 'SET_TEMPO':
      return { ...project, tempo: Math.max(40, Math.min(300, action.tempo)) }

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
        return { ...c, notes: [...c.notes, action.note] } as MidiClip
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
        return { ...c, notes: c.notes.map(n => n.id === action.noteId ? { ...n, ...action.patch } : n) } as MidiClip
      })
      return { ...project, arrangementClips: clips }
    }

    case 'LOAD_PROJECT':
      return action.project

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
  selectedClipId: string | null
  setSelectedClipId: (id: string | null) => void
  // Transport (live)
  playing: boolean
  recording: boolean
  position: number  // beats — updates via RAF
  setPosition: (b: number) => void
  metronome: boolean
  setMetronome: (on: boolean) => void
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
