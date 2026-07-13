// Core DAW types shared across engine and UI

import type { FMPatch, FMAlgorithm, FMOperator } from './fm-synth'
import type { WavetablePatch } from './wavetable-synth'

// Re-exported synth engine patch types, used as instrument params
export type Fm4OpInstrumentParams     = FMPatch
export type Fm4OpAlgorithm            = FMAlgorithm
export type Fm4OpOperator             = FMOperator
export type WavetableInstrumentParams = WavetablePatch

export type TrackType = 'audio'

export type CrossfaderSide = 'A' | 'B' | 'none'

export type FollowAction = 'stop' | 'again' | 'next' | 'prev' | 'first' | 'last' | 'random' | 'none'

// ── Effects ───────────────────────────────────────────────────────────────────

export type EffectType = 'eq3' | 'compressor' | 'reverb' | 'delay' | 'filter' | 'saturator' | 'redux' | 'autopan' | 'utility' | 'lfo' | 'noisegate' | 'deesser' | 'chorus' | 'transientshaper' | 'multibandcomp'

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
  sidechainTrackId?: string | null
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

export interface SaturatorParams {
  enabled: boolean
  drive: number      // 0..1 — controls tanh waveshaper gain
  color: number      // 0..1 — low-shelf boost pre-shaper (warmth)
  output: number     // dB -12..+6
}

export interface ReduxParams {
  enabled: boolean
  bitDepth: number   // 1..16 — quantizes to 2^n steps
  sampleRate: number // 100..44100 — downsamples by factor
}

export interface AutoPanParams {
  enabled: boolean
  rate: number       // Hz 0.01..10
  depth: number      // 0..1
  waveform: 'sine' | 'triangle' | 'square'
  phase: number      // degrees 0..360 (offset between L/R)
}

export interface UtilityParams {
  enabled: boolean
  gain: number       // dB -inf..+12
  mono: boolean      // collapse stereo to mono
  muteL: boolean
  muteR: boolean
  width: number      // 0..2 (1 = normal stereo)
}

export interface LfoParams {
  enabled: boolean
  rate: number       // Hz 0.01..20
  depth: number      // 0..1
  waveform: 'sine' | 'triangle' | 'sawtooth' | 'square'
  target: 'pan' | 'volume' | 'filter'
  filterFreqMin: number   // Hz — used when target='filter'
  filterFreqMax: number   // Hz
}

export interface NoiseGateParams {
  enabled: boolean
  threshold: number   // dB -80..0 (default -40)
  attack: number      // s 0..0.5 (default 0.01)
  hold: number        // s 0..0.5 (default 0.05)
  release: number     // s 0..2 (default 0.2)
  reduction: number   // dB how much to cut -80..-20 (default -60)
}

export interface DeEsserParams {
  enabled: boolean
  frequency: number   // Hz 4000..16000 (default 7500)
  bandwidth: number   // octaves 0.5..3 (default 1)
  threshold: number   // dB -60..0 (default -20)
  reduction: number   // dB 0..24 (default 12)
}

export interface ChorusParams {
  enabled: boolean
  type: 'chorus' | 'flanger' | 'phaser'
  rate: number        // Hz 0.1..10 (default 0.5)
  depth: number       // 0..1 (default 0.5)
  feedback: number    // 0..0.9 (default 0.3)
  mix: number         // 0..1 wet (default 0.5)
  stages: number      // phaser stages 2..12 (default 4)
}

export interface TransientShaperParams {
  enabled: boolean
  attack: number      // -12..+12 dB attack emphasis (default 0)
  sustain: number     // -12..+12 dB sustain shaping (default 0)
  gain: number        // -6..+6 dB output (default 0)
}

