// The list of effects you can add to a track, and what each one starts as.
//
// This lived inside DeviceChain.tsx, which is loaded dynamically to keep it out
// of the studio's first bundle. That was the right call for the panel and the
// wrong shape for the catalogue: the command palette wants to offer every effect
// by name — "reverb" is exactly what you type when you want a reverb — and
// importing it from DeviceChain would have dragged the whole panel back into the
// initial download, undoing load-time work done earlier this session.
//
// So the data lives here, in a module that pulls in nothing but type defaults,
// and both the panel and the palette read it.

import {
  defaultEq3, defaultCompressor, defaultReverb, defaultDelay, defaultFilter,
  defaultSaturator, defaultRedux, defaultAutoPan, defaultUtility, defaultLfo,
  defaultNoiseGate, defaultDeEsser, defaultChorus, defaultTransientShaper,
  defaultMultibandComp, defaultLimiter, defaultDynEq, defaultUnmask,
  type EffectType,
} from './daw-types'
import { defaultFx, type FxType } from './apollo/patch'

/**
 * Every effect that can be added, in the order the picker shows them.
 *
 * `fx` marks an Apollo-native device: type 'helios' with an Apollo FxUnit
 * carried in its params. See APOLLO_ADD_OPTIONS below for why only some of
 * Apollo's units are offered.
 */
export const ADD_OPTIONS: { type: EffectType; label: string; fx?: FxType }[] = [
  { type: 'eq3',            label: 'EQ3' },
  { type: 'compressor',     label: 'Compressor' },
  { type: 'reverb',         label: 'Reverb' },
  { type: 'delay',          label: 'Delay' },
  { type: 'filter',         label: 'Filter' },
  { type: 'saturator',      label: 'Saturator' },
  { type: 'redux',          label: 'Redux (Bit Crush)' },
  { type: 'autopan',        label: 'Auto Pan' },
  { type: 'utility',        label: 'Utility' },
  { type: 'lfo',            label: 'LFO' },
  { type: 'noisegate',      label: 'Noise Gate' },
  { type: 'deesser',        label: 'De-esser' },
  { type: 'chorus',         label: 'Chorus/Flanger' },
  { type: 'transientshaper',label: 'Transient Shaper' },
  { type: 'multibandcomp',  label: 'Multiband Comp' },
  { type: 'limiter',        label: 'Limiter' },
  { type: 'dyneq',          label: 'Dynamic EQ' },
  { type: 'unmask',         label: 'Unmask (duck under another track)' },
]

/**
 * Apollo's effects, addable as ordinary devices.
 *
 * Brae: "let's add the Apollo effects to the device chain in whatever way you
 * recommend."
 *
 * The recommendation, and why it is this shape:
 *
 * The bridge in lib/apollo/daw-fx.ts already renders a Beacon chain through
 * Apollo's engine, and a 'helios' device type already exists there to carry an
 * Apollo unit verbatim. What was missing was any way to ADD one — the wrapper
 * could only be created by round-tripping a chain through the Apollo Rack card.
 * So this is not a second effect system bolted on; it is the existing one given
 * a front door.
 *
 * ⚠️ Only the units Beacon has no equivalent for are listed. Apollo also has a
 * reverb, a delay, an EQ, a filter and a compressor — but Beacon's own reverb
 * ALREADY TRANSLATES to Apollo's reverb when the chain runs on Helios, so
 * offering both would put two entries in the menu that produce the same DSP and
 * differ only in which knobs you get. A menu that asks people to choose between
 * "Reverb" and "Reverb" is worse than one that doesn't.
 *
 * ⚠️ The three splitters (splitLH / splitLMH / splitMS) are deliberately absent.
 * They host CHILD chains — a unit whose real content is other units — and a
 * device card has nowhere to put a nested chain. They translate fine if a patch
 * already has them; they just can't be built or edited here yet.
 */
export const APOLLO_ADD_OPTIONS: { type: EffectType; label: string; fx: FxType }[] = [
  { type: 'helios', fx: 'hyper',    label: 'Hyper / Dimension' },
  { type: 'helios', fx: 'phaser',   label: 'Phaser' },
  { type: 'helios', fx: 'flanger',  label: 'Flanger' },
  { type: 'helios', fx: 'echobode', label: 'Echobode (freq-shift delay)' },
  { type: 'helios', fx: 'octaver',  label: 'Octaver' },
  { type: 'helios', fx: 'convolve', label: 'Convolve (IR reverb)' },
]

/**
 * Sensible starting values for a freshly added effect.
 *
 * `fx` is required for type 'helios' and ignored otherwise: an Apollo device's
 * defaults come from Apollo's own FX_DEFS registry rather than a copy kept
 * here, so a unit that gains a parameter in Apollo gains it here too.
 */
export function makeDefaultParams(type: EffectType, fx?: FxType) {
  if (type === 'helios') return { enabled: true, unit: defaultFx(fx ?? 'phaser') }
  switch (type) {
    // ⚠️ An EQ you ADD is not the same thing as an EQ that is THERE.
    //
    // Brae: "EQ should be flat normally, but when I add the EQ filter it should
    // change the EQ."
    //
    // Both halves matter. A track's EQ sitting flat is correct and every DAW
    // does it — nobody wants their sound coloured by opening a panel. But
    // deliberately ADDING one is an action, and an action that produces no
    // sound is indistinguishable from a broken one; that is exactly how the
    // filter's 8 kHz default read.
    //
    // So `defaultEq3()` stays flat for everything that just needs the shape,
    // and the ADD path gives a gentle brightening — the most common reason
    // anyone reaches for an EQ, audible immediately, and one drag from flat
    // again.
    // Measured: a +4/-2 shelf pair moved a pad by only 2.0 dB, because a shelf at
    // 8 kHz has little to work on. The mid band is where instruments actually
    // live, so the tilt runs across all three and lands around 5 dB — heard on
    // anything, and still gentle enough to keep.
    case 'eq3':            return { ...defaultEq3(), highGain: 6, midGain: -3, lowGain: 3 }
    case 'compressor':     return defaultCompressor()
    case 'reverb':         return defaultReverb()
    case 'delay':          return defaultDelay()
    case 'filter':         return defaultFilter()
    case 'saturator':      return defaultSaturator()
    case 'redux':          return defaultRedux()
    case 'autopan':        return defaultAutoPan()
    case 'utility':        return defaultUtility()
    case 'lfo':            return defaultLfo()
    case 'noisegate':      return defaultNoiseGate()
    case 'deesser':        return defaultDeEsser()
    case 'chorus':         return defaultChorus()
    case 'transientshaper':return defaultTransientShaper()
    case 'multibandcomp':  return defaultMultibandComp()
    case 'limiter':        return defaultLimiter()
    case 'dyneq':          return defaultDynEq()
    case 'unmask':         return defaultUnmask()
    default:               return defaultEq3()
  }
}
