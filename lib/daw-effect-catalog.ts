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
  defaultMultibandComp, defaultLimiter, defaultDynEq,
  type EffectType,
} from './daw-types'

/** Every effect that can be added, in the order the picker shows them. */
export const ADD_OPTIONS: { type: EffectType; label: string }[] = [
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
]

/** Sensible starting values for a freshly added effect. */
export function makeDefaultParams(type: EffectType) {
  switch (type) {
    case 'eq3':            return defaultEq3()
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
    default:               return defaultEq3()
  }
}
