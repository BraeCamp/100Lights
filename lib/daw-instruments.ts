'use client'

import type { TrackInstrument, FmInstrumentParams, DrumInstrumentParams, PolyInstrumentParams, Fm4OpInstrumentParams, WavetableInstrumentParams } from './daw-types'
import { polyOscLayers } from './daw-types'
import { playDrumHit } from './drum-samples'
import type { BeatType } from './beat-analyzer'
import { playFMNote } from './fm-synth'
import { playWavetableNote } from './wavetable-synth'

// General MIDI drum map (pitch → drum type)
const GM_DRUM: Record<number, BeatType> = {
  35: '808', 36: 'kick',
  38: 'snare', 40: 'snare',
  42: 'hihat', 44: 'hihat',
  46: 'open-hihat',
  49: 'crash', 57: 'crash',
  51: 'rim', 37: 'rim',
  41: 'tom', 43: 'tom', 45: 'tom', 47: 'tom', 48: 'tom', 50: 'tom',
  39: 'clap',
  53: 'ride', 59: 'ride',        // ride cymbal (GM ride bell / ride 2)
  70: 'shaker', 82: 'shaker',    // shaker / maracas
}

function pitchToDrumType(pitch: number): BeatType {
  return GM_DRUM[pitch] ?? 'kick'
}

function pitchToHz(pitch: number): number {
  return 440 * Math.pow(2, (pitch - 69) / 12)
}

// ── FM synth voice ────────────────────────────────────────────────────────────

function playFmVoice(
  ctx: AudioContext,
  dest: AudioNode,
  params: FmInstrumentParams,
  pitch: number,
  velocity: number,
  when: number,
  duration: number,
) {
  const freq = pitchToHz(pitch)
  const vel  = velocity / 127

  const carrier     = ctx.createOscillator()
  const carrierGain = ctx.createGain()
  const modulator   = ctx.createOscillator()
  const modGain     = ctx.createGain()
  const env         = ctx.createGain()

  carrier.type            = params.waveform
  carrier.frequency.value = freq
  carrier.detune.value    = params.detune

  modulator.type            = 'sine'
  modulator.frequency.value = freq * params.modRatio
  modGain.gain.value        = params.modDepth * freq

  modulator.connect(modGain)
  modGain.connect(carrier.frequency)

  // ADSR
  const attackEnd  = when + params.attack
  const decayEnd   = attackEnd + params.decay
  const releaseAt  = when + Math.max(params.attack + params.decay, duration - params.release)
  const endAt      = releaseAt + params.release

  env.gain.setValueAtTime(0, when)
  env.gain.linearRampToValueAtTime(vel, attackEnd)
  env.gain.linearRampToValueAtTime(vel * params.sustain, decayEnd)
  env.gain.setValueAtTime(vel * params.sustain, releaseAt)
  env.gain.linearRampToValueAtTime(0, endAt)

  carrier.connect(carrierGain)
  carrierGain.connect(env)
  env.connect(dest)

  carrier.start(when)
  modulator.start(when)
  carrier.stop(endAt + 0.01)
  modulator.stop(endAt + 0.01)

  carrier.onended = () => {
    carrier.disconnect()
    carrierGain.disconnect()
    modulator.disconnect()
    modGain.disconnect()
    env.disconnect()
  }
}

// ── Poly synth voice (subtractive + LFO) ─────────────────────────────────────

