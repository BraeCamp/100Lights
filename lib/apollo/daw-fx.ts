'use client'
// Beacon → Helios FX bridge (Phase 1 of "Helios as the shared DSP core").
//
// Beacon's device chain historically ran on per-effect WebAudio node graphs
// (lib/daw-effects.ts). This module renders the SAME TrackEffect list through
// Apollo's hardened engine instead: one AudioWorkletNode per chain in fx-only
// mode, with each Beacon effect translated to Apollo FxUnit(s). The project
// format does not change — translation happens at the audio layer only, so
// old projects load untouched and the legacy path remains as fallback.
//
// Dependency direction: Beacon imports this bridge; nothing in lib/apollo
// depends on Beacon beyond type-only imports here (same precedent as
// daw-instrument.ts). Apollo standalone never loads this file.
//
// A chain translates ONLY if every effect in it is supported — mixed chains
// fall back to the legacy path wholesale (translateChain returns null), so a
// chain never runs half-Helios/half-legacy. Unsupported today: sidechained
// compressors (Helios has no external key input), custom reverb IRs,
// noisegate / deesser / transientshaper / multibandcomp / limiter / dyneq /
// autopan / fx-lfo (candidates for the Beacon-parity FX pack), and utility
// channel mutes.

import type { TrackEffect, Eq3Params, CompressorParams, ReverbParams, DelayParams, FilterParams, SaturatorParams, ReduxParams, UtilityParams, ChorusParams } from '@/lib/daw-types'
import { initPatch, SYNC_RATES, type ApolloPatch, type FxUnit, type FxType } from './patch'
import { ApolloEngine } from './engine-client'

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
/** Inverse of the engine's cutoffHz(norm) = 8 * 2500^norm (8 Hz .. 20 kHz). */
const hzToNorm = (hz: number) => clamp(Math.log(clamp(hz, 8, 20000) / 8) / Math.log(2500), 0, 1)
/** Biquad Q → Apollo's 0..1 resonance (perceptual approximation). */
const qToRes = (q: number) => clamp(Math.log2(clamp(q, 0.1, 20) + 1) / 4.4, 0, 0.95)

const mkUnit = (id: string, type: FxType, enabled: boolean, mix: number, params: Record<string, number>): FxUnit =>
  ({ id, type, enabled, mix, params })

/** One Beacon effect → one or more Helios units. Null = unsupported. */
export function translateEffect(e: TrackEffect, tempo: number): FxUnit[] | null {
  void tempo
  const on = (e.params as { enabled?: boolean }).enabled !== false
  switch (e.type) {
    case 'eq3': {
      const p = e.params as Eq3Params
      // 3 bands across two 2-band EQ units: [lo-shelf + mid-peak] then [hi-shelf]
      return [
        mkUnit(e.id, 'eq', on, 1, {
          t1: 0, f1: hzToNorm(p.lowFreq), g1: clamp(p.lowGain, -18, 18), q1: 0.8,
          t2: 1, f2: hzToNorm(p.midFreq), g2: clamp(p.midGain, -18, 18), q2: 1,
        }),
        mkUnit(`${e.id}_hi`, 'eq', on, 1, {
          t1: 2, f1: hzToNorm(p.highFreq), g1: clamp(p.highGain, -18, 18), q1: 0.8,
          t2: 1, f2: 0.9, g2: 0, q2: 0.8,
        }),
      ]
    }
    case 'compressor': {
      const p = e.params as CompressorParams
      if (p.sidechainTrackId) return null
      // WebAudio's DynamicsCompressorNode applies AUTOMATIC makeup gain
      // (≈ -threshold·(1-1/ratio)/2); Apollo's compressor is honest. Emulate
      // the auto-makeup so translated chains keep the legacy loudness.
      const autoMakeup = -clamp(p.threshold, -60, 0) * (1 - 1 / clamp(p.ratio, 1, 20)) / 2
      return [mkUnit(e.id, 'compressor', on, 1, {
        threshold: clamp(p.threshold, -60, 0), ratio: clamp(p.ratio, 1, 20),
        attack: clamp(p.attack * 1000, 0.1, 200), release: clamp(p.release * 1000, 10, 2000),
        makeup: clamp(p.makeupGain + autoMakeup, 0, 24), upward: 0, multiband: 0, loFreq: 0.25, hiFreq: 0.7,
      })]
    }
    case 'reverb': {
      const p = e.params as ReverbParams
      if (p.irData) return null
      return [mkUnit(e.id, 'reverb', on, clamp(p.wet, 0, 1), {
        mode: 0, size: clamp(p.decay / 6, 0.15, 1), decay: clamp(p.decay / 10, 0.05, 1),
        damp: 0.4, predelay: clamp(p.preDelay * 1000, 0, 200), width: 1, lowcut: 0.1,
      })]
    }
    case 'delay': {
      const p = e.params as DelayParams
      let idx = 9
      if (p.syncToTempo) {
        let bd = Infinity
        SYNC_RATES.forEach((r, k) => { const d = Math.abs(r.beats - p.syncBeats); if (d < bd) { bd = d; idx = k } })
      }
      return [mkUnit(e.id, 'delay', on, clamp(p.wet, 0, 1), {
        timeL: idx, timeR: idx, sync: p.syncToTempo ? 1 : 0,
        freeMs: clamp(p.time * 1000, 1, 2000), feedback: clamp(p.feedback, 0, 0.95),
        pingpong: 0, lpf: 1, hpf: 0, tape: 0,
      })]
    }
    case 'filter': {
      const p = e.params as FilterParams
      const typeIdx = { lowpass: 1, highpass: 5, bandpass: 7, notch: 9 }[p.type] ?? 1 // FILTER_TYPES indices (lp12/hp12/bp12/notch12)
      return [mkUnit(e.id, 'filter', on, 1, {
        type: typeIdx, cutoff: hzToNorm(p.frequency), res: qToRes(p.q), drive: 0, fat: 0.5, pan: 0,
      })]
    }
    case 'saturator': {
      const p = e.params as SaturatorParams
      const units = [mkUnit(e.id, 'distortion', on, 1, {
        mode: 0, drive: clamp(p.drive, 0, 1), bias: 0, filterPos: 0, filterType: 0, cutoff: 0.7, res: 0.2,
      })]
      if (Math.abs(p.output) > 0.01) units.push(mkUnit(`${e.id}_out`, 'utility', on, 1, { gain: clamp(p.output, -24, 24), pan: 0, width: 1 }))
      return units
    }
    case 'redux': {
      const p = e.params as ReduxParams
      return [mkUnit(e.id, 'bitcrush', on, 1, {
        bits: clamp(p.bitDepth, 1, 16), downsample: clamp(44100 / clamp(p.sampleRate, 100, 44100), 1, 64),
      })]
    }
    case 'utility': {
      const p = e.params as UtilityParams
      if (p.muteL || p.muteR) return null
      return [mkUnit(e.id, 'utility', on, 1, {
        gain: clamp(p.gain, -24, 24), pan: 0, width: p.mono ? 0 : clamp(p.width, 0, 2),
      })]
    }
    case 'chorus': {
      const p = e.params as ChorusParams
      const type: FxType = p.type === 'flanger' ? 'flanger' : p.type === 'phaser' ? 'phaser' : 'chorus'
      return [mkUnit(e.id, type, on, clamp(p.mix, 0, 1),
        type === 'chorus'
          ? { rate: clamp(p.rate, 0.05, 8), depth: clamp(p.depth, 0, 1), delay: 12, feedback: clamp(p.feedback, 0, 0.9), lpf: 1, voices: 3 }
          : { rate: clamp(p.rate, 0.05, 8), depth: clamp(p.depth, 0, 1), feedback: clamp(p.feedback, 0, 0.9) })]
    }
    default:
      return null
  }
}

