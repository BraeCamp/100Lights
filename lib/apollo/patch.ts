// Apollo — the 100Lights hybrid synth (Helios engine). Patch schema + parameter registry.
// The patch is one JSON document; the engine worklet consumes it whole.

export type OscEngine = 'wavetable' | 'sample' | 'multisample' | 'granular' | 'spectral'
export type UnisonMode = 'classic' | 'harmonic' | 'ratio' | 'semitone' | 'step'
export type WarpMode =
  | 'off' | 'sync' | 'bendPlus' | 'bendMinus' | 'bendBoth' | 'pwm' | 'asym'
  | 'flip' | 'mirror' | 'quantize' | 'squeeze' | 'fm' | 'am' | 'rm' | 'pd'
  | 'remap' | 'shift' | 'saturate'
export type LoopMode = 'off' | 'loop' | 'pingpong' | 'tails'
export type FilterRouting = 'serial' | 'parallel'
export type SourceDest = 'f1' | 'f2' | 'both' | 'bypass'
export type BusDest = 'main' | 'bus1' | 'bus2' | 'direct'

export type FilterType =
  // Clean digital
  | 'lp6' | 'lp12' | 'lp18' | 'lp24' | 'hp6' | 'hp12' | 'hp24' | 'bp12' | 'bp24'
  | 'notch12' | 'peak12'
  // Multi / morph
  | 'multiLBH' | 'multiLNH' | 'morphSVF'
  // Analog
  | 'ladder12' | 'ladder24' | 'germanLP' | 'frenchLP'
  // Formant
  | 'formant'
  // Flanges
  | 'combPlus' | 'combMinus' | 'flangePlus' | 'flangeMinus' | 'phasePlus' | 'phaseMinus'
  // Misc
  | 'ringMod' | 'sampHold' | 'downsample' | 'reverbFilter' | 'dj' | 'diffuser'

export interface WarpSlot { mode: WarpMode; amount: number /* 0..1 */ }

/** Harmonic-domain warp applied to the current wavetable frame (Vital-style). */
export type SpecWarpMode = 'off' | 'stretch' | 'shift' | 'smear' | 'lowpass' | 'evenodd' | 'inharm'
export interface SpecWarpSlot { mode: SpecWarpMode; amount: number /* 0..1 */ }

export interface WavetableParams {
  tableId: string
  pos: number // 0..1 frame morph
  interp: 'smooth' | 'crossfade' | 'off'
  warp1: WarpSlot
  warp2: WarpSlot
  fmSource: 0 | 1 | 2 // osc index used by fm/am/rm warps
  remapCurve: LfoPoint[] | null // phase remap curve for the 'remap' warp mode
  /** Optional (older patches lack it): spectral warp — operates on harmonics. */
  specWarp?: SpecWarpSlot
}

export interface SliceInfo { pos: number /* 0..1 */ }

export interface SampleParams {
  sampleId: string | null
  start: number; end: number // 0..1
  loopMode: LoopMode
  loopStart: number; loopEnd: number // 0..1
  xfade: number // 0..1 of loop length
  rate: number // -2..2, 1 = normal; 0 = frozen; negative = reverse
  keytrack: boolean
  rootKey: number // MIDI note that plays at native rate when keytracking
  slices: SliceInfo[]
  sliceMap: 'off' | 'keys' // map slices chromatically from C1
  warp1: WarpSlot; warp2: WarpSlot
}

export interface GranularParams {
  sampleId: string | null
  density: number   // grains/sec 0.5..200 (audio-rate capable)
  length: number    // grain ms 1..500
  scan: number      // -2..2 playhead rate
  pos: number       // 0..1 playhead position
  spray: number     // 0..1 random offset
  direction: 'fwd' | 'rev' | 'alt'
  pitchRand: number // semitones 0..12
  panRand: number   // 0..1
  windowShape: number // 0..1 morph rect->hann->gauss
  windowSkew: number  // -1..1
  windowAmount: number // 0..1
  loopGrains: boolean
  manual: boolean   // playhead does not advance; pos knob scrubs
  keytrack: boolean
  rootKey: number
}

export interface SpectralParams {
  sampleId: string | null
  speed: number   // -2..2 playhead speed through analysis frames
  freeze: boolean
  pos: number     // 0..1
  smear: number   // 0..1 temporal magnitude smoothing
  shift: number   // -1..1 linear bin shift
  pitchShift: number // semitones -24..24 (bin scale)
  formant: number // semitones -12..12 spectral-envelope shift
  spread: number  // 0..1 harmonic spread
  gate: number    // 0..1 magnitude gate threshold
  filterCurve: number[] // 64 points, 0..1 gain over log-freq; drawable
  transients: number // 0..1 transient preservation
  keytrack: boolean
  rootKey: number
}

export interface MultisampleZone {
  sampleId: string
  loKey: number; hiKey: number
  loVel: number; hiVel: number
  rootKey: number
  tune: number // cents
  gain: number // dB
  loopMode: LoopMode
  loopStart: number; loopEnd: number
}

export interface MultisampleParams { name: string; zones: MultisampleZone[] }

export interface OscConfig {
  enabled: boolean
  engine: OscEngine
  level: number; pan: number
  octave: number; semi: number; fine: number // fine in cents
  unison: number // 1..16
  detune: number; blend: number; width: number // 0..1
  phase: number; rand: number // 0..1
  stereo: number // 0..1
  keytrackPitch: boolean // false = const pitch
  unisonMode: UnisonMode
  dest: SourceDest
  filterBal: number // 0 = all F1, 1 = all F2 (when dest === 'both')
  bus: BusDest
  wt: WavetableParams
  smp: SampleParams
  gran: GranularParams
  spec: SpectralParams
  ms: MultisampleParams
}