export interface MultibandCompParams {
  enabled: boolean
  lowMid: number          // Hz crossover low/mid (default 250)
  midHigh: number         // Hz crossover mid/high (default 4000)
  lowThreshold: number    // dB (default -24)
  midThreshold: number    // dB (default -24)
  highThreshold: number   // dB (default -24)
  lowRatio: number        // (default 4)
  midRatio: number        // (default 4)
  highRatio: number       // (default 4)
  lowGain: number         // dB makeup (default 0)
  midGain: number         // dB makeup (default 0)
  highGain: number        // dB makeup (default 0)
}

export type TrackEffectParams = Eq3Params | CompressorParams | ReverbParams | DelayParams | FilterParams | SaturatorParams | ReduxParams | AutoPanParams | UtilityParams | LfoParams | NoiseGateParams | DeEsserParams | ChorusParams | TransientShaperParams | MultibandCompParams

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
export function defaultSaturator(): SaturatorParams {
  return { enabled: true, drive: 0.4, color: 0.3, output: 0 }
}
export function defaultRedux(): ReduxParams {
  return { enabled: true, bitDepth: 8, sampleRate: 22050 }
}
export function defaultAutoPan(): AutoPanParams {
  return { enabled: true, rate: 1, depth: 0.7, waveform: 'sine', phase: 180 }
}
export function defaultUtility(): UtilityParams {
  return { enabled: true, gain: 0, mono: false, muteL: false, muteR: false, width: 1 }
}
export function defaultLfo(): LfoParams {
  return { enabled: true, rate: 1, depth: 0.5, waveform: 'sine', target: 'pan', filterFreqMin: 200, filterFreqMax: 8000 }
}
export function defaultNoiseGate(): NoiseGateParams { return { enabled: true, threshold: -40, attack: 0.01, hold: 0.05, release: 0.2, reduction: -60 } }
export function defaultDeEsser(): DeEsserParams { return { enabled: true, frequency: 7500, bandwidth: 1, threshold: -20, reduction: 12 } }
export function defaultChorus(): ChorusParams { return { enabled: true, type: 'chorus', rate: 0.5, depth: 0.5, feedback: 0.3, mix: 0.5, stages: 4 } }
export function defaultTransientShaper(): TransientShaperParams { return { enabled: true, attack: 0, sustain: 0, gain: 0 } }
export function defaultMultibandComp(): MultibandCompParams { return { enabled: true, lowMid: 250, midHigh: 4000, lowThreshold: -24, midThreshold: -24, highThreshold: -24, lowRatio: 4, midRatio: 4, highRatio: 4, lowGain: 0, midGain: 0, highGain: 0 } }

/** Returns a fresh voice-optimized effects chain for podcast/voice recording. */
export function voiceChainEffects(): TrackEffect[] {
  return [
    { id: crypto.randomUUID(), type: 'filter',     params: { enabled: true, type: 'highpass' as FilterParams['type'], frequency: 80, q: 0.7 } as FilterParams },
    { id: crypto.randomUUID(), type: 'compressor', params: { enabled: true, threshold: -18, ratio: 4, attack: 0.003, release: 0.25, knee: 6, makeupGain: 3, sidechainTrackId: null } as CompressorParams },
    { id: crypto.randomUUID(), type: 'eq3',        params: { enabled: true, lowGain: -2, midGain: 3, highGain: 0, lowFreq: 200, midFreq: 3000, highFreq: 8000 } as Eq3Params },
  ]
}

// ── MIDI Effects ──────────────────────────────────────────────────────────────

export type MidiEffectType = 'velocity' | 'scale' | 'chord' | 'arp'

export interface VelocityMidiParams {
  enabled: boolean
  outMin: number    // 0-127
  outMax: number    // 0-127
  random: number    // 0-127 max random offset added
}

export interface ScaleMidiParams {
  enabled: boolean
  root: number      // 0-11 (C=0)
  scale: 'major' | 'minor' | 'penta-maj' | 'penta-min' | 'dorian' | 'chromatic'
}

