'use client'

import type { TrackEffect, Eq3Params, CompressorParams, ReverbParams, DelayParams, FilterParams } from './daw-types'

// Live Web Audio node handle for a single effect
export interface EffectHandle {
  input: AudioNode
  output: AudioNode
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