export interface SubConfig {
  enabled: boolean
  shape: 'sine' | 'triangle' | 'square' | 'saw'
  octave: number // -2..0
  level: number; pan: number
  direct: boolean // bypass filters + FX
  dest: SourceDest; filterBal: number; bus: BusDest
}

export interface NoiseConfig {
  enabled: boolean
  sampleId: string | null
  level: number; pan: number
  pitch: number // semitones -24..24
  keytrack: boolean
  oneShot: boolean
  phase: number; rand: number
  dest: SourceDest; filterBal: number; bus: BusDest
}

export interface FilterConfig {
  enabled: boolean
  type: FilterType
  cutoff: number  // 0..1 log-mapped 8Hz..20kHz
  res: number     // 0..1
  drive: number   // 0..1
  fat: number     // 0..1 — morph/vowel/extra per type
  mix: number     // 0..1 dry/wet
  pan: number     // -1..1 stereo cutoff offset
  keytrack: number // 0..1
  bus?: BusDest   // FX lane for this filter's output (serial mode: last enabled filter wins)
}

export interface EnvConfig {
  attack: number; hold: number; decay: number; sustain: number; release: number // secs, sustain 0..1
  aCurve: number; dCurve: number; rCurve: number // -1..1
  bpmSync: boolean
  legato: boolean
}

export interface LfoPoint { x: number; y: number; curve: number } // curve -1..1
export type LfoTrigMode = 'trig' | 'env' | 'off' | 'loopHold'
export type ChaosType = 'lorenz' | 'rossler' | 'sh'

export interface LfoConfig {
  mode: 'normal' | 'path' | 'chaos'
  points: LfoPoint[]
  pathPoints: { x: number; y: number; curve: number }[] // 2D path; outputs X and Y
  chaosType: ChaosType
  rate: number       // Hz when !sync (0.01..1000)
  sync: boolean
  syncRate: number   // index into SYNC_RATES
  trigMode: LfoTrigMode
  rise: number       // fade-in secs
  delay: number      // secs
  smooth: number     // 0..1
  swing: number      // 0..1 (sync only)
  gridX: number; gridY: number // editor snap, stored for UI
  bipolar: boolean
  phase: number      // 0..1 start phase at (re)trigger
}

export type ModSource =
  | 'env1' | 'env2' | 'env3' | 'env4'
  | 'lfo1' | 'lfo2' | 'lfo3' | 'lfo4' | 'lfo5' | 'lfo6' | 'lfo7' | 'lfo8' | 'lfo9' | 'lfo10'
  | 'lfo1y' | 'lfo2y' | 'lfo3y' | 'lfo4y' | 'lfo5y' | 'lfo6y' | 'lfo7y' | 'lfo8y' | 'lfo9y' | 'lfo10y'
  | 'vel' | 'note' | 'modwheel' | 'pitchwheel' | 'aftertouch' | 'rand' | 'gate' | 'follower'
  | 'macro1' | 'macro2' | 'macro3' | 'macro4' | 'macro5' | 'macro6' | 'macro7' | 'macro8'
  | 'none'

export interface ModRoute {
  id: string
  source: ModSource
  dest: string        // param path from PARAMS registry
  amount: number      // -1..1
  bipolar: boolean
  aux: ModSource      // scales amount
  auxAmount: number   // 0..1
  curve: LfoPoint[] | null // remap curve; null = linear
  bypass: boolean
}

export type FxType =
  | 'hyper' | 'distortion' | 'echobode' | 'chorus' | 'flanger' | 'phaser'
  | 'delay' | 'compressor' | 'convolve' | 'reverb' | 'eq' | 'filter'
  | 'utility' | 'octaver' | 'bitcrush'
  | 'splitLH' | 'splitLMH' | 'splitMS'

export interface FxUnit {
  id: string
  type: FxType
  enabled: boolean
  mix: number
  params: Record<string, number>
  // splitter children
  chains?: FxUnit[][]
}

export interface ArpConfig {
  on: boolean
  mode: 'up' | 'down' | 'updown' | 'downup' | 'converge' | 'diverge' | 'random' | 'asplayed' | 'pattern'
  octaves: number // 1..4
  syncRate: number
  gate: number    // 0..2
  swing: number
  hold: boolean
  transpose: number
  pattern: { step: number; on: boolean; vel: number }[] // step = chord-note index offset
  scaleLock: boolean
}

export interface ClipNote { start: number; len: number; note: number; vel: number; chance: number }
export interface ClipAutoPoint { x: number; y: number }
export interface ClipConfig {
  id: string
  name: string
  lengthBeats: number
  notes: ClipNote[]
  automation: { param: string; points: ClipAutoPoint[] }[]
}

export interface GlobalConfig {
  poly: number // max voices 1..32
  mode: 'poly' | 'mono' | 'legato'
  glide: number // secs
  glideLegatoOnly: boolean
  pbRange: number // semitones
  masterGain: number // 0..1
  bpm: number
  quality: 'draft' | 'good' | 'high' // high = 2x oversample
  voiceSpreadPan: number; voiceSpreadTune: number; voiceSpreadCutoff: number
  scaleRoot: number // 0..11
  scaleName: string
  scaleLock: boolean
  masterTune: number // cents
  tuning: { name: string; freqs: number[] } | null // microtuning table (.scl/.tun)
  /** Optional: envelope-follower mod source (tracks the master output level). */
  follower?: { attack: number; release: number; gain: number }
}