function playPolyVoice(
  ctx: AudioContext,
  dest: AudioNode,
  params: PolyInstrumentParams,
  pitch: number,
  velocity: number,
  when: number,
  duration: number,
) {
  const freq = pitchToHz(pitch)
  const vel  = velocity / 127

  const filter = ctx.createBiquadFilter()
  const env    = ctx.createGain()
  const mix    = ctx.createGain()   // sums the oscillator stack before the filter

  filter.type            = params.filterType
  filter.frequency.value = params.filterCutoff
  filter.Q.value         = params.filterResonance

  // Oscillator stack: osc 1 + osc 2 + a sub…, each layer optionally fanned out
  // into `unison` detuned copies. Every voice sums into `mix`, scaled by the
  // total voice count so stacking more oscillators never clips.
  const layers = polyOscLayers(params)
  let totalVoices = 0
  for (const l of layers) if (l.source === 'wave') totalVoices += Math.max(1, Math.min(7, Math.round(l.unison)))
  const oscs: OscillatorNode[] = []
  const oscGains: GainNode[] = []
  for (const layer of layers) {
    if (layer.source !== 'wave') continue   // 'sample' layers are a reserved hook, not rendered yet
    const u = Math.max(1, Math.min(7, Math.round(layer.unison)))
    for (let i = 0; i < u; i++) {
      const o = ctx.createOscillator()
      o.type = layer.waveform
      o.frequency.value = freq
      // Spread the unison voices symmetrically across `spread` cents.
      const uni = u > 1 ? layer.spread * (i / (u - 1) - 0.5) : 0
      o.detune.value = layer.octave * 1200 + layer.detune + uni
      const g = ctx.createGain()
      g.gain.value = (layer.level ?? 1) / (totalVoices || 1)
      o.connect(g); g.connect(mix)
      oscs.push(o); oscGains.push(g)
    }
  }
  // A patch whose only layers are (unrendered) samples still needs to sound.
  if (oscs.length === 0) {
    const o = ctx.createOscillator()
    o.type = params.waveform; o.frequency.value = freq; o.detune.value = params.detune
    const g = ctx.createGain(); g.gain.value = 1
    o.connect(g); g.connect(mix)
    oscs.push(o); oscGains.push(g)
  }

  const attackEnd  = when + params.attack
  const decayEnd   = attackEnd + params.decay
  const releaseAt  = when + Math.max(params.attack + params.decay, duration - params.release)
  const endAt      = releaseAt + params.release

  env.gain.setValueAtTime(0, when)
  env.gain.linearRampToValueAtTime(vel, attackEnd)
  env.gain.linearRampToValueAtTime(vel * params.sustain, decayEnd)
  env.gain.setValueAtTime(vel * params.sustain, releaseAt)
  env.gain.linearRampToValueAtTime(0, endAt)

  mix.connect(filter)
  filter.connect(env)

  // LFO — set up before final routing so amp target can intercept the signal path
  let lfo: OscillatorNode | null      = null
  let lfoGain: GainNode | null        = null
  let dc: ConstantSourceNode | null   = null
  let tremoloGain: GainNode | null    = null

  if (params.lfoEnabled) {
    lfo     = ctx.createOscillator()
    lfoGain = ctx.createGain()
    lfo.type            = params.lfoWaveform
    lfo.frequency.value = params.lfoRate
    lfo.connect(lfoGain)

    if (params.lfoTarget === 'pitch') {
      lfoGain.gain.value = params.lfoDepth * 200  // ±200 cents at full depth (1.67 semitones)
      for (const o of oscs) lfoGain.connect(o.detune)
    } else if (params.lfoTarget === 'filter') {
      lfoGain.gain.value = params.lfoDepth * params.filterCutoff * 0.8
      lfoGain.connect(filter.frequency)
    } else {
      // Amplitude tremolo: route through a tremoloGain driven by (DC=1 + LFO*depth)
      // so gain is always in [1 - depth*0.7, 1 + depth*0.7] — never goes negative
      tremoloGain = ctx.createGain()
      tremoloGain.gain.value = 0  // fully overridden by dc + lfo connections below
      dc = ctx.createConstantSource()
      dc.offset.value    = 1.0
      lfoGain.gain.value = params.lfoDepth * 0.7
      dc.connect(tremoloGain.gain)
      lfoGain.connect(tremoloGain.gain)
      env.connect(tremoloGain)
      dc.start(when)
      dc.stop(endAt + 0.01)
    }

    lfo.start(when)
    lfo.stop(endAt + 0.01)
  }

  // Final output routing: either straight env→dest, or env→tremoloGain→dest
  const outputNode: AudioNode = tremoloGain ?? env
  outputNode.connect(dest)

  for (const o of oscs) { o.start(when); o.stop(endAt + 0.01) }

  // All voices stop together, so one onended cleans up the whole graph.
  oscs[0].onended = () => {
    for (const o of oscs) o.disconnect()
    for (const g of oscGains) g.disconnect()
    mix.disconnect(); filter.disconnect(); env.disconnect()
    lfo?.disconnect(); lfoGain?.disconnect()
    dc?.disconnect(); tremoloGain?.disconnect()
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export function playInstrumentNote(
  ctx: AudioContext,
  dest: AudioNode,
  instrument: TrackInstrument,
  pitch: number,
  velocity: number,
  when: number,
  duration: number,
) {
  if (instrument.type === 'none') return

  if (instrument.type === 'drum') {
    const p    = instrument.params as DrumInstrumentParams
    const type = pitchToDrumType(pitch)
    const pad  = p.pads?.[pitch]
    if (pad?.mute) return
    let effectiveDest = dest
    if (pad && (pad.volume !== 0.8 || pad.pan !== 0 || pad.pitch !== 0)) {
      const padGain   = ctx.createGain()
      const padPanner = ctx.createStereoPanner()
      padGain.gain.value   = pad.volume
      padPanner.pan.value  = pad.pan
      padGain.connect(padPanner)
      padPanner.connect(dest)
      effectiveDest = padGain
    }
    const vel = pad ? (velocity / 127) * pad.volume : velocity / 127
    playDrumHit(ctx, p.pack, type, when, vel, pad?.pitch ? pitch + pad.pitch : undefined, undefined, effectiveDest)
    return
  }

  if (instrument.type === 'fm') {
    playFmVoice(ctx, dest, instrument.params as FmInstrumentParams, pitch, velocity, when, duration)
    return
  }

  if (instrument.type === 'poly') {
    playPolyVoice(ctx, dest, instrument.params as PolyInstrumentParams, pitch, velocity, when, duration)
    return
  }

  if (instrument.type === 'fm4op') {
    const patch = instrument.params as Fm4OpInstrumentParams
    const stop  = playFMNote(ctx, patch, pitch, velocity / 127, when, dest)
    const ms    = Math.max(0, (when + duration - ctx.currentTime) * 1000)
    setTimeout(stop, ms)
    return
  }

  if (instrument.type === 'wavetable') {
    const patch = instrument.params as WavetableInstrumentParams
    const stop  = playWavetableNote(ctx, patch, pitch, velocity / 127, when, dest)
    const ms    = Math.max(0, (when + duration - ctx.currentTime) * 1000)
    setTimeout(stop, ms)
    return
  }
}

// Play a single preview note (for Piano Roll key clicks, instrument testing)
export function previewNote(
  ctx: AudioContext,
  dest: AudioNode,
  instrument: TrackInstrument,
  pitch: number,
) {
  playInstrumentNote(ctx, dest, instrument, pitch, 100, ctx.currentTime, 0.5)
}
