'use client'
// Beacon → Helios instrument bridge (Phase 3 of "Helios as the shared DSP
// core"). Translates Beacon's legacy synth instruments (poly, wavetable) into
// Apollo patches so their notes render on the hardened Apollo worklet via the
// SAME per-track engine path 'apollo' instruments already use.
//
// Same rules as the FX bridge (daw-fx.ts): all-or-nothing — anything the
// translation can't represent faithfully (sample layers, custom wavetables,
// >3 oscillator layers) returns null and the legacy voice path plays it.
// Project data never changes; translation happens at the audio layer and is
// keyed by the params object's identity (SET_INSTRUMENT replaces the object).

import type { TrackInstrument, PolyInstrumentParams, WavetableInstrumentParams } from '@/lib/daw-types'
import { initPatch, type ApolloPatch, type FilterType, type ModSource, type ModRoute } from './patch'

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
const hzToNorm = (hz: number) => clamp(Math.log(clamp(hz, 8, 20000) / 8) / Math.log(2500), 0, 1)
const qToRes = (q: number) => clamp(Math.log2(clamp(q, 0.1, 20) + 1) / 4.4, 0, 0.95)

// basic-shapes factory table frame order: sine → triangle → saw → square → pulse
const WAVE_POS: Record<string, number> = { sine: 0, triangle: 0.25, sawtooth: 0.5, square: 0.75 }

const FILTER_MAP: Record<string, FilterType> = {
  lowpass: 'lp12', highpass: 'hp12', bandpass: 'bp12', notch: 'notch12',
}

function base(): ApolloPatch {
  const p = initPatch()
  p.oscs[0].enabled = false
  p.sub.enabled = false
  p.noise.enabled = false
  p.matrix = []
  p.fxMain = []; p.fxBus1 = []; p.fxBus2 = []
  return p
}

let rid = 0
const route = (source: ModSource, dest: string, amount: number, bipolar = true): ModRoute =>
  ({ id: `hs${rid++}`, source, dest, amount, bipolar, aux: 'none', auxAmount: 0, curve: null, bypass: false })

/** Beacon 'poly' synth → Apollo patch. Null = keep the legacy voice path. */
export function polyToApollo(p: PolyInstrumentParams): ApolloPatch | null {
  const out = base()
  const layers = p.oscillators?.length
    ? p.oscillators
    : [{ source: 'wave' as const, waveform: p.waveform, octave: 0, detune: p.detune ?? 0, unison: 1, spread: 0, level: 0.75 }]
  if (layers.length > 3) return null
  if (layers.some(l => l.source !== 'wave')) return null   // sample layers stay legacy
  layers.forEach((l, i) => {
    const o = out.oscs[i]
    o.enabled = true
    o.engine = 'wavetable'
    o.wt.tableId = 'basic-shapes'
    o.wt.pos = WAVE_POS[l.waveform] ?? 0.5
    o.wt.interp = 'off'
    o.level = clamp(l.level ?? 0.75, 0, 1)
    o.octave = clamp(Math.round(l.octave ?? 0), -3, 3)
    o.fine = clamp(l.detune ?? 0, -100, 100)
    o.unison = clamp(Math.round(l.unison ?? 1), 1, 7)
    o.detune = clamp((l.spread ?? 0) / 100, 0, 1)
    o.dest = 'f1'
  })
  // amp envelope
  out.envs[0] = { ...out.envs[0], attack: clamp(p.attack, 0.001, 8), hold: 0, decay: clamp(p.decay, 0.001, 8), sustain: clamp(p.sustain, 0, 1), release: clamp(p.release, 0.001, 8) }
  // filter
  out.filters[0].enabled = true
  out.filters[0].type = FILTER_MAP[p.filterType] ?? 'lp12'
  out.filters[0].cutoff = hzToNorm(p.filterCutoff)
  out.filters[0].res = qToRes(p.filterResonance)
  // LFO
  if (p.lfoEnabled && p.lfoDepth > 0) {
    out.lfos[0].sync = false
    out.lfos[0].rate = clamp(p.lfoRate, 0.01, 40)
    if (p.lfoTarget === 'filter') out.matrix.push(route('lfo1', 'f1.cutoff', clamp(p.lfoDepth * 0.5, 0, 1)))
    else if (p.lfoTarget === 'pitch') {
      for (let i = 0; i < layers.length; i++) out.matrix.push(route('lfo1', `osc${i}.fine`, clamp(p.lfoDepth * 0.25, 0, 1)))
    } else out.matrix.push(route('lfo1', 'global.masterGain', clamp(p.lfoDepth * 0.5, 0, 1)))
  }
  out.name = 'Poly (Helios)'
  return out
}