export interface ApolloPatch {
  version: 1
  name: string
  author: string
  tags: string[]
  global: GlobalConfig
  oscs: [OscConfig, OscConfig, OscConfig]
  sub: SubConfig
  noise: NoiseConfig
  filters: [FilterConfig, FilterConfig]
  filterRouting: FilterRouting
  envs: [EnvConfig, EnvConfig, EnvConfig, EnvConfig]
  lfos: LfoConfig[] // 10
  macros: number[]  // 8, 0..1
  macroNames: string[]
  matrix: ModRoute[]
  fxMain: FxUnit[]
  fxBus1: FxUnit[]
  fxBus2: FxUnit[]
  bus1Return: number
  bus2Return: number
  arp: ArpConfig
  clips: ClipConfig[]
  activeClip: number // -1 = none
  clipMode: boolean
  // custom wavetables edited/imported by the user, base64 float32 frames of 2048
  userTables: Record<string, { name: string; frames: number; data: string }>
}

export const SYNC_RATES = [
  { label: '8 bars', beats: 32 }, { label: '4 bars', beats: 16 }, { label: '2 bars', beats: 8 },
  { label: '1 bar', beats: 4 }, { label: '1/2', beats: 2 }, { label: '1/2T', beats: 4 / 3 },
  { label: '1/4D', beats: 1.5 }, { label: '1/4', beats: 1 }, { label: '1/4T', beats: 2 / 3 },
  { label: '1/8D', beats: 0.75 }, { label: '1/8', beats: 0.5 }, { label: '1/8T', beats: 1 / 3 },
  { label: '1/16D', beats: 0.375 }, { label: '1/16', beats: 0.25 }, { label: '1/16T', beats: 1 / 6 },
  { label: '1/32', beats: 0.125 }, { label: '1/64', beats: 0.0625 },
]

export const SCALES: Record<string, number[]> = {
  Major: [0, 2, 4, 5, 7, 9, 11], Minor: [0, 2, 3, 5, 7, 8, 10],
  Dorian: [0, 2, 3, 5, 7, 9, 10], Phrygian: [0, 1, 3, 5, 7, 8, 10],
  Lydian: [0, 2, 4, 6, 7, 9, 11], Mixolydian: [0, 2, 4, 5, 7, 9, 10],
  'Harmonic Minor': [0, 2, 3, 5, 7, 8, 11], 'Melodic Minor': [0, 2, 3, 5, 7, 9, 11],
  'Pentatonic Maj': [0, 2, 4, 7, 9], 'Pentatonic Min': [0, 3, 5, 7, 10],
  Blues: [0, 3, 5, 6, 7, 10], Chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
}

// ---------------------------------------------------------------------------
// Parameter registry: every modulatable knob. Path strings double as mod
// destinations. per-voice params are modulated inside the voice loop.

export interface ParamDef {
  path: string
  label: string
  min: number; max: number; default: number
  curve?: 'log' | 'lin'
  perVoice?: boolean
  unit?: string
}

const P = (path: string, label: string, min: number, max: number, def: number, perVoice = false, curve: 'log' | 'lin' = 'lin', unit = ''): ParamDef =>
  ({ path, label, min, max, default: def, perVoice, curve, unit })

