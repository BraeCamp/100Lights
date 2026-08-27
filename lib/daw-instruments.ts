'use client'

import type { TrackInstrument, FmInstrumentParams, DrumInstrumentParams, PolyInstrumentParams, PolyOscLayer, Fm4OpInstrumentParams, WavetableInstrumentParams, ApolloInstrumentParams } from './daw-types'
import { polyOscLayers } from './daw-types'
import { getPolySample } from './poly-sample-cache'
import { playDrumHit } from './drum-samples'
import type { BeatType } from './beat-analyzer'
import { playFMNote } from './fm-synth'

// ── Baked drum-pad samples ─────────────────────────────────────────────────────
// A kit pad can carry its own recorded one-shot (base64), so sample kits are
// portable and independent of the sound library. Decoded once and cached by the
// sample's stable id. Playback is synchronous, so the buffer must already be
// present — callers preload on kit change (preloadDrumInstrument); a pad that
// isn't decoded yet falls back to the synth voice for that single hit.
const _drumSampleBuf = new Map<string, AudioBuffer | null>()

async function _decodeDrumSample(ctx: BaseAudioContext, sample: { id: string; data: string }): Promise<void> {
  if (_drumSampleBuf.has(sample.id)) return
  _drumSampleBuf.set(sample.id, null)  // in-flight marker — don't decode twice
  try {
    const ab = await (await fetch(sample.data)).arrayBuffer()
    _drumSampleBuf.set(sample.id, await ctx.decodeAudioData(ab))
  } catch { _drumSampleBuf.set(sample.id, null) }
}

/** Warm the buffer cache for every baked pad sample in a drum instrument — call
 *  when a kit is applied (or a project loads) so the first hit isn't silent.
 *  Awaitable so offline renders can block until every pad is decoded. */
export function preloadDrumInstrument(ctx: BaseAudioContext, instrument: TrackInstrument): Promise<void> {
  if (instrument.type !== 'drum') return Promise.resolve()
  const pads = (instrument.params as DrumInstrumentParams).pads
  if (!pads) return Promise.resolve()
  const jobs: Promise<void>[] = []
  for (const pad of Object.values(pads)) if (pad.sample) jobs.push(_decodeDrumSample(ctx, pad.sample))
  return Promise.all(jobs).then(() => {})
}
import { playWavetableNote } from './wavetable-synth'
import { playApolloNote } from './apollo/daw-instrument'

// Reserved implicit choke group so hi-hats cut each other by default without
// the user configuring anything. Kept out of the 1..8 range users pick from.
export const HAT_CHOKE_GROUP = 900

/** Returned for a drum voice that belongs to a choke group. The engine fades
 *  `gain` to silence when another pad in the same group fires. */
