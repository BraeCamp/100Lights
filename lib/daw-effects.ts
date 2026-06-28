'use client'

import type { TrackEffect, Eq3Params, CompressorParams, ReverbParams, DelayParams, FilterParams, SaturatorParams, ReduxParams, AutoPanParams, UtilityParams, LfoParams } from './daw-types'
import { createSidechainProcessor } from './sidechain'

// Live Web Audio node handle for a single effect
export interface EffectHandle {
  input: AudioNode
  output: AudioNode
  keyInput?: AudioNode  // present on sidechain compressor — connect source track's tap here
  setParam(key: string, value: number | string | boolean): void
  dispose(): void
}

// ── Reverb impulse response generator ────────────────────────────────────────
// Generates a synthetic IR using filtered noise

function buildIR(ctx: AudioContext, decay: number, preDelay: number): AudioBuffer {
  const sr  = ctx.sampleRate
  const len = Math.floor(sr * (decay + preDelay + 0.1))
  const buf = ctx.createBuffer(2, len, sr)
  const preDelaySamples = Math.floor(sr * preDelay)

  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch)
    for (let i = preDelaySamples; i < len; i++) {
      const t    = (i - preDelaySamples) / sr
      const env  = Math.pow(0.001, t / decay)
      d[i] = (Math.random() * 2 - 1) * env
    }
  }
  return buf
}

// ── Effect builders ───────────────────────────────────────────────────────────

export function buildEq3(ctx: AudioContext, params: Eq3Params): EffectHandle {
  const low  = ctx.createBiquadFilter()
  const mid  = ctx.createBiquadFilter()
  const high = ctx.createBiquadFilter()

  low.type  = 'lowshelf'
  mid.type  = 'peaking'
  high.type = 'highshelf'

  low.frequency.value  = params.lowFreq
  mid.frequency.value  = params.midFreq
  high.frequency.value = params.highFreq
  low.gain.value  = params.enabled ? params.lowGain  : 0
  mid.gain.value  = params.enabled ? params.midGain  : 0
  high.gain.value = params.enabled ? params.highGain : 0
  mid.Q.value = 1

  low.connect(mid)
  mid.connect(high)

  return {
    input: low,
    output: high,
    setParam(key, value) {
      if (key === 'enabled') { const en = value as boolean; low.gain.value = en ? params.lowGain : 0; mid.gain.value = en ? params.midGain : 0; high.gain.value = en ? params.highGain : 0 }
      if (key === 'lowGain')   low.gain.value  = params.enabled ? value as number : 0
      if (key === 'midGain')   mid.gain.value  = params.enabled ? value as number : 0
      if (key === 'highGain')  high.gain.value = params.enabled ? value as number : 0
      if (key === 'lowFreq')   low.frequency.value  = value as number
      if (key === 'midFreq')   mid.frequency.value  = value as number
      if (key === 'highFreq')  high.frequency.value = value as number
    },
    dispose() { low.disconnect(); mid.disconnect(); high.disconnect() },
  }
}

export function buildCompressor(ctx: AudioContext, params: CompressorParams): EffectHandle {
  // Sidechain mode: VCA envelope-follower ducking
  if (params.sidechainTrackId) {
    const sc = createSidechainProcessor(ctx, params)
    const bypass = ctx.createGain()
    bypass.gain.value = params.enabled ? 1 : 0
    bypass.connect(sc.signalIn)
    return {
      input: bypass,
      output: sc.signalOut as AudioNode,
      keyInput: sc.keyInput as AudioNode,
      setParam(key, value) {
        if (key === 'enabled') bypass.gain.value = (value as boolean) ? 1 : 0
      },
      dispose() { bypass.disconnect() },
    }
  }

  // Normal compressor mode
  const comp   = ctx.createDynamicsCompressor()
  const makeup = ctx.createGain()

  comp.threshold.value = params.enabled ? params.threshold : 0
  comp.ratio.value     = params.ratio
  comp.attack.value    = params.attack
  comp.release.value   = params.release
  comp.knee.value      = params.knee
  makeup.gain.value    = params.enabled ? Math.pow(10, params.makeupGain / 20) : 1

  comp.connect(makeup)

  return {
    input: comp,
    output: makeup,
    setParam(key, value) {
      if (key === 'enabled')    { comp.threshold.value = (value as boolean) ? params.threshold : 0; makeup.gain.value = (value as boolean) ? Math.pow(10, params.makeupGain / 20) : 1 }
      if (key === 'threshold')  comp.threshold.value = params.enabled ? value as number : 0
      if (key === 'ratio')      comp.ratio.value     = value as number
      if (key === 'attack')     comp.attack.value    = value as number
      if (key === 'release')    comp.release.value   = value as number
      if (key === 'knee')       comp.knee.value      = value as number
      if (key === 'makeupGain') makeup.gain.value    = params.enabled ? Math.pow(10, (value as number) / 20) : 1
    },
    dispose() { comp.disconnect(); makeup.disconnect() },
  }
}

