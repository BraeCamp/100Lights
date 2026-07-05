'use client'

import type { TrackEffect, Eq3Params, CompressorParams, ReverbParams, DelayParams, FilterParams, SaturatorParams, ReduxParams, AutoPanParams, UtilityParams, LfoParams, NoiseGateParams, DeEsserParams, ChorusParams, TransientShaperParams, MultibandCompParams } from './daw-types'
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

export function buildNoiseGate(ctx: AudioContext, params: NoiseGateParams): EffectHandle {
  const input  = ctx.createGain()
  const output = ctx.createGain()
  const proc   = ctx.createScriptProcessor(256, 2, 2)

  let _p = { ...params }
  let envDb = -100
  let holdTimer = 0
  let phase: 'open' | 'hold' | 'close' = 'close'

  proc.onaudioprocess = (e) => {
    const sr = e.inputBuffer.sampleRate
    const bufLen = e.inputBuffer.length

    for (let ch = 0; ch < Math.min(2, e.inputBuffer.numberOfChannels); ch++) {
      const inData  = e.inputBuffer.getChannelData(ch)
      const outData = e.outputBuffer.getChannelData(ch)

      if (!_p.enabled) { outData.set(inData); continue }

      for (let i = 0; i < bufLen; i++) {
        const sample = inData[i]
        const sampleDb = 20 * Math.log10(Math.max(0.000001, Math.abs(sample)))

        if (sampleDb > _p.threshold) {
          phase = 'open'
          holdTimer = Math.floor(_p.hold * sr)
          const attackSamples = Math.max(1, _p.attack * sr)
          envDb = Math.min(0, envDb + (0 - envDb) / attackSamples)
        } else if (phase === 'open') {
          if (holdTimer > 0) { holdTimer-- }
          else { phase = 'close' }
        }

        if (phase === 'close') {
          const releaseSamples = Math.max(1, _p.release * sr)
          envDb = Math.max(_p.reduction, envDb + (_p.reduction - envDb) / releaseSamples)
        }

        const gainLinear = Math.pow(10, envDb / 20)
        outData[i] = sample * gainLinear
      }
    }
  }

  input.connect(proc)
  proc.connect(output)

  return {
    input, output,
    setParam(key, value) { _p = { ..._p, [key]: value } },
    dispose() { input.disconnect(); proc.disconnect(); proc.onaudioprocess = null as never; output.disconnect() },
  }
}

export function buildDeEsser(ctx: AudioContext, params: DeEsserParams): EffectHandle {
  const input    = ctx.createGain()
  const output   = ctx.createGain()
  const dryGain  = ctx.createGain()
  const bandPass = ctx.createBiquadFilter()
  const compress = ctx.createDynamicsCompressor()
  const reduct   = ctx.createGain()
  const inverter = ctx.createGain()

  bandPass.type = 'bandpass'
  bandPass.frequency.value = params.frequency
  bandPass.Q.value = 1 / params.bandwidth

  compress.threshold.value = params.enabled ? params.threshold : 0
  compress.ratio.value = 8
  compress.attack.value = 0.001
  compress.release.value = 0.08

  reduct.gain.value = params.enabled ? params.reduction / 24 : 0
  inverter.gain.value = -1

  input.connect(dryGain)
  dryGain.connect(output)

  input.connect(bandPass)
  bandPass.connect(compress)
  compress.connect(reduct)
  reduct.connect(inverter)
  inverter.connect(output)

  let _p = { ...params }

  return {
    input, output,
    setParam(key, value) {
      _p = { ..._p, [key]: value }
      bandPass.frequency.value = _p.frequency
      bandPass.Q.value = 1 / _p.bandwidth
      compress.threshold.value = _p.enabled ? _p.threshold : 0
      reduct.gain.value = _p.enabled ? _p.reduction / 24 : 0
    },
    dispose() {
      input.disconnect(); dryGain.disconnect(); output.disconnect()
      bandPass.disconnect(); compress.disconnect(); reduct.disconnect(); inverter.disconnect()
    },
  }
}