function oscParams(i: number): ParamDef[] {
  const o = `osc${i}`
  return [
    P(`${o}.level`, `Osc ${'ABC'[i]} Level`, 0, 1, 0.75, true),
    P(`${o}.pan`, `Osc ${'ABC'[i]} Pan`, -1, 1, 0, true),
    P(`${o}.fine`, `Osc ${'ABC'[i]} Fine`, -100, 100, 0, true, 'lin', 'ct'),
    P(`${o}.semi`, `Osc ${'ABC'[i]} Semi`, -36, 36, 0, true, 'lin', 'st'),
    P(`${o}.detune`, `Osc ${'ABC'[i]} Detune`, 0, 1, 0.15, true),
    P(`${o}.blend`, `Osc ${'ABC'[i]} Blend`, 0, 1, 0.5, true),
    P(`${o}.width`, `Osc ${'ABC'[i]} Width`, 0, 1, 1, true),
    P(`${o}.phase`, `Osc ${'ABC'[i]} Phase`, 0, 1, 0, true),
    P(`${o}.wt.pos`, `Osc ${'ABC'[i]} WT Pos`, 0, 1, 0, true),
    P(`${o}.wt.warp1.amount`, `Osc ${'ABC'[i]} Warp 1`, 0, 1, 0, true),
    P(`${o}.wt.warp2.amount`, `Osc ${'ABC'[i]} Warp 2`, 0, 1, 0, true),
    P(`${o}.smp.rate`, `Osc ${'ABC'[i]} Smp Rate`, -2, 2, 1, true),
    P(`${o}.smp.warp1.amount`, `Osc ${'ABC'[i]} Smp Warp 1`, 0, 1, 0, true),
    P(`${o}.smp.warp2.amount`, `Osc ${'ABC'[i]} Smp Warp 2`, 0, 1, 0, true),
    P(`${o}.wt.specWarp.amount`, `Osc ${'ABC'[i]} Spectral Warp`, 0, 1, 0, true),
    P(`${o}.smp.start`, `Osc ${'ABC'[i]} Smp Start`, 0, 1, 0, true),
    P(`${o}.smp.loopStart`, `Osc ${'ABC'[i]} Loop Start`, 0, 1, 0, true),
    P(`${o}.smp.loopEnd`, `Osc ${'ABC'[i]} Loop End`, 0, 1, 1, true),
    P(`${o}.gran.density`, `Osc ${'ABC'[i]} Grain Density`, 0.5, 200, 20, true, 'log'),
    P(`${o}.gran.length`, `Osc ${'ABC'[i]} Grain Length`, 1, 500, 80, true, 'log', 'ms'),
    P(`${o}.gran.scan`, `Osc ${'ABC'[i]} Grain Scan`, -2, 2, 1, true),
    P(`${o}.gran.pos`, `Osc ${'ABC'[i]} Grain Pos`, 0, 1, 0, true),
    P(`${o}.gran.spray`, `Osc ${'ABC'[i]} Spray`, 0, 1, 0.05, true),
    P(`${o}.gran.pitchRand`, `Osc ${'ABC'[i]} Pitch Rand`, 0, 12, 0, true),
    P(`${o}.gran.panRand`, `Osc ${'ABC'[i]} Pan Rand`, 0, 1, 0.3, true),
    P(`${o}.gran.windowShape`, `Osc ${'ABC'[i]} Window`, 0, 1, 0.5, true),
    P(`${o}.spec.speed`, `Osc ${'ABC'[i]} Spec Speed`, -2, 2, 1, true),
    P(`${o}.spec.pos`, `Osc ${'ABC'[i]} Spec Pos`, 0, 1, 0, true),
    P(`${o}.spec.smear`, `Osc ${'ABC'[i]} Smear`, 0, 1, 0, true),
    P(`${o}.spec.shift`, `Osc ${'ABC'[i]} Spec Shift`, -1, 1, 0, true),
    P(`${o}.spec.pitchShift`, `Osc ${'ABC'[i]} Spec Pitch`, -24, 24, 0, true),
    P(`${o}.spec.formant`, `Osc ${'ABC'[i]} Formant`, -12, 12, 0, true),
    P(`${o}.spec.spread`, `Osc ${'ABC'[i]} Spread`, 0, 1, 0, true),
    P(`${o}.spec.gate`, `Osc ${'ABC'[i]} Spec Gate`, 0, 1, 0, true),
  ]
}

export const PARAMS: ParamDef[] = [
  ...oscParams(0), ...oscParams(1), ...oscParams(2),
  P('sub.level', 'Sub Level', 0, 1, 0.5, true),
  P('sub.pan', 'Sub Pan', -1, 1, 0, true),
  P('noise.level', 'Noise Level', 0, 1, 0.5, true),
  P('noise.pan', 'Noise Pan', -1, 1, 0, true),
  P('noise.pitch', 'Noise Pitch', -24, 24, 0, true),
  P('f1.cutoff', 'Filter 1 Cutoff', 0, 1, 0.8, true),
  P('f1.res', 'Filter 1 Res', 0, 1, 0.15, true),
  P('f1.drive', 'Filter 1 Drive', 0, 1, 0, true),
  P('f1.fat', 'Filter 1 Fat/Morph', 0, 1, 0.5, true),
  P('f1.mix', 'Filter 1 Mix', 0, 1, 1, true),
  P('f1.pan', 'Filter 1 Pan', -1, 1, 0, true),
  P('f2.cutoff', 'Filter 2 Cutoff', 0, 1, 0.8, true),
  P('f2.res', 'Filter 2 Res', 0, 1, 0.15, true),
  P('f2.drive', 'Filter 2 Drive', 0, 1, 0, true),
  P('f2.fat', 'Filter 2 Fat/Morph', 0, 1, 0.5, true),
  P('f2.mix', 'Filter 2 Mix', 0, 1, 1, true),
  P('f2.pan', 'Filter 2 Pan', -1, 1, 0, true),
  P('global.masterGain', 'Master', 0, 1, 0.8),
  P('global.glide', 'Glide', 0, 2, 0, false, 'log', 's'),
  P('bus1Return', 'Bus 1 Return', 0, 1, 1),
  P('bus2Return', 'Bus 2 Return', 0, 1, 1),
  ...Array.from({ length: 8 }, (_, i) => P(`macro${i + 1}`, `Macro ${i + 1}`, 0, 1, 0)),
  // env/lfo params (modulating these affects new voices / next cycle)
  ...[0, 1, 2, 3].flatMap(i => [
    P(`env${i + 1}.attack`, `Env ${i + 1} Attack`, 0, 20, i === 0 ? 0.002 : 0.01, false, 'log', 's'),
    P(`env${i + 1}.decay`, `Env ${i + 1} Decay`, 0, 20, 0.6, false, 'log', 's'),
    P(`env${i + 1}.sustain`, `Env ${i + 1} Sustain`, 0, 1, i === 0 ? 0.8 : 0),
    P(`env${i + 1}.release`, `Env ${i + 1} Release`, 0.001, 20, 0.15, false, 'log', 's'),
  ]),
  ...Array.from({ length: 10 }, (_, i) => P(`lfo${i + 1}.rate`, `LFO ${i + 1} Rate`, 0.01, 1000, 2, false, 'log', 'Hz')),
]

export const PARAM_MAP: Record<string, ParamDef> = Object.fromEntries(PARAMS.map(p => [p.path, p]))