export function buildReverb(ctx: AudioContext, params: ReverbParams): EffectHandle {
  const convolver = ctx.createConvolver()
  const dryGain   = ctx.createGain()
  const wetGain   = ctx.createGain()
  const input     = ctx.createGain()
  const output    = ctx.createGain()

  convolver.buffer = buildIR(ctx, params.decay, params.preDelay)
  dryGain.gain.value = 1
  wetGain.gain.value = params.enabled ? params.wet : 0

  input.connect(dryGain)
  input.connect(convolver)
  convolver.connect(wetGain)
  dryGain.connect(output)
  wetGain.connect(output)

  return {
    input,
    output,
    setParam(key, value) {
      if (key === 'enabled')  { params = { ...params, enabled: value as boolean }; wetGain.gain.value = (value as boolean) ? params.wet : 0 }
      if (key === 'wet')      { params = { ...params, wet: value as number };      wetGain.gain.value = params.enabled ? value as number : 0 }
      if (key === 'decay')    { params = { ...params, decay: value as number };    convolver.buffer = buildIR(ctx, params.decay, params.preDelay) }
      if (key === 'preDelay') { params = { ...params, preDelay: value as number }; convolver.buffer = buildIR(ctx, params.decay, params.preDelay) }
    },
    dispose() { convolver.disconnect(); dryGain.disconnect(); wetGain.disconnect(); input.disconnect(); output.disconnect() },
  }
}

export function buildDelay(ctx: AudioContext, params: DelayParams, tempo: number): EffectHandle {
  const delay    = ctx.createDelay(4)
  const feedback = ctx.createGain()
  const dryGain  = ctx.createGain()
  const wetGain  = ctx.createGain()
  const input    = ctx.createGain()
  const output   = ctx.createGain()

  const delayTime = params.syncToTempo ? (params.syncBeats * 60 / tempo) : params.time
  delay.delayTime.value = delayTime
  feedback.gain.value   = params.feedback
  dryGain.gain.value    = 1
  wetGain.gain.value    = params.enabled ? params.wet : 0

  input.connect(dryGain)
  input.connect(delay)
  delay.connect(feedback)
  feedback.connect(delay)
  delay.connect(wetGain)
  dryGain.connect(output)
  wetGain.connect(output)

  return {
    input,
    output,
    setParam(key, value) {
      if (key === 'enabled')   wetGain.gain.value    = (value as boolean) ? params.wet : 0
      if (key === 'wet')       wetGain.gain.value    = params.enabled ? value as number : 0
      if (key === 'feedback')  feedback.gain.value   = value as number
      if (key === 'time')      delay.delayTime.value = value as number
    },
    dispose() { delay.disconnect(); feedback.disconnect(); dryGain.disconnect(); wetGain.disconnect(); input.disconnect(); output.disconnect() },
  }
}

export function buildFilter(ctx: AudioContext, params: FilterParams): EffectHandle {
  const filter = ctx.createBiquadFilter()
  filter.type = params.enabled ? params.type : ('allpass' as BiquadFilterType)
  filter.frequency.value = params.frequency
  filter.Q.value = params.q

  return {
    input: filter,
    output: filter,
    setParam(key, value) {
      if (key === 'enabled')   { params = { ...params, enabled: value as boolean }; filter.type = params.enabled ? params.type : ('allpass' as BiquadFilterType) }
      if (key === 'type')      { params = { ...params, type: value as FilterParams['type'] }; if (params.enabled) filter.type = params.type }
      if (key === 'frequency') { params = { ...params, frequency: value as number }; filter.frequency.value = value as number }
      if (key === 'q')         filter.Q.value = value as number
    },
    dispose() { filter.disconnect() },
  }
}