export function buildChorus(ctx: AudioContext, params: ChorusParams): EffectHandle {
  const input    = ctx.createGain()
  const output   = ctx.createGain()
  const dryGain  = ctx.createGain()
  const wetGain  = ctx.createGain()
  const delay    = ctx.createDelay(0.05)
  const feedback = ctx.createGain()
  const lfo      = ctx.createOscillator()
  const lfoGain  = ctx.createGain()

  lfo.type = 'sine'
  lfo.frequency.value = params.rate

  const baseDelay = params.type === 'flanger' ? 0.003 : params.type === 'chorus' ? 0.015 : 0.001
  const depthMs   = params.type === 'flanger' ? 0.003 : params.type === 'chorus' ? 0.01  : 0.0005

  delay.delayTime.value = baseDelay
  lfoGain.gain.value = params.enabled ? depthMs * params.depth : 0
  feedback.gain.value = params.feedback

  dryGain.gain.value = 1
  wetGain.gain.value = params.enabled ? params.mix : 0

  lfo.connect(lfoGain)
  lfoGain.connect(delay.delayTime)
  lfo.start()

  input.connect(dryGain)
  input.connect(delay)
  delay.connect(feedback)
  feedback.connect(delay)
  delay.connect(wetGain)
  dryGain.connect(output)
  wetGain.connect(output)

  let _p = { ...params }

  return {
    input, output,
    setParam(key, value) {
      _p = { ..._p, [key]: value }
      lfo.frequency.value = _p.rate
      const bd = _p.type === 'flanger' ? 0.003 : _p.type === 'chorus' ? 0.015 : 0.001
      const dm = _p.type === 'flanger' ? 0.003 : _p.type === 'chorus' ? 0.01  : 0.0005
      delay.delayTime.value = bd
      lfoGain.gain.value = _p.enabled ? dm * _p.depth : 0
      feedback.gain.value = _p.feedback
      wetGain.gain.value = _p.enabled ? _p.mix : 0
    },
    dispose() {
      try { lfo.stop() } catch { /* ok */ }
      lfo.disconnect(); lfoGain.disconnect(); delay.disconnect()
      feedback.disconnect(); dryGain.disconnect(); wetGain.disconnect()
      input.disconnect(); output.disconnect()
    },
  }
}

export function buildTransientShaper(ctx: AudioContext, params: TransientShaperParams): EffectHandle {
  const input   = ctx.createGain()
  const output  = ctx.createGain()
  const proc    = ctx.createScriptProcessor(512, 2, 2)
  const outGain = ctx.createGain()

  let _p = { ...params }
  let envFast = 0
  let envSlow = 0

  proc.onaudioprocess = (e) => {
    for (let ch = 0; ch < Math.min(2, e.inputBuffer.numberOfChannels); ch++) {
      const inData  = e.inputBuffer.getChannelData(ch)
      const outData = e.outputBuffer.getChannelData(ch)
      const sr = e.inputBuffer.sampleRate

      if (!_p.enabled) { outData.set(inData); continue }

      const fastCoeff  = Math.exp(-1 / (sr * 0.005))
      const slowCoeff  = Math.exp(-1 / (sr * 0.15))
      const attackGain  = Math.pow(10, _p.attack / 20)
      const sustainGain = Math.pow(10, _p.sustain / 20)

      for (let i = 0; i < inData.length; i++) {
        const abs = Math.abs(inData[i])
        envFast = Math.max(abs, envFast * fastCoeff)
        envSlow = Math.max(abs, envSlow * slowCoeff)

        const transient = Math.max(0, envFast - envSlow)
        const sustained = envSlow
        const denom = Math.max(envFast, 0.00001)

        const shaping = 1 + (attackGain - 1) * (transient / denom)
                         + (sustainGain - 1) * (sustained / denom)

        outData[i] = inData[i] * Math.max(0, shaping)
      }
    }
  }

  outGain.gain.value = params.enabled ? Math.pow(10, params.gain / 20) : 1

  input.connect(proc)
  proc.connect(outGain)
  outGain.connect(output)

  return {
    input, output,
    setParam(key, value) {
      _p = { ..._p, [key]: value }
      outGain.gain.value = _p.enabled ? Math.pow(10, _p.gain / 20) : 1
    },
    dispose() { input.disconnect(); proc.disconnect(); proc.onaudioprocess = null as never; outGain.disconnect(); output.disconnect() },
  }
}

