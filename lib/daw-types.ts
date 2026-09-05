// Core DAW types shared across engine and UI

import type { FMPatch, FMAlgorithm, FMOperator } from './fm-synth'
import type { WavetablePatch } from './wavetable-synth'
import type { MidiPreset } from './midi-presets'   // type-only — no runtime cycle

// Re-exported synth engine patch types, used as instrument params
export type Fm4OpInstrumentParams     = FMPatch
export type Fm4OpAlgorithm            = FMAlgorithm
export type Fm4OpOperator             = FMOperator
export type WavetableInstrumentParams = WavetablePatch
// Apollo hybrid synth (wavetable/sample/granular/spectral engine at /apollo)
export type ApolloInstrumentParams = import('./apollo/patch').ApolloPatch
/** A Beacon plugin on a track. See lib/beacon-plugins/. */
export type PluginTrackParams = import('./beacon-plugins/types').PluginInstrumentParams

export type TrackType = 'audio'

export type CrossfaderSide = 'A' | 'B' | 'none'

export type FollowAction = 'stop' | 'again' | 'next' | 'prev' | 'first' | 'last' | 'random' | 'none'

// ── Effects ───────────────────────────────────────────────────────────────────

export type EffectType = 'eq3' | 'compressor' | 'reverb' | 'delay' | 'filter' | 'saturator' | 'redux' | 'autopan' | 'utility' | 'lfo' | 'noisegate' | 'deesser' | 'chorus' | 'transientshaper' | 'multibandcomp' | 'limiter' | 'dyneq' | 'unmask' | 'helios'

/**
 * Unmask — duck this track in the bands where ANOTHER track is loud.
 *
 * A plain sidechain ducks everything whenever the key plays. This ducks only the
 * frequencies that are actually clashing, and only while they clash, so a pad
 * steps aside for a vocal at 400Hz without losing its top and bottom too.
 */
export interface UnmaskParams {
  enabled: boolean
  /** The track to listen to. Null = nothing to respond to, so it passes through. */
  keyTrackId?: string | null
  /** How far out of the way to get, 0..1. */
  amount: number
  /** How quickly a band steps aside, seconds. */
  attack: number
  /** How long it stays there after the key stops, seconds. */
  release: number
  /** Sensitivity in dB — lower means quieter key material still triggers it. */
  threshold: number
  /** Per-band depth, low → high. Lets a bass duck in the mids and keep its floor. */
  bandLow: number
  bandBody: number
  bandPresence: number
  bandAir: number
}

export function defaultUnmask(): UnmaskParams {
  return {
    enabled: true, keyTrackId: null, amount: 0.6,
    attack: 0.008, release: 0.18, threshold: -30,
    // Body and presence are where masking actually happens, so those lean in;
    // the low band is left alone by default because ducking a bass's bottom is
    // usually the opposite of what someone reaches for this to do.
    bandLow: 0.35, bandBody: 1, bandPresence: 1, bandAir: 0.6,
  }
}

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
  // Load your own impulse response (a real hall/plate/room/cabinet). When set,
  // it replaces the synthetic IR and decay/pre-delay no longer apply. Stored as
  // a data URL so it travels with the project; clear it to return to built-in.
  irData?: string
  irName?: string
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

/** An Apollo FxUnit stored directly as a Beacon device — created when a chain
 * is edited in the Apollo Rack card. Plays via the Helios path only (the
 * legacy graph has no builder for it); DeviceChain shows a compact card with
 * an "Edit in Apollo" affordance. `unit` is lib/apollo FxUnit-shaped. */
export interface HeliosFxParams {
  enabled: boolean
  unit: { id: string; type: string; enabled: boolean; mix: number; params: Record<string, number>; chains?: unknown[][] }
}

export type TrackEffectParams = Eq3Params | CompressorParams | ReverbParams | DelayParams | FilterParams | SaturatorParams | ReduxParams | AutoPanParams | UtilityParams | LfoParams | NoiseGateParams | DeEsserParams | ChorusParams | TransientShaperParams | MultibandCompParams | LimiterParams | DynEqParams | UnmaskParams | HeliosFxParams

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

// Brickwall limiter / maximizer — the final loudness stage for the master bus.
// `gainDb` drives the signal into a fast, high-ratio compressor pinned just
// under `ceilingDb`, so peaks are caught and the mix gets louder without
// clipping. Pair it with the master LUFS meter to hit a target loudness.
export interface LimiterParams {
  enabled: boolean
  gainDb: number     // input drive, dB 0..24
  ceilingDb: number  // output ceiling, dB -12..0
  release: number    // s 0.005..1
}
export function defaultLimiter(): LimiterParams {
  return { enabled: true, gainDb: 0, ceilingDb: -0.3, release: 0.1 }
}