export function buildSaturator(ctx: AudioContext, params: SaturatorParams): EffectHandle {
  const preGain  = ctx.createGain()
  const shaper   = ctx.createWaveShaper()
  const lowShelf = ctx.createBiquadFilter()
  const postGain = ctx.createGain()

  lowShelf.type = 'lowshelf'
  lowShelf.frequency.value = 300

  function applyParams(p: SaturatorParams) {
    const n = 512
    const curve = new Float32Array(n)
    const k = p.enabled ? (1 + p.drive * 15) : 1  // drive 0→1 maps to soft-clip factor 1→16
    for (let i = 0; i < n; i++) {
      const x = (i * 2 / (n - 1)) - 1
      curve[i] = Math.tanh(k * x) / Math.tanh(k)
    }
    shaper.curve = curve
    lowShelf.gain.value = p.enabled ? p.color * 8 : 0  // up to +8dB warm low-shelf
    postGain.gain.value = p.enabled ? Math.pow(10, p.output / 20) : 1
  }

  applyParams(params)
  preGain.connect(lowShelf); lowShelf.connect(shaper); shaper.connect(postGain)

  return {
    input: preGain, output: postGain,
    setParam(key, value) {
      params = { ...params, [key]: value }
      applyParams(params)
    },
    dispose() { preGain.disconnect(); lowShelf.disconnect(); shaper.disconnect(); postGain.disconnect() },
  }
}

export function buildRedux(ctx: AudioContext, params: ReduxParams): EffectHandle {
  const input    = ctx.createGain()
  const output   = ctx.createGain()
  const proc     = ctx.createScriptProcessor(256, 1, 1)

  let _p = { ...params }

  proc.onaudioprocess = (e) => {
    const inBuf  = e.inputBuffer.getChannelData(0)
    const outBuf = e.outputBuffer.getChannelData(0)
    if (!_p.enabled) { outBuf.set(inBuf); return }
    const steps     = Math.pow(2, Math.max(1, _p.bitDepth))
    const srcRate   = e.inputBuffer.sampleRate
    const stepRatio = Math.max(1, Math.round(srcRate / Math.max(100, _p.sampleRate)))
    let held = 0
    for (let i = 0; i < inBuf.length; i++) {
      if (i % stepRatio === 0) held = Math.round(inBuf[i] * steps) / steps
      outBuf[i] = held
    }
  }

  input.connect(proc); proc.connect(output)

  return {
    input, output,
    setParam(key, value) { _p = { ..._p, [key]: value } },
    dispose() { input.disconnect(); proc.disconnect(); proc.onaudioprocess = null as never; output.disconnect() },
  }
}

export function buildAutoPan(ctx: AudioContext, params: AutoPanParams): EffectHandle {
  const input   = ctx.createGain()
  const panner  = ctx.createStereoPanner()
  const lfo     = ctx.createOscillator()
  const lfoGain = ctx.createGain()

  lfo.type = params.waveform as OscillatorType
  lfo.frequency.value = params.rate
  lfoGain.gain.value  = params.enabled ? params.depth : 0
  lfo.connect(lfoGain); lfoGain.connect(panner.pan)
  lfo.start()
  input.connect(panner)

  return {
    input, output: panner,
    setParam(key, value) {
      if (key === 'enabled')  lfoGain.gain.setTargetAtTime((value as boolean) ? params.depth : 0, ctx.currentTime, 0.01)
      if (key === 'rate')     { params = { ...params, rate: value as number };     lfo.frequency.setTargetAtTime(value as number, ctx.currentTime, 0.01) }
      if (key === 'depth')    { params = { ...params, depth: value as number };    if (params.enabled) lfoGain.gain.setTargetAtTime(value as number, ctx.currentTime, 0.01) }
      if (key === 'waveform') { params = { ...params, waveform: value as AutoPanParams['waveform'] }; lfo.type = value as OscillatorType }
    },
    dispose() { try { lfo.stop() } catch { /* ok */ } lfo.disconnect(); lfoGain.disconnect(); input.disconnect(); panner.disconnect() },
  }
}

export function buildUtility(ctx: AudioContext, params: UtilityParams): EffectHandle {
  const input   = ctx.createGain()
  const gainL   = ctx.createGain()
  const gainR   = ctx.createGain()
  const splitter = ctx.createChannelSplitter(2)
  const merger   = ctx.createChannelMerger(2)
  const output  = ctx.createGain()

  function applyGain(p: UtilityParams) {
    const g = p.enabled ? Math.pow(10, p.gain / 20) : 1
    gainL.gain.value = p.enabled && p.muteL ? 0 : g
    gainR.gain.value = p.enabled && p.muteR ? 0 : g
    output.gain.value = 1
  }

  input.connect(splitter)
  if (params.mono) {
    // Both channels get both L+R averaged
    splitter.connect(gainL, 0); splitter.connect(gainL, 1)
    splitter.connect(gainR, 0); splitter.connect(gainR, 1)
  } else {
    splitter.connect(gainL, 0)
    splitter.connect(gainR, 1)
  }
  gainL.connect(merger, 0, 0)
  gainR.connect(merger, 0, 1)
  merger.connect(output)
  applyGain(params)

  return {
    input, output,
    setParam(key, value) {
      params = { ...params, [key]: value }
      applyGain(params)
    },
    dispose() { input.disconnect(); splitter.disconnect(); gainL.disconnect(); gainR.disconnect(); merger.disconnect(); output.disconnect() },
  }
}