// FX param defs are dynamic (per unit); mod dest path: `fx.<lane>.<unitId>.<param>`
export const FX_DEFS: Record<FxType, { label: string; params: { key: string; label: string; min: number; max: number; default: number; curve?: 'log' | 'lin' }[] }> = {
  hyper: { label: 'Hyper/Dimension', params: [
    { key: 'rate', label: 'Rate', min: 0.01, max: 10, default: 0.6, curve: 'log' },
    { key: 'detune', label: 'Detune', min: 0, max: 1, default: 0.35 },
    { key: 'unison', label: 'Unison', min: 1, max: 7, default: 4 },
    { key: 'retrig', label: 'Retrig', min: 0, max: 1, default: 0 },
    { key: 'dimSize', label: 'Dim Size', min: 0, max: 1, default: 0.4 },
    { key: 'dimMix', label: 'Dim Mix', min: 0, max: 1, default: 0.3 },
  ]},
  distortion: { label: 'Distortion', params: [
    { key: 'mode', label: 'Mode', min: 0, max: 11, default: 0 },
    { key: 'drive', label: 'Drive', min: 0, max: 1, default: 0.3 },
    { key: 'bias', label: 'DC Bias', min: -1, max: 1, default: 0 },
    { key: 'filterPos', label: 'Filt Pos', min: 0, max: 2, default: 0 }, // off/pre/post
    { key: 'filterType', label: 'Filt Type', min: 0, max: 2, default: 0 }, // lp/bp/hp
    { key: 'cutoff', label: 'Cutoff', min: 0, max: 1, default: 0.7 },
    { key: 'res', label: 'Res', min: 0, max: 1, default: 0.2 },
  ]},
  echobode: { label: 'Echobode', params: [
    { key: 'shift', label: 'Shift', min: -1000, max: 1000, default: 120 },
    { key: 'time', label: 'Time', min: 0, max: 15, default: 7 }, // SYNC_RATES index
    { key: 'sync', label: 'Sync', min: 0, max: 1, default: 1 },
    { key: 'feedback', label: 'Feedback', min: 0, max: 1, default: 0.5 },
    { key: 'diffusion', label: 'Diffusion', min: 0, max: 1, default: 0.3 },
    { key: 'lfoRate', label: 'LFO Rate', min: 0.01, max: 10, default: 0.3, curve: 'log' },
    { key: 'lfoAmt', label: 'LFO Amt', min: 0, max: 1, default: 0 },
  ]},
  chorus: { label: 'Chorus', params: [
    { key: 'rate', label: 'Rate', min: 0.01, max: 10, default: 0.4, curve: 'log' },
    { key: 'depth', label: 'Depth', min: 0, max: 1, default: 0.4 },
    { key: 'delay', label: 'Delay', min: 1, max: 30, default: 8 },
    { key: 'feedback', label: 'Feedback', min: 0, max: 0.95, default: 0.2 },
    { key: 'lpf', label: 'LPF', min: 0, max: 1, default: 0.8 },
    { key: 'voices', label: 'Voices', min: 2, max: 4, default: 2 },
  ]},
  flanger: { label: 'Flanger', params: [
    { key: 'rate', label: 'Rate', min: 0.01, max: 10, default: 0.25, curve: 'log' },
    { key: 'depth', label: 'Depth', min: 0, max: 1, default: 0.6 },
    { key: 'feedback', label: 'Feedback', min: 0, max: 0.97, default: 0.6 },
    { key: 'phase', label: 'L/R Phase', min: 0, max: 180, default: 90 },
    { key: 'center', label: 'Center', min: 0, max: 1, default: 0.3 },
  ]},
  phaser: { label: 'Phaser', params: [
    { key: 'rate', label: 'Rate', min: 0.01, max: 10, default: 0.3, curve: 'log' },
    { key: 'depth', label: 'Depth', min: 0, max: 1, default: 0.6 },
    { key: 'freq', label: 'Freq', min: 0, max: 1, default: 0.5 },
    { key: 'feedback', label: 'Feedback', min: 0, max: 0.95, default: 0.5 },
    { key: 'stages', label: 'Stages', min: 2, max: 12, default: 6 },
    { key: 'phase', label: 'L/R Phase', min: 0, max: 180, default: 45 },
  ]},
  delay: { label: 'Delay', params: [
    { key: 'timeL', label: 'Time L', min: 0, max: 16, default: 9 }, // SYNC_RATES idx
    { key: 'timeR', label: 'Time R', min: 0, max: 16, default: 9 },
    { key: 'sync', label: 'Sync', min: 0, max: 1, default: 1 },
    { key: 'freeMs', label: 'Free ms', min: 1, max: 2000, default: 350, curve: 'log' },
    { key: 'feedback', label: 'Feedback', min: 0, max: 1.1, default: 0.4 },
    { key: 'pingpong', label: 'PingPong', min: 0, max: 1, default: 0 },
    { key: 'lpf', label: 'LPF', min: 0, max: 1, default: 0.75 },
    { key: 'hpf', label: 'HPF', min: 0, max: 1, default: 0.1 },
    { key: 'tape', label: 'Tape', min: 0, max: 1, default: 0 },
  ]},
  compressor: { label: 'Compressor', params: [
    { key: 'threshold', label: 'Thresh', min: -60, max: 0, default: -18 },
    { key: 'ratio', label: 'Ratio', min: 1, max: 20, default: 4 },
    { key: 'attack', label: 'Attack', min: 0.1, max: 200, default: 10, curve: 'log' },
    { key: 'release', label: 'Release', min: 10, max: 2000, default: 120, curve: 'log' },
    { key: 'makeup', label: 'Makeup', min: 0, max: 24, default: 0 },
    { key: 'upward', label: 'Upward', min: 0, max: 1, default: 0 },
    { key: 'multiband', label: 'Multiband', min: 0, max: 1, default: 0 },
    { key: 'loFreq', label: 'Lo X', min: 0, max: 1, default: 0.25 },
    { key: 'hiFreq', label: 'Hi X', min: 0, max: 1, default: 0.7 },
  ]},
  convolve: { label: 'Convolve', params: [
    { key: 'ir', label: 'IR', min: 0, max: 7, default: 0 },
    { key: 'size', label: 'Size', min: 0.1, max: 1, default: 0.7 },
    { key: 'predelay', label: 'Predelay', min: 0, max: 200, default: 0 },
    { key: 'damp', label: 'Damp', min: 0, max: 1, default: 0.3 },
    { key: 'width', label: 'Width', min: 0, max: 1, default: 1 },
  ]},
  reverb: { label: 'Reverb', params: [
    { key: 'mode', label: 'Mode', min: 0, max: 4, default: 0 }, // hall/plate/vintage/nitrous/basin
    { key: 'size', label: 'Size', min: 0, max: 1, default: 0.5 },
    { key: 'decay', label: 'Decay', min: 0, max: 1, default: 0.5 },
    { key: 'damp', label: 'Damp', min: 0, max: 1, default: 0.4 },
    { key: 'predelay', label: 'Predelay', min: 0, max: 200, default: 10 },
    { key: 'width', label: 'Width', min: 0, max: 1, default: 1 },
    { key: 'lowcut', label: 'Low Cut', min: 0, max: 1, default: 0.1 },
  ]},
  eq: { label: 'EQ', params: [
    { key: 'f1', label: 'Freq 1', min: 0, max: 1, default: 0.2 },
    { key: 'g1', label: 'Gain 1', min: -18, max: 18, default: 0 },
    { key: 'q1', label: 'Q 1', min: 0.2, max: 8, default: 0.8, curve: 'log' },
    { key: 't1', label: 'Type 1', min: 0, max: 2, default: 1 }, // shelf lo / peak / shelf hi
    { key: 'f2', label: 'Freq 2', min: 0, max: 1, default: 0.75 },
    { key: 'g2', label: 'Gain 2', min: -18, max: 18, default: 0 },
    { key: 'q2', label: 'Q 2', min: 0.2, max: 8, default: 0.8, curve: 'log' },
    { key: 't2', label: 'Type 2', min: 0, max: 2, default: 1 },
  ]},
  filter: { label: 'Filter', params: [
    { key: 'type', label: 'Type', min: 0, max: 27, default: 1 }, // FILTER_TYPES index
    { key: 'cutoff', label: 'Cutoff', min: 0, max: 1, default: 0.7 },
    { key: 'res', label: 'Res', min: 0, max: 1, default: 0.2 },
    { key: 'drive', label: 'Drive', min: 0, max: 1, default: 0 },
    { key: 'fat', label: 'Fat/Morph', min: 0, max: 1, default: 0.5 },
    { key: 'pan', label: 'Pan', min: -1, max: 1, default: 0 },
  ]},
  utility: { label: 'Utility', params: [
    { key: 'gain', label: 'Gain', min: -24, max: 24, default: 0 },
    { key: 'pan', label: 'Pan', min: -1, max: 1, default: 0 },
    { key: 'width', label: 'Width', min: 0, max: 2, default: 1 },
  ]},
  octaver: { label: 'Octaver', params: [
    { key: 'sub', label: '-1 Oct', min: 0, max: 1, default: 0.5 },
    { key: 'up', label: '+1 Oct', min: 0, max: 1, default: 0 },
    { key: 'dry', label: 'Dry', min: 0, max: 1, default: 1 },
  ]},
  bitcrush: { label: 'Bitcrush', params: [
    { key: 'bits', label: 'Bits', min: 1, max: 16, default: 8 },
    { key: 'downsample', label: 'Downsmp', min: 1, max: 64, default: 1, curve: 'log' },
  ]},
  splitLH: { label: 'Split Low/High', params: [ { key: 'xover', label: 'X-Over', min: 0, max: 1, default: 0.4 } ]},
  splitLMH: { label: 'Split L/M/H', params: [
    { key: 'xlo', label: 'X Low', min: 0, max: 1, default: 0.3 },
    { key: 'xhi', label: 'X High', min: 0, max: 1, default: 0.65 },
  ]},
  splitMS: { label: 'Split Mid/Side', params: [] },
}