export interface DrumVoiceHandle { chokeGroup: number; gain: GainNode }

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
  offset = 0,   // seconds already elapsed into the note (playhead entered mid-note)
) {
  const freq = pitchToHz(pitch)
  const vel  = velocity / 127
  // The note's virtual start — may be in the past when we enter mid-note. The
  // envelope and each sample's buffer position are computed relative to it so
  // the voice resumes where it should instead of re-attacking from zero.
  const vStart = when - offset

  const filter = ctx.createBiquadFilter()
  const env    = ctx.createGain()
  const mix    = ctx.createGain()   // sums the oscillator stack before the filter

  filter.type            = params.filterType
  filter.frequency.value = params.filterCutoff
  filter.Q.value         = params.filterResonance

  // Oscillator stack: osc 1 + osc 2 + a sub…, each a waveform or a pitched
  // library sample, and each optionally fanned out into `unison` detuned
  // copies. Every voice sums into `mix`, scaled by the total voice count so
  // stacking more oscillators never clips. Sample voices are only counted once
  // their buffer is warmed (an unwarmed sample layer is silent, not weighted).
  const layers = polyOscLayers(params)
  const clampU = (u: number) => Math.max(1, Math.min(7, Math.round(u)))
  const layerLive = (l: PolyOscLayer) =>
    l.source === 'sample' ? !!(l.sampleId && getPolySample(l.sampleId)) : true
  let totalVoices = 0
  for (const l of layers) if (layerLive(l)) totalVoices += clampU(l.unison)
  const denom = totalVoices || 1

  const oscs: OscillatorNode[] = []          // wave voices (also the pitch-LFO targets)
  const sampleSrcs: AudioBufferSourceNode[] = []
  const sampleOffsets: number[] = []         // per-sample buffer start position (mid-note resume)
  const oscGains: GainNode[] = []
  for (const layer of layers) {
    const u = clampU(layer.unison)
    if (layer.source === 'sample') {
      const buf = layer.sampleId ? getPolySample(layer.sampleId) : undefined
      if (!buf) continue   // not warmed yet → this layer is silent for now
      const root = layer.sampleRoot ?? 60
      for (let i = 0; i < u; i++) {
        const uni = u > 1 ? layer.spread * (i / (u - 1) - 0.5) : 0
        const semis = (pitch - root) + layer.octave * 12 + (layer.detune + uni) / 100
        const src = ctx.createBufferSource()
        src.buffer = buf
        src.loop = true
        const rate = Math.pow(2, semis / 12)
        src.playbackRate.value = rate
        const g = ctx.createGain()
        g.gain.value = (layer.level ?? 1) / denom
        src.connect(g); g.connect(mix)
        // Resume the (looping) sample at the phase it would be at `offset`
        // seconds in, so entering mid-note doesn't restart the sample.
        const bufOff = (offset > 0 && buf.duration > 0)
          ? (((offset * rate) % buf.duration) + buf.duration) % buf.duration
          : 0
        sampleSrcs.push(src); sampleOffsets.push(bufOff); oscGains.push(g)
      }
      continue
    }
    // Wave layer.
    for (let i = 0; i < u; i++) {
      const o = ctx.createOscillator()
      o.type = layer.waveform
      o.frequency.value = freq
      // Spread the unison voices symmetrically across `spread` cents.
      const uni = u > 1 ? layer.spread * (i / (u - 1) - 0.5) : 0
      o.detune.value = layer.octave * 1200 + layer.detune + uni
      const g = ctx.createGain()
      g.gain.value = (layer.level ?? 1) / denom
      o.connect(g); g.connect(mix)
      oscs.push(o); oscGains.push(g)
    }
  }
  // Nothing rendered (e.g. a sample-only patch whose buffer isn't warmed yet) —
  // fall back to a plain tone so the note is never silent.
  if (oscs.length === 0 && sampleSrcs.length === 0) {
    const o = ctx.createOscillator()
    o.type = params.waveform; o.frequency.value = freq; o.detune.value = params.detune
    const g = ctx.createGain(); g.gain.value = 1
    o.connect(g); g.connect(mix)
    oscs.push(o); oscGains.push(g)
  }
  const allSources: AudioScheduledSourceNode[] = [...oscs, ...sampleSrcs]

  // ADSR relative to the virtual note start, so a mid-note entry continues the
  // envelope from its current value instead of re-triggering the attack.
  const A = params.attack, D = params.decay, S = params.sustain, R = params.release
  const attackEnd  = vStart + A
  const decayEnd   = attackEnd + D
  const releaseAt  = vStart + Math.max(A + D, duration - R)
  const endAt      = releaseAt + R
  const envAt = (t: number) => {
    if (t <= vStart) return 0
    if (t < attackEnd) return vel * (t - vStart) / Math.max(1e-5, A)
    if (t < decayEnd)  return vel * (1 - (1 - S) * (t - attackEnd) / Math.max(1e-5, D))
    if (t < releaseAt) return vel * S
    if (t < endAt)     return vel * S * (1 - (t - releaseAt) / Math.max(1e-5, R))
    return 0
  }
  env.gain.setValueAtTime(envAt(when), when)          // current level (0 for a fresh note)
  if (attackEnd  > when) env.gain.linearRampToValueAtTime(vel, attackEnd)
  if (decayEnd   > when) env.gain.linearRampToValueAtTime(vel * S, decayEnd)
  if (releaseAt  > when) env.gain.setValueAtTime(vel * S, releaseAt)
  env.gain.linearRampToValueAtTime(0, Math.max(endAt, when + 1e-3))

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
  for (let i = 0; i < sampleSrcs.length; i++) {
    sampleSrcs[i].start(when, sampleOffsets[i])   // resume looping sample at the right phase
    sampleSrcs[i].stop(endAt + 0.01)
  }

  // All voices stop together, so one onended cleans up the whole graph.
  allSources[0].onended = () => {
    for (const s of allSources) s.disconnect()
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
  /** Seconds already elapsed into the note (>0 when the playhead enters mid-note).
   *  `duration` is the FULL note length; poly sample layers resume at this phase. */
  offset = 0,
  /** A drawn pitch contour for this note, in absolute context time. Apollo only:
   *  the sampled path applies clip.pitchGraph itself, via src.detune. */
  bend?: { t: number; semis: number }[],
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
    // Choke insert: an explicit group, or hi-hats which auto-choke by default.
    // The voice routes through a flat gain the engine can fade to silence when
    // another pad in the same group fires (open hat cut by closed hat).
    const group = pad?.chokeGroup ?? ((type === 'hihat' || type === 'open-hihat') ? HAT_CHOKE_GROUP : 0)
    let handle: DrumVoiceHandle | undefined
    if (group) {
      const chokeGain = ctx.createGain()
      chokeGain.gain.value = 1
      chokeGain.connect(effectiveDest)
      effectiveDest = chokeGain
      handle = { chokeGroup: group, gain: chokeGain }
    }
    // A baked sample on the pad plays instead of the synth voice.
    if (pad?.sample) {
      const buf = _drumSampleBuf.get(pad.sample.id)
      if (buf) {
        const src = ctx.createBufferSource()
        src.buffer = buf
        if (pad.pitch) src.playbackRate.value = Math.pow(2, pad.pitch / 12)
        const g = ctx.createGain()
        g.gain.value = velocity / 127          // pad volume/pan already in effectiveDest
        src.connect(g); g.connect(effectiveDest)
        src.start(when)
        return handle
      }
      void _decodeDrumSample(ctx, pad.sample)  // warm cache; fall through to synth this hit
    }
    const vel = pad ? (velocity / 127) * pad.volume : velocity / 127
    playDrumHit(ctx, p.pack, type, when, vel, pad?.pitch ? pitch + pad.pitch : undefined, undefined, effectiveDest)
    return handle
  }

  if (instrument.type === 'fm') {
    playFmVoice(ctx, dest, instrument.params as FmInstrumentParams, pitch, velocity, when, duration)
    return
  }

  if (instrument.type === 'poly') {
    playPolyVoice(ctx, dest, instrument.params as PolyInstrumentParams, pitch, velocity, when, duration, offset)
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

  if (instrument.type === 'apollo') {
    // Apollo runs a persistent AudioWorklet engine per track destination and
    // schedules note on/off at absolute context time (offline-render safe).
    playApolloNote(ctx, dest, instrument.params as ApolloInstrumentParams, pitch, velocity, when, duration, bend)
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