export function buildLfo(ctx: AudioContext, params: LfoParams): EffectHandle {
  const input   = ctx.createGain()
  const output  = ctx.createGain()

  // Panner for pan target
  const panner  = ctx.createStereoPanner()
  // Volume gain for volume target
  const volGain = ctx.createGain()
  // Filter for filter target
  const filter  = ctx.createBiquadFilter()
  filter.type   = 'lowpass'
  filter.frequency.value = params.filterFreqMax

  const lfo     = ctx.createOscillator()
  const lfoGain = ctx.createGain()
  lfo.type = params.waveform as OscillatorType
  lfo.frequency.value = params.rate
  lfoGain.gain.value  = params.enabled ? params.depth : 0
  lfo.start()

  function wire(p: LfoParams) {
    try { lfoGain.disconnect() } catch { /* ok */ }
    try { input.disconnect() } catch { /* ok */ }
    try { panner.disconnect() } catch { /* ok */ }
    try { volGain.disconnect() } catch { /* ok */ }
    try { filter.disconnect() } catch { /* ok */ }
    if (p.target === 'pan') {
      lfoGain.connect(panner.pan)
      input.connect(panner); panner.connect(output)
    } else if (p.target === 'volume') {
      // Add constant 1 offset so LFO oscillates around 1
      const offsetGain = ctx.createGain(); offsetGain.gain.value = 1
      const constantSrc = ctx.createConstantSource(); constantSrc.offset.value = 1; constantSrc.start()
      lfoGain.connect(volGain.gain)
      constantSrc.connect(volGain.gain)
      input.connect(volGain); volGain.connect(output)
    } else {
      // Filter: LFO modulates cutoff around midpoint
      const mid = (p.filterFreqMin + p.filterFreqMax) / 2
      const range = (p.filterFreqMax - p.filterFreqMin) / 2
      filter.frequency.value = mid
      const freqGain = ctx.createGain(); freqGain.gain.value = range
      lfoGain.connect(freqGain); freqGain.connect(filter.frequency)
      input.connect(filter); filter.connect(output)
    }
  }

  wire(params)
  lfo.connect(lfoGain)

  return {
    input, output,
    setParam(key, value) {
      params = { ...params, [key]: value }
      lfo.frequency.value = params.rate
      lfoGain.gain.value  = params.enabled ? params.depth : 0
      lfo.type = params.waveform as OscillatorType
      if (key === 'target') wire(params)
    },
    dispose() {
      try { lfo.stop() } catch { /* ok */ }
      lfo.disconnect(); lfoGain.disconnect(); input.disconnect(); output.disconnect()
      panner.disconnect(); volGain.disconnect(); filter.disconnect()
    },
  }
}

// ── Build a full effects chain for one track ──────────────────────────────────

export function buildEffectsChain(ctx: AudioContext, effects: TrackEffect[], tempo: number): {
  input: AudioNode
  output: AudioNode
  handles: Map<string, EffectHandle>
  dispose(): void
} {
  const input  = ctx.createGain()
  const output = ctx.createGain()
  const handles = new Map<string, EffectHandle>()

  let prev: AudioNode = input

  for (const effect of effects) {
    let handle: EffectHandle
    switch (effect.type) {
      case 'eq3':        handle = buildEq3(ctx, effect.params as Eq3Params); break
      case 'compressor': handle = buildCompressor(ctx, effect.params as CompressorParams); break
      case 'reverb':     handle = buildReverb(ctx, effect.params as ReverbParams); break
      case 'delay':      handle = buildDelay(ctx, effect.params as DelayParams, tempo); break
      case 'filter':     handle = buildFilter(ctx, effect.params as FilterParams); break
      case 'saturator':  handle = buildSaturator(ctx, effect.params as SaturatorParams); break
      case 'redux':      handle = buildRedux(ctx, effect.params as ReduxParams); break
      case 'autopan':    handle = buildAutoPan(ctx, effect.params as AutoPanParams); break
      case 'utility':    handle = buildUtility(ctx, effect.params as UtilityParams); break
      case 'lfo':        handle = buildLfo(ctx, effect.params as LfoParams); break
      default: continue
    }
    prev.connect(handle.input)
    prev = handle.output
    handles.set(effect.id, handle)
  }

  prev.connect(output)

  return {
    input,
    output,
    handles,
    dispose() {
      for (const h of handles.values()) h.dispose()
      input.disconnect()
      output.disconnect()
    },
  }
}
