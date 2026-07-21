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

/**
 * One oscillator layer in a poly voice. Layers stack (osc 1 + osc 2 + a sub…),
 * and each layer can fan out into `unison` detuned copies for supersaw-style
 * width. `source` is a forward hook: 'sample' is reserved for a future
 * sample-based layer and is not yet rendered by the engine.
 */
export interface PolyOscLayer {
  source: 'wave' | 'sample'
  waveform: OscillatorType
  octave: number   // octave offset, -2..+2 (a sub is -1 or -2)
  detune: number   // fine offset in cents, -100..+100
  unison: number   // stacked detuned voices, 1..7
  spread: number   // total unison detune spread in cents
  level: number    // layer mix, 0..1
  // source === 'sample': a library sample played back pitched to the note.
  sampleId?: string
  sampleName?: string // display label for the picked sample
  sampleRoot?: number // MIDI note the sample is recorded at (default 60), for playbackRate pitching
}

export interface PolyInstrumentParams {
  waveform: OscillatorType
  attack: number
  decay: number
  sustain: number
  release: number
  detune: number
  /**
   * Multi-oscillator stack. Optional: when absent (older patches/projects) the
   * engine falls back to a single oscillator from `waveform`/`detune`, so
   * nothing that was saved before this existed changes how it sounds.
   */
  oscillators?: PolyOscLayer[]
  filterType: BiquadFilterType
  filterCutoff: number    // Hz 20–20000
  filterResonance: number // Q 0.1–20
  lfoEnabled: boolean
  lfoRate: number         // Hz 0.1–20
  lfoDepth: number        // 0–1
  lfoTarget: 'pitch' | 'filter' | 'amp'
  lfoWaveform: OscillatorType
}

export function defaultOscLayer(over: Partial<PolyOscLayer> = {}): PolyOscLayer {
  return { source: 'wave', waveform: 'sawtooth', octave: 0, detune: 0, unison: 1, spread: 0, level: 1, ...over }
}

/**
 * The oscillator layers a poly voice should actually play: the explicit list
 * when set, otherwise a single legacy layer synthesised from waveform/detune —
 * so patches saved before multi-oscillator existed keep playing unchanged.
 */