// Single-band dynamic EQ: a peaking filter at `freq` whose gain is driven by
// how far the energy *in that band* sits over `thresholdDb`. Negative `rangeDb`
// tames a resonance / de-muddens only when it flares up; positive lifts a band
// when it's shy. More surgical than the fixed-band multiband comp, more movable
// than the sibilance-only de-esser.
export interface DynEqParams {
  enabled: boolean
  freq: number        // Hz 20..20000
  q: number           // 0.3..12
  thresholdDb: number // -60..0 — band level above which it acts
  rangeDb: number     // -18..18 — max cut (−) or boost (+) applied
  attack: number      // s 0.001..0.5
  release: number     // s 0.01..1
}
export function defaultDynEq(): DynEqParams {
  return { enabled: true, freq: 300, q: 2, thresholdDb: -30, rangeDb: -6, attack: 0.01, release: 0.15 }
}
export function defaultReverb(): ReverbParams {
  return { enabled: true, wet: 0.25, decay: 2, preDelay: 0.02 }
}
export function defaultDelay(): DelayParams {
  return { enabled: true, wet: 0.25, time: 0.375, feedback: 0.4, syncToTempo: true, syncBeats: 0.5 }
}
export function defaultFilter(): FilterParams {
  // ⚠️ 1200 Hz, not 8000. Brae: "When I add a lowpass filter, I should hear a
  // lowpass filter and I don't hear any changes."
  //
  // He was right and it was not a bug in the filter — it was this number. A
  // low-pass at 8 kHz sits above almost everything in a pad or a bass, and it
  // was measured: at 8 kHz a chord keeps 98% of its energy above 2 kHz, at
  // 2 kHz it keeps 70%, at 800 Hz a third. So the filter arrived doing nothing
  // and the only way to find that out was to go looking for the knob.
  //
  // The app itself never believed in this default: every filter in
  // demo-projects.ts overrides it (2600, 400, 380), which is the tell.
  //
  // 1200 Hz is a filter you hear the moment it lands — a clear darkening — and
  // still leaves the body of the sound to work with. Adding an effect should
  // do something; that is what adding it means.
  return { enabled: true, type: 'lowpass', frequency: 1200, q: 1 }
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

export type InstrumentType = 'none' | 'drum' | 'fm' | 'poly' | 'sampler' | 'fm4op' | 'wavetable' | 'apollo' | 'plugin'

export interface DrumPadSettings {
  sampleId?: string   // library preset id or custom sample id
  volume: number      // 0..1
  pitch: number       // semitones -24..24
  pan: number         // -1..1
  mute: boolean
  /** Choke/cut group. Pads sharing the same non-zero group cut each other off
   *  (a closed hi-hat silences a ringing open hi-hat). 0 = never chokes;
   *  undefined = default (hi-hats auto-choke each other). */
  chokeGroup?: number
  /** A one-shot sample baked into the pad — the audio travels WITH the kit
   *  (localStorage + community), so a sample kit is portable and independent of
   *  the sound library. `data` is a base64 audio data-URI; `id` is a stable key
   *  for the decoded-buffer cache. When present it plays instead of the synth
   *  pack. */
  sample?: { id: string; name?: string; data: string }
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
  /** Name of the POLY_PRESET this patch came from — the instrument editor
   *  highlights it and shows the sound as recognizable, not "custom". Cleared
   *  the moment any parameter is hand-edited. */
  preset?: string
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

export type InstrumentParams = DrumInstrumentParams | FmInstrumentParams | PolyInstrumentParams | Fm4OpInstrumentParams | WavetableInstrumentParams | ApolloInstrumentParams | PluginTrackParams | Record<string, never>

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
  // ── Expanded flagship set — starting points across bass / lead / pad / keys.
  // (Params are principled recipes; audition and tweak by ear to taste.)
  'Super Saw':       { waveform: 'sawtooth', attack: 0.01,  decay: 0.2,  sustain: 0.8,  release: 0.4,  detune: 0,   oscillators: [defaultOscLayer({ waveform: 'sawtooth', unison: 7, spread: 22 })], filterType: 'lowpass', filterCutoff: 4200, filterResonance: 1.4, lfoEnabled: false, lfoRate: 4,    lfoDepth: 0,    lfoTarget: 'filter', lfoWaveform: 'sine' },
  'Deep Sub':        { waveform: 'sine',     attack: 0.008, decay: 0.15, sustain: 0.95, release: 0.35, detune: 0,   filterType: 'lowpass', filterCutoff: 220,  filterResonance: 0.7, lfoEnabled: false, lfoRate: 4,    lfoDepth: 0,    lfoTarget: 'filter', lfoWaveform: 'sine' },
  // A pure-sine SUBWOOFER drone: instant attack, DEAD-FLAT sustain (no decay dip),
  // tiny release → a long held sub note that hits and holds "without much change
  // or release". A synth oscillator, so it plays the true sub octave (<60Hz) that
  // sampled basses can't reach, and never decays like a sample. purity ≈ 1.0.
  'Sub Sine':        { waveform: 'sine',     attack: 0.004, decay: 0.0,  sustain: 1.0,  release: 0.08, detune: 0,   filterType: 'lowpass', filterCutoff: 130,  filterResonance: 0.7, lfoEnabled: false, lfoRate: 4,    lfoDepth: 0,    lfoTarget: 'filter', lfoWaveform: 'sine' },
  // A high SUSTAINED DRONE tone: a saw that swells in (slow attack), holds
  // DEAD-FLAT forever (sustain 1 / no decay), and lingers on release. A little
  // detune keeps it alive/beating; a low lowpass keeps it dark. Hold one high
  // note under a track for tension/atmosphere.
  'Drone Tone':      { waveform: 'sawtooth', attack: 0.4,   decay: 0.0,  sustain: 1.0,  release: 1.0,  detune: 7,   filterType: 'lowpass', filterCutoff: 2400, filterResonance: 1.2, lfoEnabled: false, lfoRate: 4,    lfoDepth: 0,    lfoTarget: 'filter', lfoWaveform: 'sine' },
  'Acid Line':       { waveform: 'sawtooth', attack: 0.002, decay: 0.12, sustain: 0.25, release: 0.14, detune: 0,   filterType: 'lowpass', filterCutoff: 700,  filterResonance: 11,  lfoEnabled: true,  lfoRate: 2.2,  lfoDepth: 0.45, lfoTarget: 'filter', lfoWaveform: 'triangle' },
  'Wobble Bass':     { waveform: 'sawtooth', attack: 0.004, decay: 0.1,  sustain: 0.85, release: 0.14, detune: 8,   filterType: 'lowpass', filterCutoff: 640,  filterResonance: 7,   lfoEnabled: true,  lfoRate: 3.8,  lfoDepth: 0.55, lfoTarget: 'filter', lfoWaveform: 'sine' },
  'House Stab':      { waveform: 'sawtooth', attack: 0.003, decay: 0.09, sustain: 0.0,  release: 0.12, detune: 9,   filterType: 'lowpass', filterCutoff: 2600, filterResonance: 2.5, lfoEnabled: false, lfoRate: 4,    lfoDepth: 0,    lfoTarget: 'filter', lfoWaveform: 'sine' },
  'Hoover':          { waveform: 'sawtooth', attack: 0.02,  decay: 0.2,  sustain: 0.7,  release: 0.3,  detune: 0,   oscillators: [defaultOscLayer({ waveform: 'sawtooth', unison: 4, spread: 16 })], filterType: 'lowpass', filterCutoff: 1800, filterResonance: 3.5, lfoEnabled: true,  lfoRate: 5.5,  lfoDepth: 0.1,  lfoTarget: 'pitch',  lfoWaveform: 'sine' },
  'Chip Lead':       { waveform: 'square',   attack: 0.002, decay: 0.1,  sustain: 0.5,  release: 0.1,  detune: 0,   filterType: 'lowpass', filterCutoff: 6000, filterResonance: 0.7, lfoEnabled: false, lfoRate: 6,    lfoDepth: 0,    lfoTarget: 'pitch',  lfoWaveform: 'square' },
  'Detuned Lead':    { waveform: 'sawtooth', attack: 0.008, decay: 0.16, sustain: 0.65, release: 0.3,  detune: 14,  filterType: 'lowpass', filterCutoff: 3200, filterResonance: 2,   lfoEnabled: true,  lfoRate: 4.8,  lfoDepth: 0.1,  lfoTarget: 'pitch',  lfoWaveform: 'sine' },
  'Warm Keys':       { waveform: 'triangle', attack: 0.02,  decay: 0.4,  sustain: 0.65, release: 0.5,  detune: 3,   filterType: 'lowpass', filterCutoff: 2200, filterResonance: 1.2, lfoEnabled: false, lfoRate: 4,    lfoDepth: 0,    lfoTarget: 'filter', lfoWaveform: 'sine' },
  'Soft Pad':        { waveform: 'triangle', attack: 0.9,   decay: 0.7,  sustain: 0.75, release: 1.4,  detune: -12, filterType: 'lowpass', filterCutoff: 1400, filterResonance: 1.5, lfoEnabled: true,  lfoRate: 0.28, lfoDepth: 0.18, lfoTarget: 'filter', lfoWaveform: 'sine' },
  'Ambient Wash':    { waveform: 'sawtooth', attack: 1.6,   decay: 1.0,  sustain: 0.7,  release: 2.2,  detune: -7,  filterType: 'lowpass', filterCutoff: 1100, filterResonance: 2,   lfoEnabled: true,  lfoRate: 0.18, lfoDepth: 0.3,  lfoTarget: 'filter', lfoWaveform: 'triangle' },
  'Bell Pluck':      { waveform: 'triangle', attack: 0.001, decay: 0.5,  sustain: 0.0,  release: 0.4,  detune: 12,  filterType: 'lowpass', filterCutoff: 3600, filterResonance: 2,   lfoEnabled: false, lfoRate: 4,    lfoDepth: 0,    lfoTarget: 'filter', lfoWaveform: 'sine' },
  // ── Expanded library (2026-08-03) — more diverse starting points across
  // bass / lead / pad / pluck / key / arp. Principled recipes; tweak by ear. ──
  // Basses
  'Round Bass':      { waveform: 'triangle', attack: 0.004, decay: 0.14, sustain: 0.85, release: 0.16, detune: 0,   filterType: 'lowpass', filterCutoff: 500,  filterResonance: 1.5, lfoEnabled: false, lfoRate: 4,    lfoDepth: 0,    lfoTarget: 'filter', lfoWaveform: 'sine' },
  'Pluck Bass':      { waveform: 'sawtooth', attack: 0.002, decay: 0.16, sustain: 0.2,  release: 0.12, detune: 0,   filterType: 'lowpass', filterCutoff: 900,  filterResonance: 3,   lfoEnabled: false, lfoRate: 4,    lfoDepth: 0,    lfoTarget: 'filter', lfoWaveform: 'sine' },
  'Rubber Bass':     { waveform: 'sawtooth', attack: 0.004, decay: 0.12, sustain: 0.7,  release: 0.14, detune: 0,   filterType: 'lowpass', filterCutoff: 700,  filterResonance: 5,   lfoEnabled: true,  lfoRate: 0.9,  lfoDepth: 0.12, lfoTarget: 'filter', lfoWaveform: 'sine' },
  'Growl Bass':      { waveform: 'sawtooth', attack: 0.004, decay: 0.1,  sustain: 0.8,  release: 0.15, detune: 12,  oscillators: [defaultOscLayer({ waveform: 'sawtooth', unison: 3, spread: 14 })], filterType: 'lowpass', filterCutoff: 560, filterResonance: 8, lfoEnabled: true, lfoRate: 5.5, lfoDepth: 0.4, lfoTarget: 'filter', lfoWaveform: 'triangle' },
  'Warm Sub':        { waveform: 'sine',     attack: 0.006, decay: 0.1,  sustain: 0.95, release: 0.2,  detune: 0,   filterType: 'lowpass', filterCutoff: 320,  filterResonance: 0.7, lfoEnabled: false, lfoRate: 4,    lfoDepth: 0,    lfoTarget: 'filter', lfoWaveform: 'sine' },
  'Square Bass':     { waveform: 'square',   attack: 0.003, decay: 0.12, sustain: 0.75, release: 0.14, detune: 0,   filterType: 'lowpass', filterCutoff: 800,  filterResonance: 2,   lfoEnabled: false, lfoRate: 4,    lfoDepth: 0,    lfoTarget: 'filter', lfoWaveform: 'sine' },
  // Leads
  'Bright Saw Lead': { waveform: 'sawtooth', attack: 0.006, decay: 0.14, sustain: 0.7,  release: 0.24, detune: 6,   filterType: 'lowpass', filterCutoff: 5200, filterResonance: 1.6, lfoEnabled: false, lfoRate: 4,    lfoDepth: 0,    lfoTarget: 'pitch',  lfoWaveform: 'sine' },
  'Soft Sine Lead':  { waveform: 'sine',     attack: 0.02,  decay: 0.2,  sustain: 0.75, release: 0.4,  detune: 0,   filterType: 'lowpass', filterCutoff: 4000, filterResonance: 0.7, lfoEnabled: true,  lfoRate: 5,    lfoDepth: 0.06, lfoTarget: 'pitch',  lfoWaveform: 'sine' },
  'PWM Lead':        { waveform: 'square',   attack: 0.005, decay: 0.16, sustain: 0.65, release: 0.26, detune: 8,   filterType: 'lowpass', filterCutoff: 3200, filterResonance: 2.4, lfoEnabled: true,  lfoRate: 0.4,  lfoDepth: 0.3,  lfoTarget: 'filter', lfoWaveform: 'triangle' },
  'Fifth Lead':      { waveform: 'sawtooth', attack: 0.006, decay: 0.16, sustain: 0.68, release: 0.3,  detune: 0,   oscillators: [defaultOscLayer({ waveform: 'sawtooth' }), defaultOscLayer({ waveform: 'sawtooth', octave: 0, detune: 700, level: 0.5 })], filterType: 'lowpass', filterCutoff: 3400, filterResonance: 1.8, lfoEnabled: false, lfoRate: 4, lfoDepth: 0, lfoTarget: 'pitch', lfoWaveform: 'sine' },
  'Vintage Lead':    { waveform: 'triangle', attack: 0.01,  decay: 0.2,  sustain: 0.7,  release: 0.34, detune: 5,   filterType: 'lowpass', filterCutoff: 2600, filterResonance: 1.4, lfoEnabled: true,  lfoRate: 5.2,  lfoDepth: 0.1,  lfoTarget: 'pitch',  lfoWaveform: 'sine' },
  // Pads
  'Evolving Pad':    { waveform: 'sawtooth', attack: 1.4,   decay: 0.9,  sustain: 0.7,  release: 1.8,  detune: -9,  oscillators: [defaultOscLayer({ waveform: 'sawtooth', unison: 3, spread: 18 })], filterType: 'lowpass', filterCutoff: 1300, filterResonance: 2, lfoEnabled: true, lfoRate: 0.14, lfoDepth: 0.4, lfoTarget: 'filter', lfoWaveform: 'sine' },
  'String Pad':      { waveform: 'sawtooth', attack: 0.5,   decay: 0.6,  sustain: 0.8,  release: 0.9,  detune: -7,  oscillators: [defaultOscLayer({ waveform: 'sawtooth', unison: 4, spread: 12 })], filterType: 'lowpass', filterCutoff: 2600, filterResonance: 1, lfoEnabled: false, lfoRate: 4, lfoDepth: 0, lfoTarget: 'filter', lfoWaveform: 'sine' },
  'Dark Pad':        { waveform: 'triangle', attack: 1.0,   decay: 0.8,  sustain: 0.75, release: 1.6,  detune: -12, filterType: 'lowpass', filterCutoff: 800,  filterResonance: 1.8, lfoEnabled: true,  lfoRate: 0.2,  lfoDepth: 0.2,  lfoTarget: 'filter', lfoWaveform: 'sine' },
  'Shimmer Pad':     { waveform: 'triangle', attack: 0.9,   decay: 0.7,  sustain: 0.7,  release: 1.8,  detune: 7,   oscillators: [defaultOscLayer({ waveform: 'triangle' }), defaultOscLayer({ waveform: 'sine', octave: 1, level: 0.4 })], filterType: 'lowpass', filterCutoff: 3400, filterResonance: 0.8, lfoEnabled: true, lfoRate: 0.3, lfoDepth: 0.18, lfoTarget: 'amp', lfoWaveform: 'sine' },
  'Glass Pad':       { waveform: 'sine',     attack: 0.7,   decay: 0.6,  sustain: 0.65, release: 1.4,  detune: 4,   oscillators: [defaultOscLayer({ waveform: 'sine' }), defaultOscLayer({ waveform: 'triangle', octave: 1, detune: 6, level: 0.45 })], filterType: 'lowpass', filterCutoff: 5000, filterResonance: 0.7, lfoEnabled: false, lfoRate: 4, lfoDepth: 0, lfoTarget: 'filter', lfoWaveform: 'sine' },
  // Plucks / keys / mallets
  'Digital Pluck':   { waveform: 'square',   attack: 0.002, decay: 0.18, sustain: 0.0,  release: 0.16, detune: 6,   filterType: 'lowpass', filterCutoff: 3000, filterResonance: 3,   lfoEnabled: false, lfoRate: 4,    lfoDepth: 0,    lfoTarget: 'filter', lfoWaveform: 'sine' },
  'Soft Mallet':     { waveform: 'sine',     attack: 0.002, decay: 0.4,  sustain: 0.0,  release: 0.3,  detune: 0,   filterType: 'lowpass', filterCutoff: 2600, filterResonance: 1,   lfoEnabled: false, lfoRate: 4,    lfoDepth: 0,    lfoTarget: 'filter', lfoWaveform: 'sine' },
  'Music Box':       { waveform: 'triangle', attack: 0.001, decay: 0.7,  sustain: 0.0,  release: 0.5,  detune: 0,   oscillators: [defaultOscLayer({ waveform: 'triangle' }), defaultOscLayer({ waveform: 'sine', octave: 2, level: 0.3 })], filterType: 'lowpass', filterCutoff: 4200, filterResonance: 1.5, lfoEnabled: false, lfoRate: 4, lfoDepth: 0, lfoTarget: 'filter', lfoWaveform: 'sine' },
  'Harp Pluck':      { waveform: 'triangle', attack: 0.002, decay: 0.6,  sustain: 0.1,  release: 0.5,  detune: 3,   filterType: 'lowpass', filterCutoff: 3200, filterResonance: 1.2, lfoEnabled: false, lfoRate: 4,    lfoDepth: 0,    lfoTarget: 'filter', lfoWaveform: 'sine' },
  'Synth Keys':      { waveform: 'sawtooth', attack: 0.006, decay: 0.3,  sustain: 0.55, release: 0.4,  detune: 4,   filterType: 'lowpass', filterCutoff: 2400, filterResonance: 1.2, lfoEnabled: false, lfoRate: 4,    lfoDepth: 0,    lfoTarget: 'filter', lfoWaveform: 'sine' },
  'Toy Piano':       { waveform: 'square',   attack: 0.001, decay: 0.45, sustain: 0.0,  release: 0.35, detune: 0,   filterType: 'lowpass', filterCutoff: 3600, filterResonance: 1.6, lfoEnabled: false, lfoRate: 4,    lfoDepth: 0,    lfoTarget: 'filter', lfoWaveform: 'sine' },
  // Arps / sequences / character
  'Fast Arp':        { waveform: 'sawtooth', attack: 0.001, decay: 0.12, sustain: 0.0,  release: 0.1,  detune: 6,   filterType: 'lowpass', filterCutoff: 3400, filterResonance: 3.2, lfoEnabled: false, lfoRate: 4,    lfoDepth: 0,    lfoTarget: 'filter', lfoWaveform: 'sine' },
  'Gated Synth':     { waveform: 'sawtooth', attack: 0.001, decay: 0.06, sustain: 0.9,  release: 0.02, detune: 8,   oscillators: [defaultOscLayer({ waveform: 'sawtooth', unison: 3, spread: 12 })], filterType: 'lowpass', filterCutoff: 3000, filterResonance: 2, lfoEnabled: true, lfoRate: 8, lfoDepth: 0.5, lfoTarget: 'amp', lfoWaveform: 'square' },
  'Trance Pluck':    { waveform: 'sawtooth', attack: 0.002, decay: 0.2,  sustain: 0.0,  release: 0.18, detune: 10,  oscillators: [defaultOscLayer({ waveform: 'sawtooth', unison: 4, spread: 16 })], filterType: 'lowpass', filterCutoff: 3200, filterResonance: 3, lfoEnabled: false, lfoRate: 4, lfoDepth: 0, lfoTarget: 'filter', lfoWaveform: 'sine' },
  'Vox Synth':       { waveform: 'sawtooth', attack: 0.06,  decay: 0.3,  sustain: 0.7,  release: 0.5,  detune: 5,   filterType: 'bandpass', filterCutoff: 1200, filterResonance: 4,  lfoEnabled: true,  lfoRate: 5,    lfoDepth: 0.08, lfoTarget: 'pitch',  lfoWaveform: 'sine' },
  'Retro Square':    { waveform: 'square',   attack: 0.002, decay: 0.12, sustain: 0.6,  release: 0.12, detune: 0,   filterType: 'lowpass', filterCutoff: 5000, filterResonance: 0.7, lfoEnabled: false, lfoRate: 6,    lfoDepth: 0,    lfoTarget: 'pitch',  lfoWaveform: 'square' },
  'Wide Saw':        { waveform: 'sawtooth', attack: 0.01,  decay: 0.2,  sustain: 0.78, release: 0.4,  detune: 0,   oscillators: [defaultOscLayer({ waveform: 'sawtooth', unison: 5, spread: 28 })], filterType: 'lowpass', filterCutoff: 3800, filterResonance: 1.2, lfoEnabled: false, lfoRate: 4, lfoDepth: 0, lfoTarget: 'filter', lfoWaveform: 'sine' },
  'Detuned Stab':    { waveform: 'sawtooth', attack: 0.002, decay: 0.14, sustain: 0.0,  release: 0.14, detune: 12,  oscillators: [defaultOscLayer({ waveform: 'sawtooth', unison: 2, spread: 18 })], filterType: 'lowpass', filterCutoff: 2400, filterResonance: 2.6, lfoEnabled: false, lfoRate: 4, lfoDepth: 0, lfoTarget: 'filter', lfoWaveform: 'sine' },
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
  startBeat: number
  durationBeats: number
  row?: number
  // ── Effect-bar model (current) ──────────────────────────────────────────
  // A bar exposes the sound-settings params (`fx`, the "full-on" target) and a
  // single automation `graph` (0..1 over the region). Every active param in
  // `fx` follows the graph together: 0 = neutral/off, 1 = the dialed-in value.
  // A bar with one active param is just a single-effect region.
  fx?: RollFx
  graph?: AutoPoint[]
  // ── Legacy single-effect model (migrated to a bar on load) ──────────────
  type?: ClipEffectType
  params?: {
    gain?: number; reverbWet?: number; reverbDecay?: number
    delayTime?: number; feedback?: number; delayWet?: number
    frequency?: number; filterType?: BiquadFilterType; filterQ?: number
    tremoloRate?: number; tremoloDepth?: number; distortion?: number
    semitones?: number; shapeEnvelope?: number[]; shapeSampleRate?: number
  }
  automation?: {
    param: string
    points: AutoPoint[]
  }
}

/** A ClipEffect is a "bar" once it carries an `fx` target bag. */
export function isEffectBar(e: ClipEffect): boolean {
  return !!e.fx
}

/** Per-clip "FX Motion": the chosen effects (`fx`, their full-on target) morph
 *  from neutral→target following one hand-drawn `graph` (0..1) across the clip.
 *  `graph.t` is NORMALIZED 0..1 (fraction of the clip) so it stretches on resize;
 *  the engine scales it to beats when scheduling. Reuses the effect-bar renderer. */
export interface ClipFxMotion {
  fx: RollFx
  graph: AutoPoint[]
  /** true = re-trigger the shape on EACH note (over the note's length); default
   *  false = one shape stretched across the whole clip. */
  perNote?: boolean
}

/** A single FX parameter drawn as a curve (0 = off, 1 = full effect) instead of a
 *  static slider value. `graph.t` is normalized 0..1 across the clip / note. */
export interface ClipParamGraph {
  graph: AutoPoint[]
  perNote?: boolean
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
  /** Ableton semantics: touching the control while automation is written
   *  OVERRIDES the lane — playback stops following the curve (and the lane
   *  draws grayed) until the user re-enables it. Purely a playback state;
   *  the points are never destroyed. */
  overridden?: boolean
  /**
   * How a point's 0–1 position maps onto min..max. Absent = linear.
   *
   * ⚠️ Frequency needs 'log' and the reason is audible, not theoretical. A
   * cutoff lane running linearly from 200 Hz to 18 kHz spends most of its
   * height above 8 kHz, where a low-pass on a pad does almost nothing — so a
   * drawn descent from the top only starts to be heard in the last tenth of
   * its travel, and reads as "the filter isn't doing anything". Same reason
   * the knob is log: an octave is a RATIO.
   */
  curve?: 'log'
}

// ── Tone EQ ───────────────────────────────────────────────────────────────────
// A simple 4-band tone control (all values in dB, -12..+12, 0 = flat).
// Applied per-track (DawTrack.tone) and per-MIDI-clip (MidiClip.rollFx).
// ── Modulation ────────────────────────────────────────────────────────────────
//
// A modulator is an LFO on a track that drives parameters through the same
// namespace automation uses ('volume', 'pan', 'fx:{effectId}:{key}',
// 'apollo:{path}', 'plugin:{id}', 'macro:N'). Automation is a shape along the
// song; a modulator is a shape that repeats. Evaluated every scheduler tick
// (lib/daw-modulation.ts) beside the automation lanes.

export type ModShape = 'sine' | 'triangle' | 'saw' | 'square' | 'random'

export interface ModRoute {
  id: string
  parameter: string
  /** Swing as a fraction of the parameter's range, −1..1. */
  amount: number
  /** Swing above the base only (0..amount) rather than around it. */
  unipolar?: boolean
  enabled?: boolean
}

export interface Modulator {
  id: string
  trackId: string
  name: string
  shape: ModShape
  rate: { kind: 'sync'; division: string } | { kind: 'hz'; hz: number }
  /** Scales every route, 0..1. */
  depth?: number
  /** Starting phase, 0..1 of a cycle. */
  phase?: number
  /** For 'random': the same song renders the same every time. */
  seed?: number
  enabled?: boolean
  routes: ModRoute[]
}

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
  /** 'group' = a folder/bus: no clips of its own; its children route through it
   *  so its volume/pan/mute/solo/effects apply to the whole group. Absent =
   *  a normal audio track. */
  kind?: 'group'
  color: string
  volume: number      // 0–1
  pan: number         // -1 to 1
  mute: boolean
  solo: boolean
  armed: boolean
  frozen?: boolean    // freeze: render to audio buffer, disable instrument
  inputSource?: string | null  // 'mic' | 'system' | null — audio input for recording
  height: number      // arrangement lane height in px
  /** Collapsed = a thin row. On a group it also hides (folds) its children. */
  collapsed?: boolean
  effects: TrackEffect[]
  midiEffects?: MidiEffect[]
  tone?: ToneParams   // per-track 4-band tone EQ (sub/bass/mid/treble)
  instrument: TrackInstrument
  groupId?: string    // parent group track id
  sendAmounts?: Record<string, number>  // returnTrackId → send level 0–1
  sendModes?: Record<string, 'pre' | 'post'>  // returnTrackId → pre/post fader
  crossfader?: CrossfaderSide
  /** false = force the legacy WebAudio FX path for this track (Helios FX is the default when the chain translates) */
  heliosFx?: boolean
  /** false = keep this track's legacy synth voices (Helios renders translatable poly/wavetable instruments by default) */
  heliosSynth?: boolean
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
  /** Live's Clip Activator. `false` = deactivated: kept in place, drawn
   *  dimmed, never played or rendered. Absent or `true` = active. "Deactivate,
   *  don't delete" is how an idea is parked while auditioning others. */
  active?: boolean
  startBeat: number
  durationBeats: number
  r2Key?: string
  audioUrl?: string
  /** Sound-library entry the audio came from (pad bounces) — lets the engine
   *  re-render/reload the sample after a project reload, when the session's
   *  blob: URL is long dead. */
  libraryId?: string
  /** Cross-project link: this audio clip renders ANOTHER project's full mix and
   *  re-syncs live when that project changes (studio audio→audio). The blob URL
   *  is transient, so on reload the mix is re-rendered from the source. */
  dawMixSourceProjectId?: string
  dawMixStamp?: string
  waveformPeaks?: number[]
  gain: number
  // Optional multi-point gain envelope drawn on the clip: points across the
  // clip (t = 0..1 of its length, g = linear gain multiplier ~0..2). When
  // present it rides on top of `gain` and the fades; absent = flat.
  gainPoints?: { t: number; g: number }[]
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
  /** Clip sound settings — the same bag the piano-roll "Sound" panel edits, so
   *  samples and MIDI clips share one menu. Applied to this clip's playback. */
  rollFx?: RollFx
  /** Drawn FX over the clip — same as MidiClip (a shared curve for chosen FX, or
   *  a per-parameter graph). Rendered as effect-bars over the audio. */
  fxMotion?: ClipFxMotion
  fxGraphs?: Partial<Record<keyof RollFx, ClipParamGraph>>
  /** Drawn volume automation across the clip (v 0..1). */
  volGraph?: AutoPoint[]
  color?: string
  launchQuantization?: LaunchQuantization
  followAction?: FollowAction
  followActionTime?: number  // beats after which follow action fires
}