export const FILTER_TYPES: { id: FilterType; label: string; group: string }[] = [
  { id: 'lp6', label: 'Low 6', group: 'Clean' }, { id: 'lp12', label: 'Low 12', group: 'Clean' },
  { id: 'lp18', label: 'Low 18', group: 'Clean' }, { id: 'lp24', label: 'Low 24', group: 'Clean' },
  { id: 'hp6', label: 'High 6', group: 'Clean' }, { id: 'hp12', label: 'High 12', group: 'Clean' },
  { id: 'hp24', label: 'High 24', group: 'Clean' }, { id: 'bp12', label: 'Band 12', group: 'Clean' },
  { id: 'bp24', label: 'Band 24', group: 'Clean' }, { id: 'notch12', label: 'Notch', group: 'Clean' },
  { id: 'peak12', label: 'Peak', group: 'Clean' },
  { id: 'multiLBH', label: 'Multi L/B/H', group: 'Multi' }, { id: 'multiLNH', label: 'Multi L/N/H', group: 'Multi' },
  { id: 'morphSVF', label: 'Morph SVF', group: 'Multi' },
  { id: 'ladder12', label: 'Ladder 12', group: 'Analog' }, { id: 'ladder24', label: 'Ladder 24', group: 'Analog' },
  { id: 'germanLP', label: 'German LP', group: 'Analog' }, { id: 'frenchLP', label: 'French LP', group: 'Analog' },
  { id: 'formant', label: 'Formant', group: 'Formant' },
  { id: 'combPlus', label: 'Comb +', group: 'Flanges' }, { id: 'combMinus', label: 'Comb −', group: 'Flanges' },
  { id: 'flangePlus', label: 'Flange +', group: 'Flanges' }, { id: 'flangeMinus', label: 'Flange −', group: 'Flanges' },
  { id: 'phasePlus', label: 'Phase +', group: 'Flanges' }, { id: 'phaseMinus', label: 'Phase −', group: 'Flanges' },
  { id: 'ringMod', label: 'Ring Mod', group: 'Misc' }, { id: 'sampHold', label: 'Samp/Hold', group: 'Misc' },
  { id: 'downsample', label: 'Downsample', group: 'Misc' }, { id: 'reverbFilter', label: 'Reverb', group: 'Misc' },
  { id: 'dj', label: 'DJ LP/HP', group: 'Misc' }, { id: 'diffuser', label: 'Diffuser', group: 'Misc' },
]

