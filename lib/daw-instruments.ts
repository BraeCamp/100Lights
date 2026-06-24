'use client'

import type { TrackInstrument, FmInstrumentParams, DrumInstrumentParams } from './daw-types'
import { playDrumHit } from './drum-samples'
import type { BeatType } from './beat-analyzer'

// General MIDI drum map (pitch → drum type)
const GM_DRUM: Record<number, BeatType> = {
  35: 'kick', 36: 'kick',
  38: 'snare', 40: 'snare',
  42: 'hihat', 44: 'hihat',
  46: 'open-hihat',
  49: 'crash', 57: 'crash',
  51: 'rim', 37: 'rim',
  41: 'tom', 43: 'tom', 45: 'tom', 47: 'tom', 48: 'tom', 50: 'tom',
  39: 'clap',
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
    playDrumHit(ctx, p.pack, type, when, velocity / 127, undefined, undefined, dest)
    return
  }

  if (instrument.type === 'fm') {
    playFmVoice(ctx, dest, instrument.params as FmInstrumentParams, pitch, velocity, when, duration)
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