// ── Piano-roll sound shaping (RollFx) ────────────────────────────────────────
// One flat bag of sound-shaping parameters, reused at three scopes that cascade
// preset → clip → note (each level overrides the one before, per key):
//   • MidiPreset.sound.fx  — the preset's own sound, applied to every note using it
//   • MidiClip.rollFx      — the "Sound" button, this clip only
//   • MidiNote.fx          — an individual note override
// Every field is optional; an absent field means "inherit". The engine builds a
// per-note chain from the resolved bag (see lib/roll-fx.ts + daw-engine).
export interface RollFx {
  // Envelope (amplitude, per note)
  attack?: number        // seconds 0–2 — fade in
  decay?: number         // seconds 0–2 — fall to sustain level after attack
  sustainLevel?: number  // 0–1 — level held after decay (1 = no dip)
  sustain?: number       // seconds 0–4 — release ramp past each note's end (a pedal)
  // Level & stereo
  gain?: number          // 0–2 output level (1 = unity)
  pan?: number           // -1..1
  width?: number         // 0–2 stereo width (1 = normal)
  tremoloDepth?: number  // 0–1 amplitude LFO
  tremoloRate?: number   // Hz 0.1–12
  autopanDepth?: number  // 0–1 pan LFO
  autopanRate?: number   // Hz 0.1–8
  // Filter
  highpassHz?: number    // highpass cutoff Hz; undefined or ≤20 = off
  filterHz?: number      // lowpass cutoff Hz; undefined or ≥17500 = off
  filterQ?: number       // lowpass resonance 0.1–12
  filterEnv?: number     // -1..1 — cutoff sweep over the attack (+ opens, − closes)
  filterLfoDepth?: number// 0–1 auto-wah depth
  filterLfoRate?: number // Hz 0.1–12
  // Drive & crush
  drive?: number         // 0–1 soft saturation
  distortion?: number    // 0–1 hard waveshape
  bitcrush?: number      // 0–1 bit-depth reduction
  // Pitch (applied to the source; sample-preset clips only)
  detune?: number        // cents -100..100
  vibratoDepth?: number  // 0–1 (→ ±cents)
  vibratoRate?: number   // Hz 0.1–12
  pitchEnv?: number      // semitones -24..24 — start offset that glides to target
  pitchEnvTime?: number  // seconds 0.01–1 — glide time
  // Space
  reverbWet?: number     // 0–1
  reverbSize?: number    // 0–1 decay length
  reverbPredelay?: number// seconds 0–0.2
  delayWet?: number      // 0–1
  delayTime?: number     // seconds 0.02–1
  delayFeedback?: number // 0–0.9
  delayPingpong?: number // 0–1 stereo spread
  chorusDepth?: number   // 0–1
  flanger?: number       // 0–1
  phaser?: number        // 0–1
  // Tone EQ (4-band, dB)
  sub?: number; bass?: number; mid?: number; treble?: number
  // Articulation (sampled-preset clips) — connected-note phrasing. Unset = the
  // instrument-family default (see lib/articulation.ts); 0 = off, 1 = on.
  legato?: number        // 0/1 — suppress re-attack across connected notes (bow/breath)
  slide?: number         // 0–1 portamento between connected notes at different pitches
}