/** Whole chain, all-or-nothing. */
export function translateChain(effects: TrackEffect[], tempo: number): FxUnit[] | null {
  const out: FxUnit[] = []
  for (const e of effects) {
    const units = translateEffect(e, tempo)
    if (!units) return null
    out.push(...units)
  }
  return out
}

function fxOnlyPatch(units: FxUnit[]): ApolloPatch {
  const p = initPatch()
  for (const o of p.oscs) o.enabled = false
  p.sub.enabled = false
  p.noise.enabled = false
  p.fxMain = units
  p.global.masterGain = 1
  return p
}

export interface HeliosChain {
  input: AudioNode
  output: AudioNode
  handles: Map<string, { setParam(key: string, value: number | string | boolean): void; dispose(): void }>
  dispose(): void
}

/**
 * Drop-in replacement for buildEffectsChain: same {input, output, handles,
 * dispose} shape, but the whole chain runs inside one Helios worklet.
 * Continuous edits stream as pv overrides (no state reset); structural edits
 * (enable/type/booleans) resend the translated patch.
 */
export function buildHeliosFxChain(ctx: BaseAudioContext, effects: TrackEffect[], tempo: number): HeliosChain | null {
  const units = translateChain(effects, tempo)
  if (!units) return null
  const input = ctx.createGain()
  const output = ctx.createGain()
  const engine = new ApolloEngine()
  const current: TrackEffect[] = effects.map(e => ({ ...e, params: { ...(e.params as object) } as TrackEffect['params'] }))
  let alive = true
  void engine.init({ ctx, destination: output, fxInput: true }).then(() => {
    if (!alive) return
    engine.sendPatch(fxOnlyPatch(units))
    engine.node?.port.postMessage({ type: 'fxMode', on: true })
    if (engine.node) input.connect(engine.node)
  }).catch(() => { /* worklet unavailable — silence; the legacy path is the upstream safety net */ })

  const resend = () => {
    const u2 = translateChain(current, tempo)
    if (u2 && engine.node) {
      engine.sendPatch(fxOnlyPatch(u2))
      engine.node.port.postMessage({ type: 'fxMode', on: true })
    }
  }
  const handles = new Map<string, { setParam(key: string, value: number | string | boolean): void; dispose(): void }>()
  for (const e of current) {
    handles.set(e.id, {
      setParam(key, value) {
        ;(e.params as unknown as Record<string, unknown>)[key] = value
        if (typeof value === 'number') {
          // continuous: retranslate this effect and stream the diff as pv paths
          const units2 = translateEffect(e, tempo)
          if (!units2) { resend(); return }
          const values: Record<string, number> = {}
          for (const u of units2) {
            for (const [k, v] of Object.entries(u.params)) values[`fx.${u.id}.${k}`] = v
            values[`fx.${u.id}.mix`] = u.mix
          }
          engine.node?.port.postMessage({ type: 'pv', values })
        } else {
          resend()   // enable toggles / mode strings restructure the chain
        }
      },
      dispose() { /* chain-level dispose handles the node */ },
    })
  }
  return {
    input,
    output,
    handles,
    dispose() {
      alive = false
      try { input.disconnect() } catch { /* ok */ }
      try { engine.node?.disconnect() } catch { /* ok */ }
      try { output.disconnect() } catch { /* ok */ }
      try { engine.node?.port.postMessage({ type: 'allOff' }) } catch { /* gone */ }
    },
  }
}
