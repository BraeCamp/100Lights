// Core DAW types shared across engine and UI

export type TrackType = 'audio' | 'midi' | 'drum'

export interface DawTrack {
  id: string
  name: string
  type: TrackType
  color: string
  volume: number      // 0–1
  pan: number         // -1 to 1
  mute: boolean
  solo: boolean
  armed: boolean
  height: number      // arrangement lane height in px
}

export interface AudioClip {
  kind: 'audio'
  id: string
  trackId: string
  name: string
  // Arrangement position (beats)
  startBeat: number
  durationBeats: number
  // Audio source
  r2Key?: string
  audioUrl?: string       // blob URL or signed URL, resolved at runtime
  waveformPeaks?: number[] // normalized 0–1 amplitude samples for display
  // Playback properties
  gain: number            // 0–2 (1 = unity)
  loopEnabled: boolean
  reverse: boolean
  fadeIn: number          // beats
  fadeOut: number         // beats
  trimStart: number       // seconds offset from audio start
  trimEnd: number         // seconds from audio end (0 = use full audio)
}

export interface MidiNote {
  id: string
  pitch: number           // MIDI 0–127
  startBeat: number       // relative to clip startBeat
  durationBeats: number
  velocity: number        // 0–127
}

export interface MidiClip {
  kind: 'midi'
  id: string
  trackId: string
  name: string
  startBeat: number
  durationBeats: number
  notes: MidiNote[]
  isDrumClip: boolean
}

export type DawClip = AudioClip | MidiClip

export function isAudioClip(c: DawClip): c is AudioClip { return c.kind === 'audio' }
export function isMidiClip(c: DawClip): c is MidiClip   { return c.kind === 'midi'  }

export interface Scene {
  id: string
  name: string
  tempo?: number   // optional per-scene tempo override
}

// Session view grid: trackId → array indexed by scene
export type SessionGrid = Record<string, (DawClip | null)[]>

export interface DawProject {
  id: string
  name: string
  tempo: number
  timeSignatureNum: number
  timeSignatureDen: number
  tracks: DawTrack[]
  arrangementClips: DawClip[]
  scenes: Scene[]
  sessionGrid: SessionGrid
  loopStart: number        // beats
  loopEnd: number          // beats
  loopEnabled: boolean
  masterVolume: number     // 0–1
}

export type DawView = 'session' | 'arrangement' | 'mixer'

export type EditTarget =
  | { type: 'midi-clip'; clipId: string }
  | { type: 'audio-clip'; clipId: string }
  | null

export type SessionLaunchState = 'idle' | 'queued' | 'playing' | 'recording'

// Per-slot state for the session grid launch engine
export interface SlotState {
  trackId: string
  sceneIndex: number
  launchState: SessionLaunchState
  playheadFrac?: number  // 0–1 for playback progress ring
}

export const TRACK_COLORS = [
  '#3b82f6', '#22c55e', '#f97316', '#a855f7',
  '#ec4899', '#14b8a6', '#eab308', '#ef4444',
  '#6366f1', '#84cc16', '#06b6d4', '#f43f5e',
]

export const DEFAULT_TRACK_HEIGHT = 64

export function defaultProject(): DawProject {
  return {
    id: crypto.randomUUID(),
    name: 'Untitled',
    tempo: 120,
    timeSignatureNum: 4,
    timeSignatureDen: 4,
    tracks: [],
    arrangementClips: [],
    scenes: [
      { id: crypto.randomUUID(), name: 'Scene 1' },
      { id: crypto.randomUUID(), name: 'Scene 2' },
      { id: crypto.randomUUID(), name: 'Scene 3' },
      { id: crypto.randomUUID(), name: 'Scene 4' },
      { id: crypto.randomUUID(), name: 'Scene 5' },
      { id: crypto.randomUUID(), name: 'Scene 6' },
      { id: crypto.randomUUID(), name: 'Scene 7' },
      { id: crypto.randomUUID(), name: 'Scene 8' },
    ],
    sessionGrid: {},
    loopStart: 0,
    loopEnd: 16,
    loopEnabled: true,
    masterVolume: 0.85,
  }
}