// Parameters a pitch graph can drive (excludes rates/times & the pure release).
export type PitchGraphTarget =
  | 'gain' | 'pan' | 'width' | 'filterHz' | 'filterQ' | 'highpassHz' | 'filterEnv'
  | 'drive' | 'distortion' | 'bitcrush' | 'reverbWet' | 'delayWet' | 'delayPingpong'
  | 'chorusDepth' | 'flanger' | 'phaser' | 'tremoloDepth' | 'autopanDepth'
  | 'detune' | 'vibratoDepth' | 'sub' | 'bass' | 'mid' | 'treble'

export interface PitchGraphPoint { pitch: number; amount: number } // pitch 0–127, amount 0–1

// A curve mapping a note property → an effect amount, so different notes get a
// different amount of the same effect — e.g. tame brightness as pitch rises, or
// open the filter the harder you play. Lives on a preset's sound (per-effect).
// `source` picks the x-axis: note pitch (default) or note velocity. For a
// velocity graph the point's `pitch` field holds the velocity (0–127).
export interface PitchGraph {
  id: string
  target: PitchGraphTarget
  enabled: boolean
  source?: 'pitch' | 'velocity'
  points: PitchGraphPoint[]  // ≥2, sorted ascending by x
}

export interface PresetSound {
  fx?: RollFx
  pitchGraphs?: PitchGraph[]
}

