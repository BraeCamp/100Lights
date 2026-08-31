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
// chain never runs half-Helios/half-legacy. Remaining fallbacks: custom
// reverb IRs, utility channel mutes, fx-LFO targeting the filter, multiband
// compressors with strongly divergent per-band settings, and chains with
// more than one sidechained compressor.

import type { TrackEffect, Eq3Params, CompressorParams, ReverbParams, DelayParams, FilterParams, SaturatorParams, ReduxParams, UtilityParams, ChorusParams, NoiseGateParams, DeEsserParams, TransientShaperParams, MultibandCompParams, LimiterParams, DynEqParams, LfoParams, HeliosFxParams } from '@/lib/daw-types'
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
      // WebAudio's DynamicsCompressorNode applies AUTOMATIC makeup gain
      // (≈ -threshold·(1-1/ratio)/2); Apollo's compressor is honest. Emulate
      // the auto-makeup so translated chains keep the legacy loudness.
      const autoMakeup = -clamp(p.threshold, -60, 0) * (1 - 1 / clamp(p.ratio, 1, 20)) / 2
      return [mkUnit(e.id, 'compressor', on, 1, {
        threshold: clamp(p.threshold, -60, 0), ratio: clamp(p.ratio, 1, 20),
        attack: clamp(p.attack * 1000, 0.1, 200), release: clamp(p.release * 1000, 10, 2000),
        makeup: clamp(p.makeupGain + autoMakeup, 0, 24), upward: 0, multiband: 0, loFreq: 0.25, hiFreq: 0.7,
        sidechain: p.sidechainTrackId ? 1 : 0,
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
    case 'noisegate': {
      const p = e.params as NoiseGateParams
      return [mkUnit(e.id, 'noisegate', on, 1, {
        threshold: clamp(p.threshold, -80, 0), attack: clamp(p.attack * 1000, 0.1, 500),
        hold: clamp(p.hold * 1000, 0, 500), release: clamp(p.release * 1000, 1, 2000),
        reduction: clamp(-p.reduction, 0, 80),
      })]
    }
    case 'deesser': {
      const p = e.params as DeEsserParams
      return [mkUnit(e.id, 'deesser', on, 1, {
        freq: hzToNorm(p.frequency), bandwidth: clamp(p.bandwidth, 0.3, 3),
        threshold: clamp(p.threshold, -60, 0), reduction: clamp(p.reduction, 0, 24),
      })]
    }
    case 'transientshaper': {
      const p = e.params as TransientShaperParams
      return [mkUnit(e.id, 'transientshaper', on, 1, {
        attack: clamp(p.attack, -12, 12), sustain: clamp(p.sustain, -12, 12), gain: clamp(p.gain, -6, 6),
      })]
    }
    case 'multibandcomp': {
      const p = e.params as MultibandCompParams
      // Apollo's multiband shares one threshold/ratio — only translate when
      // the bands are set alike (the common case); divergent bands stay legacy
      const thSpread = Math.max(p.lowThreshold, p.midThreshold, p.highThreshold) - Math.min(p.lowThreshold, p.midThreshold, p.highThreshold)
      const raSpread = Math.max(p.lowRatio, p.midRatio, p.highRatio) - Math.min(p.lowRatio, p.midRatio, p.highRatio)
      if (thSpread > 3 || raSpread > 1.5) return null
      const th = (p.lowThreshold + p.midThreshold + p.highThreshold) / 3
      const ratio = (p.lowRatio + p.midRatio + p.highRatio) / 3
      const mk2 = (p.lowGain + p.midGain + p.highGain) / 3
      return [mkUnit(e.id, 'compressor', on, 1, {
        threshold: clamp(th, -60, 0), ratio: clamp(ratio, 1, 20),
        attack: 10, release: 150, makeup: clamp(mk2, 0, 24), upward: 0,
        multiband: 1, loFreq: hzToNorm(p.lowMid), hiFreq: hzToNorm(p.midHigh), sidechain: 0,
      })]
    }
    case 'limiter': {
      const p = e.params as LimiterParams
      // input drive + brickwall ≈ utility gain into a 20:1 fast compressor
      return [
        mkUnit(e.id, 'utility', on, 1, { gain: clamp(p.gainDb, 0, 24), pan: 0, width: 1 }),
        mkUnit(`${e.id}_lim`, 'compressor', on, 1, {
          threshold: clamp(p.ceilingDb - 0.5, -12.5, -0.5), ratio: 20,
          attack: 0.1, release: clamp(p.release * 1000, 10, 1000),
          makeup: 0, upward: 0, multiband: 0, loFreq: 0.25, hiFreq: 0.7, sidechain: 0,
        }),
      ]
    }
    case 'dyneq': {
      const p = e.params as DynEqParams
      return [mkUnit(e.id, 'dyneq', on, 1, {
        freq: hzToNorm(p.freq), q: clamp(p.q, 0.3, 12),
        threshold: clamp(p.thresholdDb, -60, 0), range: clamp(p.rangeDb, -18, 18),
        attack: clamp(p.attack * 1000, 1, 500), release: clamp(p.release * 1000, 10, 1000),
      })]
    }
    case 'autopan': {
      const p = e.params as { enabled: boolean; rate: number; depth: number; waveform: string; phase: number }
      return [mkUnit(e.id, 'autopan', on, 1, {
        rate: clamp(p.rate, 0.01, 20), depth: clamp(p.depth, 0, 1),
        wave: p.waveform === 'triangle' ? 1 : p.waveform === 'square' ? 2 : 0,
        phase: clamp(p.phase ?? 180, 0, 360),
      })]
    }
    case 'lfo': {
      const p = e.params as LfoParams
      // pan/volume LFO targets map onto the auto-pan unit; the filter target
      // has no per-unit LFO in Apollo yet — stays legacy
      if (p.target === 'filter') return null
      return [mkUnit(e.id, 'autopan', on, 1, {
        rate: clamp(p.rate, 0.01, 20), depth: clamp(p.depth, 0, 1),
        wave: p.waveform === 'triangle' ? 1 : p.waveform === 'square' ? 2 : 0,
        phase: p.target === 'pan' ? 180 : 0,   // opposite = pan, in-phase = tremolo
      })]
    }
    case 'helios': {
      // an Apollo unit stored verbatim — pass it straight through
      const p = e.params as HeliosFxParams
      if (!p.unit) return null
      return [{ ...(p.unit as FxUnit), enabled: on && p.unit.enabled !== false }]
    }
    default:
      return null
  }
}

/**
 * Track-chain ↔ Apollo Rack card adapter. Opening a chain in the card shows
 * translateChain(effects); when the card writes back, each edited or new unit
 * becomes a 'helios' wrapper device (editing in Apollo converts that device
 * to an Apollo-native one), untouched devices stay in their Beacon form.
 */
export function applyRackEdit(effects: TrackEffect[], editedUnits: FxUnit[]): TrackEffect[] {
  // unit-id → owning effect (translated ids are the effect id or id+suffix)
  const owner = new Map<string, TrackEffect>()
  const originalUnits = new Map<string, FxUnit>()
  for (const e of effects) {
    const units = translateEffect(e, 120) ?? []
    for (const u of units) { owner.set(u.id, e); originalUnits.set(u.id, u) }
  }
  const out: TrackEffect[] = []
  const consumed = new Set<string>()
  for (const u of editedUnits) {
    const src = owner.get(u.id)
    const orig = originalUnits.get(u.id)
    if (src && orig && JSON.stringify(u) === JSON.stringify(orig)) {
      // untouched — keep the original Beacon device (once, even if it
      // translated to several units: only emit when its FIRST unit passes)
      if (!consumed.has(src.id)) { out.push(src); consumed.add(src.id) }
    } else if (src && !consumed.has(src.id)) {
      // edited — the device converts to Apollo-native wrapper(s)
      consumed.add(src.id)
      out.push({ id: src.id, type: 'helios', params: { enabled: true, unit: u } } as TrackEffect)
    } else if (src) {
      // additional unit of an already-consumed multi-unit device: if the
      // device stayed Beacon-native its other units are implied; if it was
      // converted, keep this sibling as its own wrapper when edited
      if (!(orig && JSON.stringify(u) === JSON.stringify(orig))) {
        out.push({ id: `${src.id}_${u.id}`, type: 'helios', params: { enabled: true, unit: u } } as TrackEffect)
      }
    } else {
      // brand-new unit added in the card
      out.push({ id: u.id, type: 'helios', params: { enabled: true, unit: u } } as TrackEffect)
    }
  }
  return out
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
  handles: Map<string, { setParam(key: string, value: number | string | boolean): void; dispose(): void; keyInput?: AudioNode }>
  /** Live gain-reduction meters keyed by unit id (dB, negative = reducing). */
  meters(): Record<string, number[]>
  dispose(): void
  /** Resolves once the worklet has ACKED patch + fx mode — offline bounces
   * MUST await this before startRendering (port delivery races the render). */
  ready: Promise<void>
  /**
   * Called if the worklet dies. A dead node never produces another sample, so
   * whatever is routed through this chain is silent until something re-routes
   * it — the caller has to be able to hear about that, not just Sentry.
   */
  onCrash(fn: () => void): void
  /**
   * Declare this chain dead and run everyone's onCrash.
   *
   * A recovery path that has never once been taken is a recovery path that
   * does not work, and `onprocessorerror` cannot be provoked to order. This is
   * how the fallback gets exercised — and it is genuine API, not scaffolding:
   * a host that decides the worklet is gone by some other means (no meters for
   * seconds while the transport runs) needs to be able to say so.
   */
  crash(): void
}

/**
 * Drop-in replacement for buildEffectsChain: same {input, output, handles,
 * dispose} shape, but the whole chain runs inside one Helios worklet.
 * Continuous edits stream as pv overrides (no state reset); structural edits
 * (enable/type/booleans) resend the translated patch.
 */
/**
 * The master glue bus on Helios: emulates the legacy master
 * DynamicsCompressor (-6dB, 2.5:1, 3ms/250ms, knee 10) including WebAudio's
 * hidden auto-makeup, on the crash-armored worklet. Same {input, output,
 * ready, dispose} contract as track chains.
 */
export function buildHeliosMasterBus(ctx: BaseAudioContext): HeliosChain {
  const units: FxUnit[] = [mkUnit('master_glue', 'compressor', true, 1, {
    threshold: -6, ratio: 2.5, attack: 3, release: 250,
    makeup: -(-6) * (1 - 1 / 2.5) / 2,   // ≈1.8dB — DynamicsCompressor auto-makeup
    upward: 0, multiband: 0, loFreq: 0.25, hiFreq: 0.7, sidechain: 0,
  })]
  const input = ctx.createGain()
  const output = ctx.createGain()
  const engine = new ApolloEngine()
  let alive = true
  const ready = new Promise<void>(resolve => {
    const done = () => { engine.removeEventListener('fxModeAck', done); resolve() }
    engine.addEventListener('fxModeAck', done)
    setTimeout(resolve, 4000)
    void engine.init({ ctx, destination: output, fxInput: true }).then(() => {
      if (!alive) { resolve(); return }
      engine.sendPatch(fxOnlyPatch(units))
      engine.node?.port.postMessage({ type: 'fxMode', on: true })
      if (engine.node) input.connect(engine.node)
    }).catch(() => resolve())
  })
  return {
    input, output, ready, handles: new Map(),
    meters() { return (engine.meters as { fxGr?: Record<string, number[]> } | undefined)?.fxGr ?? {} },
    onCrash(fn) { engine.addEventListener('processorError', () => fn()) },
    crash() { engine.crashed = true; engine.dispatchEvent(new CustomEvent('processorError')) },
    dispose() {
      alive = false
      try { input.disconnect() } catch { /* ok */ }
      try { engine.node?.disconnect() } catch { /* ok */ }
      try { output.disconnect() } catch { /* ok */ }
    },
  }
}

/**
 * Why this chain cannot run on Helios, or null if it can.
 *
 * Exported because the device panel needs to SAY it. An Apollo device in a
 * chain that falls back to the legacy path is not quietly less efficient — the
 * legacy builder's `default: continue` skips a device type it does not know, so
 * the Apollo device is dropped from the audio entirely and the user is left
 * turning knobs on something they cannot hear. That is worth a sentence on the
 * card, and the sentence has to be derived from the real rule rather than a
 * second copy of it, which is why buildHeliosFxChain calls this too.
 */
export function heliosBlocker(effects: TrackEffect[], tempo: number): { effect?: TrackEffect; reason: string } | null {
  for (const e of effects) {
    if (!translateEffect(e, tempo)) return { effect: e, reason: 'has no Apollo equivalent yet' }
  }
  const sc = effects.filter(e => e.type === 'compressor' && (e.params as CompressorParams).sidechainTrackId)
  if (sc.length > 1) return { effect: sc[1], reason: 'is a second sidechained compressor, and Apollo allows one per chain' }
  return null
}

export function buildHeliosFxChain(ctx: BaseAudioContext, effects: TrackEffect[], tempo: number): HeliosChain | null {
  if (heliosBlocker(effects, tempo)) return null
  const units = translateChain(effects, tempo)
  if (!units) return null
  const scComps = effects.filter(e => e.type === 'compressor' && (e.params as CompressorParams).sidechainTrackId)
  const input = ctx.createGain()
  const output = ctx.createGain()
  const keyInput = scComps.length ? ctx.createGain() : null
  const engine = new ApolloEngine()
  // ⚠️ A SHALLOW copy of params leaves an Apollo device's `unit` object shared
  // with the project's own state — and setParam writes into unit.params, so
  // every automation frame would mutate React state in place, outside the
  // reducer, and get saved into the project as if the user had set it there.
  const current: TrackEffect[] = effects.map(e => {
    const params = { ...(e.params as object) } as TrackEffect['params']
    if (e.type === 'helios') {
      const u = (e.params as HeliosFxParams).unit
      if (u) (params as HeliosFxParams).unit = { ...u, params: { ...u.params } }
    }
    return { ...e, params }
  })
  let alive = true
  const ready = new Promise<void>(resolve => {
    const done = () => { engine.removeEventListener('fxModeAck', done); resolve() }
    engine.addEventListener('fxModeAck', done)
    setTimeout(resolve, 4000)   // never wedge a bounce on a dead worklet
    void engine.init({ ctx, destination: output, fxInput: true }).then(() => {
      if (!alive) { resolve(); return }
      engine.sendPatch(fxOnlyPatch(units))
      engine.node?.port.postMessage({ type: 'fxMode', on: true })
      if (engine.node) input.connect(engine.node)
      if (engine.node && keyInput) keyInput.connect(engine.node, 0, 1)
    }).catch(() => resolve()) /* worklet unavailable — silence; the legacy path is the upstream safety net */
  })

  const resend = () => {
    const u2 = translateChain(current, tempo)
    if (u2 && engine.node) {
      engine.sendPatch(fxOnlyPatch(u2))
      engine.node.port.postMessage({ type: 'fxMode', on: true })
    }
  }
  const handles = new Map<string, { setParam(key: string, value: number | string | boolean): void; dispose(): void; keyInput?: AudioNode }>()
  for (const e of current) {
    handles.set(e.id, {
      keyInput: e.type === 'compressor' && (e.params as CompressorParams).sidechainTrackId && keyInput ? keyInput : undefined,
      setParam(key, value) {
        // ⚠️ An Apollo device keeps its values one level down, in
        // params.unit.params — writing `params[key]` on one sets a field
        // translateEffect never reads, so the automation lane runs, the
        // points draw, and the sound does not move. Automating any Apollo
        // device was silently inert until this branch existed.
        if (e.type === 'helios') {
          const unit = (e.params as HeliosFxParams).unit
          if (unit) {
            if (key === 'enabled') (e.params as HeliosFxParams).enabled = value as boolean
            else if (key === 'mix') unit.mix = value as number
            else (unit.params as Record<string, unknown>)[key] = value
          }
        } else {
          ;(e.params as unknown as Record<string, unknown>)[key] = value
        }
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
    ready,
    meters() { return (engine.meters as { fxGr?: Record<string, number[]> } | undefined)?.fxGr ?? {} },
    onCrash(fn) { engine.addEventListener('processorError', () => fn()) },
    crash() { engine.crashed = true; engine.dispatchEvent(new CustomEvent('processorError')) },
    dispose() {
      alive = false
      try { input.disconnect() } catch { /* ok */ }
      try { engine.node?.disconnect() } catch { /* ok */ }
      try { output.disconnect() } catch { /* ok */ }
      try { engine.node?.port.postMessage({ type: 'allOff' }) } catch { /* gone */ }
    },
  }
}
