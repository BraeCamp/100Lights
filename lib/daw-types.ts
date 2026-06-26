// Core DAW types shared across engine and UI

export type TrackType = 'audio' | 'midi' | 'drum'

// ── Effects ───────────────────────────────────────────────────────────────────

export type EffectType = 'eq3' | 'compressor' | 'reverb' | 'delay' | 'filter'

export interface Eq3Params {
  enabled: boolean
  lowGain: number    // dB -12..+12
  midGain: number
  highGain: number
  lowFreq: number    // Hz (default 200)
  midFreq: number    // Hz (default 1000)
  highFreq: number   // Hz (default 8000)
}

export interface CompressorParams {
  enabled: boolean
  threshold: number  // dB -60..0
  ratio: number      // 1..20
  attack: number     // s 0..1
  release: number    // s 0..1
  knee: number       // dB 0..40
  makeupGain: number // dB 0..24
}

export interface ReverbParams {
  enabled: boolean
  wet: number        // 0..1
  decay: number      // s 0.1..10
  preDelay: number   // s 0..0.5
}

export interface DelayParams {
  enabled: boolean
  wet: number        // 0..1
  time: number       // s 0..2
  feedback: number   // 0..0.95
  syncToTempo: boolean
  syncBeats: number  // beats when syncToTempo
}

export interface FilterParams {
  enabled: boolean
  type: 'lowpass' | 'highpass' | 'bandpass' | 'notch'
  frequency: number  // Hz 20..20000
  q: number          // 0.1..20
}

export type TrackEffectParams = Eq3Params | CompressorParams | ReverbParams | DelayParams | FilterParams

export interface TrackEffect {
  id: string
  type: EffectType
  params: TrackEffectParams
}

export function defaultEq3(): Eq3Params {
  return { enabled: true, lowGain: 0, midGain: 0, highGain: 0, lowFreq: 200, midFreq: 1000, highFreq: 8000 }
}
export function defaultCompressor(): CompressorParams {
  return { enabled: true, threshold: -24, ratio: 4, attack: 0.003, release: 0.25, knee: 6, makeupGain: 0 }
}
export function defaultReverb(): ReverbParams {
  return { enabled: true, wet: 0.25, decay: 2, preDelay: 0.02 }
}
export function defaultDelay(): DelayParams {
  return { enabled: true, wet: 0.25, time: 0.375, feedback: 0.4, syncToTempo: true, syncBeats: 0.5 }
}
export function defaultFilter(): FilterParams {
  return { enabled: true, type: 'lowpass', frequency: 8000, q: 1 }
}

// ── Instruments ───────────────────────────────────────────────────────────────

export type InstrumentType = 'none' | 'drum' | 'fm' | 'poly' | 'sampler'

export interface DrumInstrumentParams { pack: 'synth' | '808' }

export interface FmInstrumentParams {
  waveform: OscillatorType
  attack: number    // s
  decay: number     // s
  sustain: number   // 0..1
  release: number   // s
  detune: number    // cents
  modRatio: number  // FM modulator freq = carrier * modRatio
  modDepth: number  // FM mod index
}

export interface PolyInstrumentParams {
  waveform: OscillatorType
  attack: number
  decay: number
  sustain: number
  release: number
  detune: number
  filterType: BiquadFilterType
  filterCutoff: number    // Hz 20–20000
  filterResonance: number // Q 0.1–20
  lfoEnabled: boolean
  lfoRate: number         // Hz 0.1–20
  lfoDepth: number        // 0–1
  lfoTarget: 'pitch' | 'filter' | 'amp'
  lfoWaveform: OscillatorType
}

export type InstrumentParams = DrumInstrumentParams | FmInstrumentParams | PolyInstrumentParams | Record<string, never>

export interface TrackInstrument {
  type: InstrumentType
  params: InstrumentParams
}

export function defaultDrumInstrument(): TrackInstrument {
  return { type: 'drum', params: { pack: 'synth' } }
}

export function defaultFmInstrument(): TrackInstrument {
  return { type: 'fm', params: { waveform: 'sine', attack: 0.01, decay: 0.1, sustain: 0.7, release: 0.3, detune: 0, modRatio: 2, modDepth: 1 } }
}

export function defaultPolyInstrument(): TrackInstrument {
  return {
    type: 'poly',
    params: {
      waveform: 'sawtooth', attack: 0.005, decay: 0.15, sustain: 0.6, release: 0.4,
      detune: 0,
      filterType: 'lowpass', filterCutoff: 2400, filterResonance: 1.2,
      lfoEnabled: false, lfoRate: 4, lfoDepth: 0.3, lfoTarget: 'filter', lfoWaveform: 'sine',
    } as PolyInstrumentParams,
  }
}

// ── Clip Effects ─────────────────────────────────────────────────────────────

export type ClipEffectType = 'volume' | 'reverb' | 'delay' | 'filter' | 'tremolo' | 'distortion' | 'pitch'