export function polyOscLayers(p: PolyInstrumentParams): PolyOscLayer[] {
  if (p.oscillators && p.oscillators.length > 0) return p.oscillators
  return [defaultOscLayer({ waveform: p.waveform, detune: p.detune })]
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

// Named poly-synth patches — the signature darkwave/dark-pop sounds from the
// starter songs. Shown as one-click presets in the poly instrument editor.
export const POLY_PRESETS: Record<string, PolyInstrumentParams> = {
  'Darkwave Lead':   { waveform: 'square',   attack: 0.01,  decay: 0.2,  sustain: 0.55, release: 0.4,  detune: 7,   filterType: 'lowpass', filterCutoff: 1500, filterResonance: 3,   lfoEnabled: true,  lfoRate: 5,    lfoDepth: 0.12, lfoTarget: 'pitch',  lfoWaveform: 'sine' },
  'Cold Pad':        { waveform: 'sawtooth', attack: 1.1,   decay: 0.6,  sustain: 0.7,  release: 0.9,  detune: -12, filterType: 'lowpass', filterCutoff: 1000, filterResonance: 2.2, lfoEnabled: true,  lfoRate: 0.22, lfoDepth: 0.25, lfoTarget: 'filter', lfoWaveform: 'sine' },
  'Sequencer Arp':   { waveform: 'square',   attack: 0.002, decay: 0.18, sustain: 0.0,  release: 0.16, detune: 12,  filterType: 'lowpass', filterCutoff: 2200, filterResonance: 3.2, lfoEnabled: false, lfoRate: 4,    lfoDepth: 0,    lfoTarget: 'filter', lfoWaveform: 'sine' },
  // Two saws ~9¢ apart — the phase-cancellation growl needs the second
  // oscillator, so this preset carries a 2-voice unison layer (a single
  // detuned oscillator can't beat against anything).
  'Reese Bass':      { waveform: 'sawtooth', attack: 0.006, decay: 0.12, sustain: 0.75, release: 0.2,  detune: 0,   oscillators: [defaultOscLayer({ waveform: 'sawtooth', unison: 2, spread: 9 })], filterType: 'lowpass', filterCutoff: 620,  filterResonance: 6,   lfoEnabled: false, lfoRate: 4,    lfoDepth: 0.3,  lfoTarget: 'filter', lfoWaveform: 'sine' },
  '808 Sub':         { waveform: 'sine',     attack: 0.006, decay: 0.2,  sustain: 0.92, release: 0.4,  detune: 0,   filterType: 'lowpass', filterCutoff: 3000, filterResonance: 1,   lfoEnabled: false, lfoRate: 4,    lfoDepth: 0.3,  lfoTarget: 'filter', lfoWaveform: 'sine' },
  'Aggro Lead':      { waveform: 'sawtooth', attack: 0.005, decay: 0.14, sustain: 0.6,  release: 0.28, detune: 10,  filterType: 'lowpass', filterCutoff: 2400, filterResonance: 4,   lfoEnabled: true,  lfoRate: 5.5,  lfoDepth: 0.12, lfoTarget: 'pitch',  lfoWaveform: 'sine' },
  'Industrial Bass': { waveform: 'sawtooth', attack: 0.004, decay: 0.1,  sustain: 0.75, release: 0.16, detune: 16,  filterType: 'lowpass', filterCutoff: 900,  filterResonance: 6.5, lfoEnabled: false, lfoRate: 4,    lfoDepth: 0.3,  lfoTarget: 'filter', lfoWaveform: 'sine' },
  'Brass Pad':       { waveform: 'sawtooth', attack: 0.4,   decay: 0.5,  sustain: 0.7,  release: 0.9,  detune: -12, filterType: 'lowpass', filterCutoff: 1600, filterResonance: 2,   lfoEnabled: true,  lfoRate: 0.35, lfoDepth: 0.2,  lfoTarget: 'filter', lfoWaveform: 'sine' },
  'Glass Pluck':     { waveform: 'triangle', attack: 0.004, decay: 0.14, sustain: 0.0,  release: 0.18, detune: 4,   filterType: 'lowpass', filterCutoff: 2400, filterResonance: 3,   lfoEnabled: false, lfoRate: 4,    lfoDepth: 0.3,  lfoTarget: 'filter', lfoWaveform: 'sine' },
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

// ── Tone EQ ───────────────────────────────────────────────────────────────────
// A simple 4-band tone control (all values in dB, -12..+12, 0 = flat).
// Applied per-track (DawTrack.tone) and per-MIDI-clip (MidiClip.rollFx).
export interface ToneParams {
  sub?: number      // low shelf ~70 Hz
  bass?: number     // low shelf ~200 Hz
  mid?: number      // peaking ~1 kHz
  treble?: number   // high shelf ~8 kHz
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
  tone?: ToneParams   // per-track 4-band tone EQ (sub/bass/mid/treble)
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
  /** Who added this clip (collab attribution) — stamped at creation. */
  createdBy?: string
  /** When it was added (ISO) — powers the away-recap. */
  createdAt?: string
  startBeat: number
  durationBeats: number
  r2Key?: string
  audioUrl?: string
  /** Sound-library entry the audio came from (pad bounces) — lets the engine
   *  re-render/reload the sample after a project reload, when the session's
   *  blob: URL is long dead. */
  libraryId?: string
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
  /** Who added this clip (collab attribution) — stamped at creation. */
  createdBy?: string
  /** When it was added (ISO) — powers the away-recap. */
  createdAt?: string
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
  /** Clip-local sound settings from the piano roll's Settings panel. Sustain
   *  (seconds) lets notes ring past their end with a release ramp; the rest
   *  wrap each note in a distortion → lowpass → reverb chain. Only this
   *  clip's notes are affected. */
  rollFx?: { sustain?: number; reverbWet?: number; distortion?: number; filterHz?: number; sub?: number; bass?: number; mid?: number; treble?: number }
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
  /** Their transport position while playing (beats) — null when stopped */
  playheadBeat?: number | null
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
  /** Tempo changes: playback switches BPM when the playhead crosses a marker. */
  tempoMarkers?: Array<{ id: string; beat: number; tempo: number }>
  /** Arranger sections: each runs from its beat to the next section (or the end). */
  sections?: Array<{ id: string; beat: number; name: string; color: string }>
  /** Timeline comments: beat-anchored feedback threads from collaborators. */
  comments?: TimelineComment[]
  key: number               // 0-11 (C=0), displayed in transport
  scale: string             // 'major' | 'minor' | etc.
}

export interface TimelineComment {
  id: string
  beat: number
  author: string
  text: string
  createdAt: string          // ISO
  resolved?: boolean
  replies?: Array<{ id: string; author: string; text: string; createdAt: string }>
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