export interface MidiNote {
  id: string
  pitch: number
  startBeat: number    // relative to clip startBeat
  durationBeats: number
  velocity: number     // 0–127
  presetId?: string    // MIDI preset active when this note was recorded
  /** Per-note sound override — wins over clip rollFx and preset sound. */
  fx?: RollFx
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
  /** Live's Clip Activator — see AudioClip.active. */
  active?: boolean
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
  /** Clip-local sound settings from the piano roll's "Sound" panel — applied
   *  to this clip's notes only, on top of the preset's own sound. See RollFx. */
  rollFx?: RollFx
  /** FX Motion: a hand-drawn curve (0..1 over the whole clip) that morphs one or
   *  more effects from neutral (0) to their dialed-in target (1) as the clip
   *  plays — e.g. a filter that closes over time. Rendered as an effect-bar. */
  fxMotion?: ClipFxMotion
  /** Per-parameter graphs: any single FX slider switched to "graph" mode draws
   *  its own curve (0 = off, top = full effect) over the clip / each note.
   *  Keyed by the RollFx field. Each renders as its own one-param effect-bar. */
  fxGraphs?: Partial<Record<keyof RollFx, ClipParamGraph>>
  /** Drawn amplitude envelope: a hand-drawn 0..1 volume shape applied per note
   *  (over the note's length, scaled by velocity), replacing the attack/decay/
   *  sustain sliders. `t` is normalized 0..1 across the note. */
  ampGraph?: AutoPoint[]
  /** Drawn pitch contour per note: v 0.5 = in tune, 1 = +12 st, 0 = −12 st.
   *  Scoops, falls, bends. `t` is normalized 0..1 across the note. */
  pitchGraph?: AutoPoint[]
  /** Custom LFO shape (one cycle, v 0.5 = centre) used by this clip's LFOs —
   *  tremolo, auto-pan, auto-wah, vibrato — instead of a sine. */
  lfoShape?: AutoPoint[]
  /** Drawn volume automation across the whole clip (v 0..1 = silent…full),
   *  multiplied on top of the notes. `t` normalized 0..1 over the clip. */
  volGraph?: AutoPoint[]
  /** Drawn groove: micro-timing per bar position (v 0.5 = on the grid, up =
   *  later / laid-back, down = earlier / pushed). One bar wide, repeats. */
  groove?: AutoPoint[]
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

/** If a collaborator has this clip open in an editor, returns their name — the
 *  clip is locked to everyone else. Null when nobody else is editing it. */
export function clipLockedBy(clipId: string | null | undefined, peers: CollabPeer[]): string | null {
  if (!clipId) return null
  const p = peers.find(pr => pr.editingClipId === clipId)
  return p ? (p.name || 'A collaborator') : null
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

/** One recorded step of a project's construction, for the History replay (the
 *  third capture method). `action` is a serialized DawAction — typed loosely
 *  here to avoid a dependency cycle with daw-state; cast to DawAction where the
 *  reducer is applied. A non-empty `label` marks a milestone: replay pauses
 *  there to play the song so far. */
export interface DawHistoryEntry {
  action: { type: string; [key: string]: unknown }
  label?: string
}

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
  /** LFOs on tracks, driving parameters every tick (see Modulator). */
  modulators?: Modulator[]
  /**
   * Delay compensation: every track is delayed to match the slowest one's
   * reported latency (lib/latency.ts), so a slow device does not put its
   * track behind the rest. Absent = on.
   */
  delayCompensation?: boolean
  clipEffects: ClipEffect[]
  returnTracks: ReturnTrack[]
  takeLanes: TakeLane[]
  crossfaderValue: number   // 0–1 (0=A, 0.5=center, 1=B)
  waveformZoom: number      // 1–8 vertical zoom multiplier for arrangement waveforms
  swing: number             // 0–1 (0 = straight, 0.5 = full swing)
  cueMarkers: CueMarker[]
  /** Tempo changes: playback switches BPM when the playhead crosses a marker. */
  tempoMarkers?: Array<{ id: string; beat: number; tempo: number }>
  /** Meter (time-signature) changes: the bar grid + snapping switch at each marker.
   *  Beat is grid-native (num beats per bar); den is notation/metronome only.
   *  Marker-free projects use the single global timeSignatureNum/Den. */
  meterMarkers?: Array<{ id: string; beat: number; num: number; den: number }>
  /** Arranger sections: each runs from its beat to the next section (or the end). */
  sections?: Array<{ id: string; beat: number; name: string; color: string }>
  /** Timeline comments: beat-anchored feedback threads from collaborators. */
  comments?: TimelineComment[]
  key: number               // 0-11 (C=0), displayed in transport
  scale: string             // 'major' | 'minor' | etc.
  /** Community item id this project was opened FROM (a shared starter). Carried
   *  so that re-sharing records remix lineage. Set on ?starter= load. */
  remixedFrom?: string
  /** Ordered construction log for the History capture/replay mode — folded from
   *  empty through the reducer to re-play how the project was built. */
  history?: DawHistoryEntry[]
  /** Custom MIDI-instrument presets that live IN the project, so a clip using a
   *  user-made sound stays intact when the .cfproj is opened on another device
   *  (built-in presets are always available; user presets otherwise live only in
   *  the author's localStorage). Resolved ahead of the local library. */
  presets?: MidiPreset[]
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
export const COLLAPSED_TRACK_HEIGHT = 24
export const GROUP_TRACK_HEIGHT = 34

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