export const WARP_MODES: { id: WarpMode; label: string }[] = [
  { id: 'off', label: 'Off' }, { id: 'sync', label: 'Sync' },
  { id: 'bendPlus', label: 'Bend +' }, { id: 'bendMinus', label: 'Bend −' }, { id: 'bendBoth', label: 'Bend ±' },
  { id: 'pwm', label: 'PWM' }, { id: 'asym', label: 'Asym' }, { id: 'flip', label: 'Flip' },
  { id: 'mirror', label: 'Mirror' }, { id: 'quantize', label: 'Quantize' }, { id: 'squeeze', label: 'Squeeze' },
  { id: 'fm', label: 'FM' }, { id: 'am', label: 'AM' }, { id: 'rm', label: 'RM' },
  { id: 'pd', label: 'Phase Dist' }, { id: 'remap', label: 'Remap' }, { id: 'shift', label: 'Shift' },
  { id: 'saturate', label: 'Saturate' },
]

// ---------------------------------------------------------------------------

let idCounter = 0
export const uid = (): string => `u${Date.now().toString(36)}${(idCounter++).toString(36)}`

const defaultWarp = (): WarpSlot => ({ mode: 'off', amount: 0 })

export function defaultOsc(i: number): OscConfig {
  return {
    enabled: i === 0, engine: 'wavetable',
    level: 0.75, pan: 0, octave: 0, semi: 0, fine: 0,
    unison: 1, detune: 0.15, blend: 0.5, width: 1, phase: 0, rand: 1, stereo: 0.5,
    keytrackPitch: true, unisonMode: 'classic', dest: 'f1', filterBal: 0, bus: 'main',
    wt: { tableId: 'basic-shapes', pos: 0, interp: 'smooth', warp1: defaultWarp(), warp2: defaultWarp(), fmSource: (i + 1) % 3 as 0 | 1 | 2, remapCurve: null, specWarp: { mode: 'off', amount: 0 } },
    smp: { sampleId: null, start: 0, end: 1, loopMode: 'off', loopStart: 0.25, loopEnd: 0.75, xfade: 0.01, rate: 1, keytrack: true, rootKey: 60, slices: [], sliceMap: 'off', warp1: defaultWarp(), warp2: defaultWarp() },
    gran: { sampleId: null, density: 20, length: 80, scan: 1, pos: 0, spray: 0.05, direction: 'fwd', pitchRand: 0, panRand: 0.3, windowShape: 0.5, windowSkew: 0, windowAmount: 1, loopGrains: false, manual: false, keytrack: true, rootKey: 60 },
    spec: { sampleId: null, speed: 1, freeze: false, pos: 0, smear: 0, shift: 0, pitchShift: 0, formant: 0, spread: 0, gate: 0, filterCurve: Array(64).fill(1), transients: 0.5, keytrack: true, rootKey: 60 },
    ms: { name: '', zones: [] },
  }
}

export function defaultEnv(i: number): EnvConfig {
  return { attack: i === 0 ? 0.002 : 0.01, hold: 0, decay: 0.6, sustain: i === 0 ? 0.8 : 0, release: 0.15, aCurve: -0.4, dCurve: -0.5, rCurve: -0.5, bpmSync: false, legato: false }
}

export function defaultLfo(): LfoConfig {
  return {
    mode: 'normal',
    points: [{ x: 0, y: 1, curve: 0 }, { x: 0.5, y: 0, curve: 0 }, { x: 1, y: 1, curve: 0 }],
    pathPoints: [{ x: 0, y: 0.5, curve: 0 }, { x: 1, y: 0.5, curve: 0 }],
    chaosType: 'lorenz', rate: 2, sync: true, syncRate: 7, trigMode: 'trig',
    rise: 0, delay: 0, smooth: 0, swing: 0, gridX: 8, gridY: 8, bipolar: false, phase: 0,
  }
}