// Beacon's named wavetable sets → nearest Apollo factory tables
const WT_TABLE: Record<string, string | null> = {
  analog: 'analog-saws', digital: 'digital-glitch', vocal: 'vocal',
  strings: 'organ', brass: 'analog-saws', custom: null,
}

/** Beacon 'wavetable' synth → Apollo patch. Null = keep the legacy path. */
export function wavetableToApollo(p: WavetableInstrumentParams): ApolloPatch | null {
  const tA = WT_TABLE[p.oscAWavetable]
  const tB = WT_TABLE[p.oscBWavetable]
  if (!tA || !tB) return null   // custom tables stay legacy
  const out = base()
  const specs = [
    { table: tA, pos: p.oscAPosition, det: p.oscADetune, gain: p.oscAGain },
    { table: tB, pos: p.oscBPosition, det: p.oscBDetune, gain: p.oscBGain },
  ]
  specs.forEach((sp, i) => {
    if (sp.gain <= 0.001) return
    const o = out.oscs[i]
    o.enabled = true
    o.engine = 'wavetable'
    o.wt.tableId = sp.table
    // legacy tables are mellower than Apollo's factory sweeps — sit lower in
    // the frame range, and compensate the quieter worklet gain staging
    o.wt.pos = clamp(sp.pos * 0.45, 0, 1)
    o.level = clamp(sp.gain * 1.6, 0, 1)
    o.semi = clamp(Math.round(sp.det), -36, 36)
    o.fine = clamp((sp.det - Math.round(sp.det)) * 100, -100, 100)
    o.dest = 'f1'
  })
  out.envs[0] = { ...out.envs[0], attack: clamp(p.attack, 0.001, 8), hold: 0, decay: clamp(p.decay, 0.001, 8), sustain: clamp(p.sustain, 0, 1), release: clamp(p.release, 0.001, 8) }
  out.filters[0].enabled = true
  out.filters[0].type = FILTER_MAP[p.filterType] ?? 'lp12'
  out.filters[0].cutoff = hzToNorm(p.filterCutoff)
  out.filters[0].res = qToRes(p.filterResonance)
  // filter envelope → env2 routed to cutoff
  if (Math.abs(p.filterEnvAmount) > 0.01) {
    out.envs[1] = { ...out.envs[1], attack: clamp(p.fAttack, 0.001, 8), hold: 0, decay: clamp(p.fDecay, 0.001, 8), sustain: clamp(p.fSustain, 0, 1), release: clamp(p.fRelease, 0.001, 8) }
    out.matrix.push(route('env2', 'f1.cutoff', clamp(p.filterEnvAmount, -1, 1), false))
  }
  if (p.lfoDepth > 0.001) {
    out.lfos[0].sync = false
    out.lfos[0].rate = clamp(p.lfoRate, 0.01, 40)
    if (p.lfoTarget === 'filter') out.matrix.push(route('lfo1', 'f1.cutoff', clamp(p.lfoDepth, 0, 1)))
    else if (p.lfoTarget === 'pitch') {
      out.matrix.push(route('lfo1', 'osc0.fine', clamp(p.lfoDepth * 2, 0, 1)))
      out.matrix.push(route('lfo1', 'osc1.fine', clamp(p.lfoDepth * 2, 0, 1)))
    } else out.matrix.push(route('lfo1', 'global.masterGain', clamp(p.lfoDepth, 0, 1)))
  }
  out.global.masterGain = clamp(p.masterGain ?? 0.8, 0, 1)
  out.global.poly = clamp(Math.round(p.polyphony ?? 8), 1, 16)
  out.name = 'Wavetable (Helios)'
  return out
}

/** Translate a legacy synth instrument; null = not translatable (or not a
 * legacy synth at all). Callers cache by params object identity. */
export function translateInstrument(instr: TrackInstrument): ApolloPatch | null {
  if (instr.type === 'poly') return polyToApollo(instr.params as PolyInstrumentParams)
  if (instr.type === 'wavetable') return wavetableToApollo(instr.params as WavetableInstrumentParams)
  return null
}