export function buildMultibandComp(ctx: AudioContext, params: MultibandCompParams): EffectHandle {
  const input  = ctx.createGain()
  const output = ctx.createGain()

  const lpLow  = ctx.createBiquadFilter(); lpLow.type  = 'lowpass'
  const compLow = ctx.createDynamicsCompressor()
  const gainLow = ctx.createGain()

  const hpMid  = ctx.createBiquadFilter(); hpMid.type  = 'highpass'
  const lpMid  = ctx.createBiquadFilter(); lpMid.type  = 'lowpass'
  const compMid = ctx.createDynamicsCompressor()
  const gainMid = ctx.createGain()

  const hpHigh = ctx.createBiquadFilter(); hpHigh.type = 'highpass'
  const compHigh = ctx.createDynamicsCompressor()
  const gainHigh = ctx.createGain()

  compLow.knee.value = 6;  compLow.attack.value = 0.005;  compLow.release.value = 0.1
  compMid.knee.value = 6;  compMid.attack.value = 0.005;  compMid.release.value = 0.1
  compHigh.knee.value = 6; compHigh.attack.value = 0.003; compHigh.release.value = 0.08

  function applyParams(p: MultibandCompParams) {
    const en = p.enabled
    lpLow.frequency.value  = p.lowMid
    hpMid.frequency.value  = p.lowMid;  lpMid.frequency.value  = p.midHigh
    hpHigh.frequency.value = p.midHigh
    compLow.threshold.value  = en ? p.lowThreshold  : 0; compLow.ratio.value  = p.lowRatio
    compMid.threshold.value  = en ? p.midThreshold  : 0; compMid.ratio.value  = p.midRatio
    compHigh.threshold.value = en ? p.highThreshold : 0; compHigh.ratio.value = p.highRatio
    gainLow.gain.value  = en ? Math.pow(10, p.lowGain  / 20) : 1
    gainMid.gain.value  = en ? Math.pow(10, p.midGain  / 20) : 1
    gainHigh.gain.value = en ? Math.pow(10, p.highGain / 20) : 1
  }

  applyParams(params)

  input.connect(lpLow);  lpLow.connect(compLow);   compLow.connect(gainLow);   gainLow.connect(output)
  input.connect(hpMid);  hpMid.connect(lpMid);     lpMid.connect(compMid);     compMid.connect(gainMid);   gainMid.connect(output)
  input.connect(hpHigh); hpHigh.connect(compHigh); compHigh.connect(gainHigh); gainHigh.connect(output)

  let _p = { ...params }

  return {
    input, output,
    setParam(key, value) { _p = { ..._p, [key]: value }; applyParams(_p) },
    dispose() {
      input.disconnect(); output.disconnect()
      lpLow.disconnect();  compLow.disconnect();  gainLow.disconnect()
      hpMid.disconnect();  lpMid.disconnect();    compMid.disconnect();  gainMid.disconnect()
      hpHigh.disconnect(); compHigh.disconnect(); gainHigh.disconnect()
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
      case 'lfo':            handle = buildLfo(ctx, effect.params as LfoParams); break
      case 'noisegate':      handle = buildNoiseGate(ctx, effect.params as NoiseGateParams); break
      case 'deesser':        handle = buildDeEsser(ctx, effect.params as DeEsserParams); break
      case 'chorus':         handle = buildChorus(ctx, effect.params as ChorusParams); break
      case 'transientshaper': handle = buildTransientShaper(ctx, effect.params as TransientShaperParams); break
      case 'multibandcomp':  handle = buildMultibandComp(ctx, effect.params as MultibandCompParams); break
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