export interface ChordMidiParams {
  enabled: boolean
  intervals: number[]  // semitone offsets to add (e.g. [4,7] = major triad)
}

export interface ArpMidiParams {
  enabled: boolean
  style: 'up' | 'down' | 'updown' | 'random'
  rate: number     // beats per note (e.g. 0.25 = 1/16th)
  octaves: number  // 1, 2, or 3
  gate: number     // 0-1, note length as fraction of rate
}

export type MidiEffectParams = VelocityMidiParams | ScaleMidiParams | ChordMidiParams | ArpMidiParams

export interface MidiEffect {
  id: string
  type: MidiEffectType
  params: MidiEffectParams
}

export function defaultVelocityMidi(): VelocityMidiParams { return { enabled: true, outMin: 0, outMax: 127, random: 0 } }
export function defaultScaleMidi(): ScaleMidiParams { return { enabled: true, root: 0, scale: 'major' } }
export function defaultChordMidi(): ChordMidiParams { return { enabled: true, intervals: [4, 7] } }
export function defaultArpMidi(): ArpMidiParams { return { enabled: true, style: 'up', rate: 0.25, octaves: 1, gate: 0.9 } }

// ── Instruments ───────────────────────────────────────────────────────────────

export type InstrumentType = 'none' | 'drum' | 'fm' | 'poly' | 'sampler' | 'fm4op' | 'wavetable'

export interface DrumPadSettings {
  sampleId?: string   // library preset id or custom sample id
  volume: number      // 0..1
  pitch: number       // semitones -24..24
  pan: number         // -1..1
  mute: boolean
}

export interface DrumInstrumentParams {
  pack: 'synth' | '808'
  pads?: Record<number, DrumPadSettings>  // keyed by MIDI pitch
}

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

export type InstrumentParams = DrumInstrumentParams | FmInstrumentParams | PolyInstrumentParams | Fm4OpInstrumentParams | WavetableInstrumentParams | Record<string, never>

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

export function defaultFm4opInstrument(): TrackInstrument {
  const p: Fm4OpInstrumentParams = {
    name: 'Electric Piano 1',
    algorithm: 3,
    masterGain: 0.65,
    pitchEgRate: 0,
    operators: [
      { ratio: 14, level: 0.28, attack: 0.001, decay: 0.55, sustain: 0.0,  release: 0.50, feedback: 0.55, detune: 0 },
      { ratio: 1,  level: 0.90, attack: 0.001, decay: 2.5,  sustain: 0.6,  release: 0.60, feedback: 0,    detune: 0 },
      { ratio: 14, level: 0.22, attack: 0.001, decay: 0.45, sustain: 0.0,  release: 0.40, feedback: 0,    detune: 0 },
      { ratio: 1,  level: 0.80, attack: 0.001, decay: 2.0,  sustain: 0.55, release: 0.55, feedback: 0,    detune: 0 },
    ],
  }
  return { type: 'fm4op', params: p }
}

export function defaultWavetableInstrument(): TrackInstrument {
  const p: WavetableInstrumentParams = {
    oscAWavetable: 'strings', oscAPosition: 0.5,  oscADetune: 0,  oscAGain: 0.75,
    oscBWavetable: 'strings', oscBPosition: 0.55, oscBDetune: -7, oscBGain: 0.6,
    filterType: 'lowpass', filterCutoff: 900, filterResonance: 1, filterEnvAmount: 0.3,
    attack: 0.6, decay: 1.0, sustain: 0.75, release: 1.5,
    fAttack: 0.5, fDecay: 0.8, fSustain: 0.6, fRelease: 1.2,
    lfoShape: 'sine', lfoRate: 0.4, lfoDepth: 0.04, lfoTarget: 'pitch',
    masterGain: 0.7, polyphony: 4,
  }
  return { type: 'wavetable', params: p }
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
  frozen?: boolean    // freeze: render to audio buffer, disable instrument
  inputSource?: string | null  // 'mic' | 'system' | null — audio input for recording
  height: number      // arrangement lane height in px
  effects: TrackEffect[]
  midiEffects?: MidiEffect[]
  instrument: TrackInstrument
  groupId?: string    // parent group track id
  sendAmounts?: Record<string, number>  // returnTrackId → send level 0–1
  sendModes?: Record<string, 'pre' | 'post'>  // returnTrackId → pre/post fader
  crossfader?: CrossfaderSide
}