export function defaultFx(type: FxType): FxUnit {
  const def = FX_DEFS[type]
  const unit: FxUnit = {
    id: uid(), type, enabled: true, mix: type === 'reverb' || type === 'convolve' || type === 'delay' || type === 'echobode' ? 0.3 : 1,
    params: Object.fromEntries(def.params.map(p => [p.key, p.default])),
  }
  if (type === 'splitLH') unit.chains = [[], []]
  if (type === 'splitLMH') unit.chains = [[], [], []]
  if (type === 'splitMS') unit.chains = [[], []]
  return unit
}

export function initPatch(): ApolloPatch {
  return {
    version: 1, name: 'Init', author: '', tags: [],
    global: {
      poly: 16, mode: 'poly', glide: 0, glideLegatoOnly: true, pbRange: 2,
      masterGain: 0.8, bpm: 120, quality: 'good',
      voiceSpreadPan: 0, voiceSpreadTune: 0, voiceSpreadCutoff: 0,
      scaleRoot: 0, scaleName: 'Minor', scaleLock: false, masterTune: 0, tuning: null,
      follower: { attack: 10, release: 200, gain: 1 },
    },
    oscs: [defaultOsc(0), defaultOsc(1), defaultOsc(2)],
    sub: { enabled: false, shape: 'sine', octave: -1, level: 0.5, pan: 0, direct: false, dest: 'f1', filterBal: 0, bus: 'main' },
    noise: { enabled: false, sampleId: null, level: 0.5, pan: 0, pitch: 0, keytrack: false, oneShot: false, phase: 0, rand: 1, dest: 'f1', filterBal: 0, bus: 'main' },
    filters: [
      { enabled: false, type: 'lp12', cutoff: 0.8, res: 0.15, drive: 0, fat: 0.5, mix: 1, pan: 0, keytrack: 0, bus: 'main' },
      { enabled: false, type: 'lp12', cutoff: 0.8, res: 0.15, drive: 0, fat: 0.5, mix: 1, pan: 0, keytrack: 0, bus: 'main' },
    ],
    filterRouting: 'serial',
    envs: [defaultEnv(0), defaultEnv(1), defaultEnv(2), defaultEnv(3)],
    lfos: Array.from({ length: 10 }, defaultLfo),
    macros: Array(8).fill(0),
    macroNames: Array.from({ length: 8 }, (_, i) => `Macro ${i + 1}`),
    matrix: [],
    fxMain: [], fxBus1: [], fxBus2: [],
    bus1Return: 1, bus2Return: 1,
    arp: { on: false, mode: 'up', octaves: 1, syncRate: 10, gate: 0.8, swing: 0, hold: false, transpose: 0, pattern: Array.from({ length: 8 }, (_, i) => ({ step: i, on: true, vel: 1 })), scaleLock: false },
    clips: [], activeClip: -1, clipMode: false,
    userTables: {},
  }
}

export function getByPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj
  for (const part of path.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[part]
  }
  return cur
}

export function setByPath(obj: unknown, path: string, value: unknown): void {
  const parts = path.split('.')
  let cur: unknown = obj
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur == null || typeof cur !== 'object') return
    cur = (cur as Record<string, unknown>)[parts[i]]
  }
  if (cur != null && typeof cur === 'object') (cur as Record<string, unknown>)[parts[parts.length - 1]] = value
}

// osc0/osc1/osc2 map onto patch.oscs[i] — engine + UI both use this indirection
export function resolvePatchPath(path: string): string {
  const m = path.match(/^osc([012])\.(.*)$/)
  if (m) return `oscs.${m[1]}.${m[2]}`
  const f = path.match(/^f([12])\.(.*)$/)
  if (f) return `filters.${Number(f[1]) - 1}.${f[2]}`
  const e = path.match(/^env([1-4])\.(.*)$/)
  if (e) return `envs.${Number(e[1]) - 1}.${e[2]}`
  const l = path.match(/^lfo(\d+)\.(.*)$/)
  if (l) return `lfos.${Number(l[1]) - 1}.${l[2]}`
  const mac = path.match(/^macro([1-8])$/)
  if (mac) return `macros.${Number(mac[1]) - 1}`
  return path
}

export const MOD_SOURCES: { id: ModSource; label: string; group: string }[] = [
  ...[1, 2, 3, 4].map(i => ({ id: `env${i}` as ModSource, label: `Env ${i}`, group: 'Envelopes' })),
  ...Array.from({ length: 10 }, (_, i) => ({ id: `lfo${i + 1}` as ModSource, label: `LFO ${i + 1}`, group: 'LFOs' })),
  { id: 'vel', label: 'Velocity', group: 'Note' }, { id: 'note', label: 'Note (key)', group: 'Note' },
  { id: 'gate', label: 'Gate', group: 'Note' }, { id: 'rand', label: 'Random', group: 'Note' },
  { id: 'modwheel', label: 'Mod Wheel', group: 'MIDI' }, { id: 'pitchwheel', label: 'Pitch Wheel', group: 'MIDI' },
  { id: 'aftertouch', label: 'Aftertouch', group: 'MIDI' },
  { id: 'follower', label: 'Follower', group: 'Audio' },
  ...Array.from({ length: 8 }, (_, i) => ({ id: `macro${i + 1}` as ModSource, label: `Macro ${i + 1}`, group: 'Macros' })),
]