export interface AutoPoint {
  id: string
  t: number              // beats from effect start (0..durationBeats)
  v: number              // normalized 0-1
  smooth: boolean        // whether bezier handles are active
  h1: [number, number]   // left handle offset  [dt_beats, dv]
  h2: [number, number]   // right handle offset [dt_beats, dv]
}

export interface ClipEffect {
  id: string
  trackId: string
  type: ClipEffectType
  startBeat: number
  durationBeats: number
  row?: number
  params: {
    gain?: number           // volume: 0-2; also pitch base gain
    reverbWet?: number      // reverb: 0-1
    reverbDecay?: number    // reverb: 0.5-5s
    delayTime?: number      // delay: 0-2s
    feedback?: number       // delay: 0-0.9
    delayWet?: number       // delay: 0-1
    frequency?: number      // filter: 20-20000 Hz
    filterType?: BiquadFilterType
    filterQ?: number        // filter: 0.1-20
    tremoloRate?: number    // tremolo: 0.1-15 Hz
    tremoloDepth?: number   // tremolo: 0-1
    distortion?: number     // distortion: 0-1
    semitones?: number      // pitch: static offset in semitones
    shapeEnvelope?: number[] // shaped volume (0-1) or pitch (semitone offsets) data
    shapeSampleRate?: number // samples per second of shapeEnvelope (default 30)
  }
  automation?: {
    param: string
    points: AutoPoint[]
  }
}

// ── Automation ────────────────────────────────────────────────────────────────

export interface AutomationPoint {
  id: string
  beat: number    // absolute beat position in arrangement
  value: number   // normalized 0..1
}

export interface AutomationLane {
  id: string
  trackId: string
  parameter: string   // 'volume' | 'pan' | 'fx:{effectId}:{paramKey}'
  label: string
  min: number
  max: number
  defaultValue: number
  points: AutomationPoint[]
  expanded: boolean
}

// ── Track ─────────────────────────────────────────────────────────────────────

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
  inputSource?: string | null  // 'mic' | 'system' | null — audio input for recording
  height: number      // arrangement lane height in px
  effects: TrackEffect[]
  instrument: TrackInstrument
}

// ── Clips ─────────────────────────────────────────────────────────────────────

export interface AudioClip {
  kind: 'audio'
  id: string
  trackId: string
  name: string
  startBeat: number
  durationBeats: number
  r2Key?: string
  audioUrl?: string
  waveformPeaks?: number[]
  gain: number
  loopEnabled: boolean
  reverse: boolean
  fadeIn: number
  fadeOut: number
  trimStart: number
  trimEnd: number
  bufferDuration?: number   // seconds — populated on first buffer load for crop math
  warpEnabled?: boolean
  warpMode?: 'repitch' | 'stretch'
  pitchSemitones?: number
  pitchCents?: number
}

export interface MidiNote {
  id: string
  pitch: number
  startBeat: number    // relative to clip startBeat
  durationBeats: number
  velocity: number     // 0–127
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

// ── Scene ─────────────────────────────────────────────────────────────────────

export interface Scene {
  id: string
  name: string
  tempo?: number
}

export type SessionGrid = Record<string, (DawClip | null)[]>

// ── Project ───────────────────────────────────────────────────────────────────

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
  loopStart: number
  loopEnd: number
  loopEnabled: boolean
  masterVolume: number
  automationLanes: AutomationLane[]
  clipEffects: ClipEffect[]
}

// ── UI state ──────────────────────────────────────────────────────────────────

export type DawView = 'session' | 'arrangement' | 'mixer'

export type EditTarget =
  | { type: 'midi-clip'; clipId: string }
  | { type: 'audio-clip'; clipId: string }
  | null

export type LaunchQuantization = 'none' | 'beat' | 'bar' | '2bar' | '4bar'

// ── Constants ─────────────────────────────────────────────────────────────────

export const TRACK_COLORS = [
  '#3b82f6', '#22c55e', '#f97316', '#a855f7',
  '#ec4899', '#14b8a6', '#eab308', '#ef4444',
  '#6366f1', '#84cc16', '#06b6d4', '#f43f5e',
]

export const DEFAULT_TRACK_HEIGHT = 64

export function defaultTrackInstrument(type: TrackType): TrackInstrument {
  if (type === 'drum') return defaultDrumInstrument()
  if (type === 'midi') return defaultFmInstrument()
  return { type: 'none', params: {} }
}

export function defaultProject(): DawProject {
  return {
    id: crypto.randomUUID(),
    name: 'Untitled',
    tempo: 120,
    timeSignatureNum: 4,
    timeSignatureDen: 4,
    tracks: [],
    arrangementClips: [],
    scenes: Array.from({ length: 8 }, (_, i) => ({ id: crypto.randomUUID(), name: `Scene ${i + 1}` })),
    sessionGrid: {},
    loopStart: 0,
    loopEnd: 16,
    loopEnabled: false,
    masterVolume: 0.85,
    automationLanes: [],
    clipEffects: [],
  }
}