export interface ReturnTrack {
  id: string
  name: string
  color: string
  volume: number
  pan: number
  mute: boolean
  soloSafe?: boolean  // stays audible when a track is soloed
  effects: TrackEffect[]
}

export interface CueMarker {
  id: string
  beat: number
  name: string
  color?: string
}

export interface TakeLane {
  id: string
  trackId: string
  name: string
  clips: AudioClip[]
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
  boomerang?: boolean
  color?: string
  launchQuantization?: LaunchQuantization
  followAction?: FollowAction
  followActionTime?: number  // beats after which follow action fires
}

export interface MidiNote {
  id: string
  pitch: number
  startBeat: number    // relative to clip startBeat
  durationBeats: number
  velocity: number     // 0–127
  presetId?: string    // MIDI preset active when this note was recorded
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
  /** When true, the note pattern repeats every loopLengthBeats for the clip's duration. */
  loopEnabled?: boolean
  /** Pattern length in beats — set when looping is enabled (content length rounded up to a bar). */
  loopLengthBeats?: number
  /** Recipe clips: edge-resize scales the note pattern to the new length instead of looping. */
  stretchNotes?: boolean
  /** Pitch class (0=C … 11=B) the pattern is rooted on — the piano roll's Root selector transposes relative to this. */
  rootNote?: number
  presetId?: string   // MIDI preset for note playback (overrides track instrument)
  /** Voice mapping: a sung pitch trace overlaid on the piano roll as a reference.
   *  Points are [beat relative to clip start, fractional MIDI pitch]. The audio
   *  itself is session-only; the trace persists. */
  voiceMap?: { offsetMs: number; points: [number, number][] }
  color?: string
  launchQuantization?: LaunchQuantization
  followAction?: FollowAction
  followActionTime?: number
}

export type DawClip = AudioClip | MidiClip

export function isAudioClip(c: DawClip): c is AudioClip { return c.kind === 'audio' }
export function isMidiClip(c: DawClip): c is MidiClip   { return c.kind === 'midi'  }

// ── Collaboration ─────────────────────────────────────────────────────────────

/** A connected collaborator's live focus, bridged out of the Liveblocks room. */
export interface CollabPeer {
  connectionId: number
  name: string
  color: string
  selectedTrackId: string | null
  selectedClipId: string | null
  /** Clip open in their piano roll — treat as a soft edit lock */
  editingClipId: string | null
}

// ── Scene ─────────────────────────────────────────────────────────────────────

export interface Scene {
  id: string
  name: string
  tempo?: number
  timeSignatureNum?: number
  timeSignatureDen?: number
  color?: string
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
  returnTracks: ReturnTrack[]
  takeLanes: TakeLane[]
  crossfaderValue: number   // 0–1 (0=A, 0.5=center, 1=B)
  waveformZoom: number      // 1–8 vertical zoom multiplier for arrangement waveforms
  swing: number             // 0–1 (0 = straight, 0.5 = full swing)
  cueMarkers: CueMarker[]
  key: number               // 0-11 (C=0), displayed in transport
  scale: string             // 'major' | 'minor' | etc.
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

export function defaultTrackInstrument(_type?: TrackType): TrackInstrument {
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
    returnTracks: [],
    takeLanes: [],
    crossfaderValue: 0.5,
    waveformZoom: 1,
    swing: 0,
    cueMarkers: [],
    key: 0,
    scale: 'major',
  }
}
