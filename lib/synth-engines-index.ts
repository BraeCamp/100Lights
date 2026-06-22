/**
 * Shared entry point for both synthesizer engines.
 * Import from here to keep import paths consistent across BeatLab.
 */

export {
  playWavetableNote,
  generateWavetable,
  getFrameCoefficients,
  WAVETABLE_FRAMES,
  FRAME_SIZE,
  WAVETABLE_PRESETS,
  type WavetablePatch,
} from './wavetable-synth'

export {
  playFMNote,
  FM_ALGORITHMS,
  FM_PRESETS,
  type FMPatch,
  type FMOperator,
  type FMAlgorithm,
} from './fm-synth'
