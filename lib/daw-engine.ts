'use client'

import type { DawTrack, DawClip, DawProject, AudioClip, MidiClip, AutomationLane, LaunchQuantization, ClipEffect, AutoPoint, ReturnTrack, MidiEffect, MidiNote, VelocityMidiParams, ScaleMidiParams, ChordMidiParams, ArpMidiParams } from './daw-types'
import { isAudioClip, isMidiClip } from './daw-types'
import { buildEffectsChain, type EffectHandle } from './daw-effects'
import { playInstrumentNote } from './daw-instruments'
import { CLIP_EFFECT_PARAM_META, sampleAutomation, normToParam } from './clip-effect-utils'
import { wsola, extractTrimmed, pitchShiftBuffer } from './wsola'
import { libraryGetAll } from './sound-library'
import { libraryFulfill } from './default-samples'
import type { MidiPreset } from './midi-presets'
import { captureAudioInput } from './audio-capture'

/** One record-setup effect: a type plus its headline parameter value. */
export interface MonitorFx { type: 'volume' | 'filter' | 'reverb' | 'delay' | 'distortion' | 'tremolo'; value: number }

/** Maps a record-setup effect to FX-lane params for the bar added under the take. */
export function monitorFxParams(fx: MonitorFx): Record<string, number> {
  switch (fx.type) {
    case 'volume': return { gain: fx.value }
    case 'filter': return { frequency: fx.value }
    case 'reverb': return { reverbWet: fx.value }
    case 'delay': return { delayWet: fx.value }
    case 'distortion': return { distortion: fx.value }
    case 'tremolo': return { tremoloDepth: fx.value }
  }
}


// Per-track Web Audio routing nodes
interface TrackNodes {
  gain: GainNode
  panner: StereoPannerNode
  analyser: AnalyserNode
  effectsInput: GainNode    // sources connect here
  midiInput: GainNode       // MIDI voices connect here → effectsInput; swapped on stop so ringing notes cut off
  effectsOutput: GainNode   // routes into panner
  sendGains: Map<string, GainNode>     // returnTrackId → send gain (post-fader tap from analyser)
  preSendGains: Map<string, GainNode>  // returnTrackId → send gain (pre-fader tap from effectsOutput)
  sendModes: Map<string, 'pre' | 'post'>
}

// Return track (FX bus) routing nodes
interface ReturnBus {
  input: GainNode         // receives from all send gains
  effectsOutput: GainNode // pass-through (effects chain can be added later)
  gain: GainNode
  panner: StereoPannerNode
}

interface ScheduledSource {
  source: AudioBufferSourceNode
  gainNode: GainNode
  clipId: string
  basePlaybackRate?: number
  tailNodes?: AudioNode[]
  tailOscs?: OscillatorNode[]
  tailTimerId?: ReturnType<typeof setTimeout>
}

interface SessionSlot {
  clip: AudioClip
  source: AudioBufferSourceNode | null
  gainNode: GainNode | null
  startContextTime: number
  loopCount: number
}

// Scheduled MIDI note identity key
type NoteKey = string  // `${clipId}:${noteId}`

const SCHEDULE_LOOKAHEAD = 0.15  // seconds
const SCHEDULER_INTERVAL = 25    // ms

function interpolateAutomation(lane: AutomationLane, beat: number): number {
  if (lane.points.length === 0) {
    return (lane.defaultValue - lane.min) / (lane.max - lane.min)
  }
  const sorted = [...lane.points].sort((a, b) => a.beat - b.beat)
  if (beat <= sorted[0].beat) return sorted[0].value
  if (beat >= sorted[sorted.length - 1].beat) return sorted[sorted.length - 1].value
  for (let i = 1; i < sorted.length; i++) {
    if (beat <= sorted[i].beat) {
      const t = (beat - sorted[i - 1].beat) / (sorted[i].beat - sorted[i - 1].beat)
      return sorted[i - 1].value + t * (sorted[i].value - sorted[i - 1].value)
    }
  }
  return 0
}

export class DawEngine extends EventTarget {
  ctx: AudioContext
  masterGain: GainNode
  masterAnalyser: AnalyserNode
  masterCompressor: DynamicsCompressorNode

  private trackNodes = new Map<string, TrackNodes>()
  private returnBuses = new Map<string, ReturnBus>()
  private effectsChains = new Map<string, ReturnType<typeof buildEffectsChain>>()
  private _chainSigs = new Map<string, string>()
  private returnEffectsChains = new Map<string, ReturnType<typeof buildEffectsChain>>()
  private mixerEqNodes = new Map<string, { sub: BiquadFilterNode; low: BiquadFilterNode; mid: BiquadFilterNode; hi: BiquadFilterNode }>()
  private maskingAnalysers = new Map<string, AnalyserNode>()
  private maskingBridges   = new Map<string, GainNode>()
  varispeedRate = 1.0
  bufferCache = new Map<string, AudioBuffer>()
  private stretchedBufferCache = new Map<string, AudioBuffer>()
  private pitchShiftCache      = new Map<string, AudioBuffer>()
  private boomerangCache       = new Map<string, AudioBuffer>()

  private scheduledSources: ScheduledSource[] = []
  private schedulerHandle: ReturnType<typeof setInterval> | null = null
  private metronomeHandle: ReturnType<typeof setInterval> | null = null

  // Session launch
  private _sessionQueue      = new Map<string, { clip: AudioClip; launchCtxTime: number }>()
  private _sessionMidiQueue  = new Map<string, { clip: MidiClip; launchCtxTime: number }>()
  private _sessionSlots      = new Map<string, SessionSlot>()
  private _sessionMidiSlots  = new Map<string, { clip: MidiClip; startCtxTime: number; intervalId: ReturnType<typeof setInterval> }>()
  launchQuantization: LaunchQuantization = 'bar'

  // Session-only clock (runs independent of arrangement transport)
  private _sessionClockStartCtxTime = 0
  private _sessionClockRunning      = false
  private _sessionTickHandle: ReturnType<typeof setInterval> | null = null

  // MIDI scheduling
  private _scheduledNoteKeys = new Set<NoteKey>()
  private _noteKeyVersion   = 0

  // MIDI preset playback
  private _presets:         MidiPreset[] = []
  private _presetBufCache = new Map<string, AudioBuffer | null>()   // key: `${presetId}:${pitch}`
  private _presetLoading  = new Set<string>()

  setPresets(presets: MidiPreset[]) { this._presets = presets }

  // Transport
  isPlaying = false
  isRecording = false
  tempo = 120
  loopEnabled = false
  loopStart = 0
  loopEnd = 16
  swing = 0
  private _beatsPerBar = 4

  private _startCtxTime = 0
  private _startBeat    = 0

  private _clips: AudioClip[] = []
  private _midiClips: MidiClip[] = []
  private _tracks: DawTrack[] = []
  private _automationLanes: AutomationLane[] = []
  private _clipEffects: ClipEffect[] = []
  private _irCache = new Map<number, AudioBuffer>()

  // Metronome
  private _tickBuf: AudioBuffer | null = null
  private _tockBuf: AudioBuffer | null = null
  private _nextMetronomeBeat = 0

  // Jam buffer (rolling ~35s of master output)
  isJamActive = false
  private _jamCaptureNode: MediaStreamAudioDestinationNode | null = null
  private _jamRecorder: MediaRecorder | null = null
  private _jamChunks: Array<{ blob: Blob; ts: number }> = []
  private _jamHeaderChunk: Blob | null = null
  private _jamMime = ''

  constructor() {
    super()
    this.ctx = new AudioContext({ latencyHint: 'interactive' })

    // Safety compressor, not glue: -12dB/3:1 clamped the whole mix whenever a
    // sustained loud element (stacked drones, held chords) sat above threshold,
    // audibly ducking every other instrument for its entire duration. Higher
    // threshold + gentler ratio only catches true overloads.
    this.masterCompressor = this.ctx.createDynamicsCompressor()
    this.masterCompressor.threshold.value = -6
    this.masterCompressor.knee.value = 10
    this.masterCompressor.ratio.value = 2.5
    this.masterCompressor.attack.value = 0.003
    this.masterCompressor.release.value = 0.25
    this.masterCompressor.connect(this.ctx.destination)

    this.masterAnalyser = this.ctx.createAnalyser()
    this.masterAnalyser.fftSize = 256
    this.masterAnalyser.connect(this.masterCompressor)

    this.masterGain = this.ctx.createGain()
    this.masterGain.gain.value = 0.85
    this.masterGain.connect(this.masterAnalyser)

    this._buildMetronomeBuffers()

    // Only one window plays at a time (Spotify semantics). Community links
    // open the studio in new tabs, so it's easy to end up with a forgotten
    // tab still looping a project — audible, duplicated, and unpausable from
    // the window you're looking at. When any engine starts, every other
    // engine that's sounding stops itself.
    try {
      this._exclusiveChan = new BroadcastChannel('100lights-transport')
      this._exclusiveChan.onmessage = (e: MessageEvent<{ type: string; id: string }>) => {
        if (e.data?.type === 'playing' && e.data.id !== this._engineId) {
          if (this.isPlaying) this.stop()
          else this._stopAllSessionSlots()
        }
      }
    } catch { /* BroadcastChannel unavailable (tests) */ }
  }

  private _engineId = crypto.randomUUID()
  private _exclusiveChan: BroadcastChannel | null = null
  private _announcePlayback() {
    try { this._exclusiveChan?.postMessage({ type: 'playing', id: this._engineId }) } catch { /* ok */ }
  }

  // ── Track routing ──────────────────────────────────────────────────────────

  ensureTrack(id: string, effects?: DawTrack['effects']) {
    if (this.ctx.state === 'closed') return
    if (!this.trackNodes.has(id)) {
      const effectsInput  = this.ctx.createGain()
      const midiInput     = this.ctx.createGain()
      midiInput.connect(effectsInput)
      const effectsOutput = this.ctx.createGain()
      const gain          = this.ctx.createGain()
      const panner        = this.ctx.createStereoPanner()
      const analyser      = this.ctx.createAnalyser()
      analyser.fftSize = 256

      // Mixer / tone EQ: 4-band (sub + bass/mid/treble) inserted between effects output and volume fader
      const eqSub = this.ctx.createBiquadFilter()
      eqSub.type = 'lowshelf'; eqSub.frequency.value = 70; eqSub.gain.value = 0
      const eqLow = this.ctx.createBiquadFilter()
      eqLow.type = 'lowshelf'; eqLow.frequency.value = 200; eqLow.gain.value = 0
      const eqMid = this.ctx.createBiquadFilter()
      eqMid.type = 'peaking'; eqMid.frequency.value = 1000; eqMid.Q.value = 1; eqMid.gain.value = 0
      const eqHi = this.ctx.createBiquadFilter()
      eqHi.type = 'highshelf'; eqHi.frequency.value = 8000; eqHi.gain.value = 0

      effectsOutput.connect(eqSub)
      eqSub.connect(eqLow)
      eqLow.connect(eqMid)
      eqMid.connect(eqHi)
      eqHi.connect(gain)
      gain.connect(panner)
      panner.connect(analyser)
      analyser.connect(this.masterGain)

      this.mixerEqNodes.set(id, { sub: eqSub, low: eqLow, mid: eqMid, hi: eqHi })

      // Create a send gain for every existing return bus (start at 0)
      const sendGains    = new Map<string, GainNode>()
      const preSendGains = new Map<string, GainNode>()
      const sendModes    = new Map<string, 'pre' | 'post'>()
      for (const [returnId, bus] of this.returnBuses) {
        const sendGain = this.ctx.createGain(); sendGain.gain.value = 0
        analyser.connect(sendGain); sendGain.connect(bus.input)
        sendGains.set(returnId, sendGain)
        const preSend = this.ctx.createGain(); preSend.gain.value = 0
        effectsOutput.connect(preSend); preSend.connect(bus.input)
        preSendGains.set(returnId, preSend)
        sendModes.set(returnId, 'post')
      }

      this.trackNodes.set(id, { gain, panner, analyser, effectsInput, midiInput, effectsOutput, sendGains, preSendGains, sendModes })

      // High-res analyser for masking detection — separate from VU meter analyser
      const maskingAnalyser = this.ctx.createAnalyser()
      maskingAnalyser.fftSize = 2048
      const maskBridge = this.ctx.createGain()
      maskBridge.gain.value = 0
      panner.connect(maskingAnalyser)
      maskingAnalyser.connect(maskBridge)
      maskBridge.connect(this.ctx.destination)
      this.maskingAnalysers.set(id, maskingAnalyser)
      this.maskingBridges.set(id, maskBridge)
    }

    // (Re)build effects chain when effects array is provided — but only when
    // it actually changed. Rebuilding on every dispatch cuts delay/reverb
    // tails and churns the graph audibly (worst while dragging BPM, which
    // fires updateProject per step). Tempo joins the signature only when a
    // delay is tempo-synced, since that's the one tempo-dependent build.
    if (effects !== undefined) {
      const tempoDependent = effects.some(e => e.type === 'delay' && (e.params as { syncToTempo?: boolean }).syncToTempo)
      const sig = JSON.stringify(effects) + (tempoDependent ? `@${this.tempo}` : '')
      if (this._chainSigs.get(id) !== sig) {
        this._chainSigs.set(id, sig)
        this._rebuildEffectsChain(id, effects)
      }
    }
  }

  private _rebuildEffectsChain(trackId: string, effects: DawTrack['effects']) {
    const nodes = this.trackNodes.get(trackId)
    if (!nodes) return

    // Tear down old routing — ALWAYS disconnect effectsInput, not only when a
    // chain object exists: the zero-effects state wires effectsInput straight
    // to effectsOutput, and leaving that in place when the first effect is
    // added creates a dry bypass in parallel with the new chain (effects
    // audibly "do nothing").
    try { nodes.effectsInput.disconnect() } catch { /* ok */ }
    const old = this.effectsChains.get(trackId)
    if (old) {
      old.dispose()
      this.effectsChains.delete(trackId)
    }

    if (effects.length === 0) {
      nodes.effectsInput.connect(nodes.effectsOutput)
      return
    }

    const chain = buildEffectsChain(this.ctx, effects, this.tempo)
    nodes.effectsInput.connect(chain.input)
    chain.output.connect(nodes.effectsOutput)
    this.effectsChains.set(trackId, chain)
    this._wireSidechains(trackId, effects)
  }

  private _wireSidechains(trackId: string, effects: DawTrack['effects']) {
    const chain = this.effectsChains.get(trackId)
    if (!chain) return
    for (const effect of effects) {
      if (effect.type !== 'compressor') continue
      const p = effect.params as import('./daw-types').CompressorParams
      if (!p.sidechainTrackId) continue
      const handle = chain.handles.get(effect.id)
      if (!handle?.keyInput) continue
      const srcNodes = this.trackNodes.get(p.sidechainTrackId)
      if (srcNodes) srcNodes.analyser.connect(handle.keyInput)
    }
  }

  getEffectHandle(trackId: string, effectId: string): EffectHandle | undefined {
    return this.effectsChains.get(trackId)?.handles.get(effectId)
  }

  removeTrack(id: string) {
    this._chainSigs.delete(id)
    const nodes = this.trackNodes.get(id)
    if (!nodes) return
    const chain = this.effectsChains.get(id)
    if (chain) { chain.dispose(); this.effectsChains.delete(id) }
    const eq = this.mixerEqNodes.get(id)
    if (eq) {
      try { eq.sub.disconnect() } catch { /* ok */ }
      try { eq.low.disconnect() } catch { /* ok */ }
      try { eq.mid.disconnect() } catch { /* ok */ }
      try { eq.hi.disconnect() } catch { /* ok */ }
      this.mixerEqNodes.delete(id)
    }
    for (const sg of nodes.sendGains.values())    { try { sg.disconnect() } catch { /* ok */ } }
    for (const sg of nodes.preSendGains.values()) { try { sg.disconnect() } catch { /* ok */ } }
    nodes.gain.disconnect()
    nodes.panner.disconnect()
    nodes.analyser.disconnect()
    nodes.effectsInput.disconnect()
    nodes.effectsOutput.disconnect()
    this.trackNodes.delete(id)
    const masking = this.maskingAnalysers.get(id)
    if (masking) { try { masking.disconnect() } catch { /* ok */ } this.maskingAnalysers.delete(id) }
    const maskBridge = this.maskingBridges.get(id)
    if (maskBridge) { try { maskBridge.disconnect() } catch { /* ok */ } this.maskingBridges.delete(id) }
  }

  ensureReturnTrack(id: string, volume: number, pan: number, mute: boolean, effects?: ReturnTrack['effects']) {
    if (this.ctx.state === 'closed') return
    if (this.returnBuses.has(id)) {
      const bus = this.returnBuses.get(id)!
      bus.gain.gain.setTargetAtTime(mute ? 0 : volume, this.ctx.currentTime, 0.01)
      bus.panner.pan.setTargetAtTime(pan, this.ctx.currentTime, 0.01)
      if (effects !== undefined) this._rebuildReturnEffectsChain(id, effects)
      return
    }
    const input         = this.ctx.createGain()
    const effectsOutput = this.ctx.createGain()
    const gain          = this.ctx.createGain()
    const panner        = this.ctx.createStereoPanner()
    input.connect(effectsOutput)
    effectsOutput.connect(gain)
    gain.connect(panner)
    panner.connect(this.masterGain)
    gain.gain.value  = mute ? 0 : volume
    panner.pan.value = pan
    this.returnBuses.set(id, { input, effectsOutput, gain, panner })

    // Wire every existing track's post-fader analyser (and pre-fader effectsOutput) into this return bus
    for (const [, nodes] of this.trackNodes) {
      const sendGain = this.ctx.createGain(); sendGain.gain.value = 0
      nodes.analyser.connect(sendGain); sendGain.connect(input)
      nodes.sendGains.set(id, sendGain)
      const preSend = this.ctx.createGain(); preSend.gain.value = 0
      nodes.effectsOutput.connect(preSend); preSend.connect(input)
      nodes.preSendGains.set(id, preSend)
      nodes.sendModes.set(id, 'post')
    }

    if (effects !== undefined) this._rebuildReturnEffectsChain(id, effects)
  }

  private _rebuildReturnEffectsChain(returnId: string, effects: ReturnTrack['effects']) {
    const bus = this.returnBuses.get(returnId)
    if (!bus) return

    const old = this.returnEffectsChains.get(returnId)
    try { bus.input.disconnect() } catch { /* ok */ }
    if (old) { old.dispose(); this.returnEffectsChains.delete(returnId) }

    if (effects.length === 0) {
      bus.input.connect(bus.effectsOutput)
      return
    }

    const chain = buildEffectsChain(this.ctx, effects, this.tempo)
    bus.input.connect(chain.input)
    chain.output.connect(bus.effectsOutput)
    this.returnEffectsChains.set(returnId, chain)
  }

  getReturnEffectHandle(returnId: string, effectId: string): EffectHandle | undefined {
    return this.returnEffectsChains.get(returnId)?.handles.get(effectId)
  }

  removeReturnTrack(id: string) {
    const chain = this.returnEffectsChains.get(id)
    if (chain) { chain.dispose(); this.returnEffectsChains.delete(id) }
    const bus = this.returnBuses.get(id)
    if (!bus) return
    for (const nodes of this.trackNodes.values()) {
      const sg = nodes.sendGains.get(id)
      if (sg) { try { sg.disconnect() } catch { /* ok */ } nodes.sendGains.delete(id) }
      const psg = nodes.preSendGains.get(id)
      if (psg) { try { psg.disconnect() } catch { /* ok */ } nodes.preSendGains.delete(id) }
      nodes.sendModes.delete(id)
    }
    try { bus.input.disconnect() } catch { /* ok */ }
    try { bus.effectsOutput.disconnect() } catch { /* ok */ }
    try { bus.gain.disconnect() } catch { /* ok */ }
    try { bus.panner.disconnect() } catch { /* ok */ }
    this.returnBuses.delete(id)
  }

  setSendAmount(trackId: string, returnId: string, amount: number) {
    this._setSendAmount(trackId, returnId, amount, 'post')
  }

  private _setSendAmount(trackId: string, returnId: string, amount: number, mode: 'pre' | 'post') {
    const nodes = this.trackNodes.get(trackId)
    if (!nodes) return
    const prevMode = nodes.sendModes.get(returnId) ?? 'post'
    nodes.sendModes.set(returnId, mode)
    const t = this.ctx.currentTime
    if (mode === 'pre') {
      nodes.sendGains.get(returnId)?.gain.setTargetAtTime(0, t, 0.01)
      nodes.preSendGains.get(returnId)?.gain.setTargetAtTime(amount, t, 0.01)
    } else {
      if (prevMode === 'pre') nodes.preSendGains.get(returnId)?.gain.setTargetAtTime(0, t, 0.01)
      nodes.sendGains.get(returnId)?.gain.setTargetAtTime(amount, t, 0.01)
    }
  }

  setReturnVolume(id: string, volume: number) {
    const bus = this.returnBuses.get(id)
    if (bus) bus.gain.gain.setTargetAtTime(volume, this.ctx.currentTime, 0.01)
  }

  setReturnPan(id: string, pan: number) {
    const bus = this.returnBuses.get(id)
    if (bus) bus.panner.pan.setTargetAtTime(pan, this.ctx.currentTime, 0.01)
  }

  // "My mix": per-track local gain multipliers that never touch project state —
  // each collaborator can rebalance their own headphones without moving the
  // shared faders. Multiplied into every volume write below.
  private _localMix = new Map<string, number>()
  private _baseVol  = new Map<string, number>()

  setLocalTrackGain(id: string, mult: number) {
    if (Math.abs(mult - 1) < 0.001) this._localMix.delete(id)
    else this._localMix.set(id, mult)
    const nodes = this.trackNodes.get(id)
    if (nodes) nodes.gain.gain.setTargetAtTime((this._baseVol.get(id) ?? 1) * mult, this.ctx.currentTime, 0.01)
  }

  getLocalTrackGain(id: string): number {
    return this._localMix.get(id) ?? 1
  }

  setTrackVolume(id: string, volume: number) {
    this._baseVol.set(id, volume)
    const nodes = this.trackNodes.get(id)
    if (nodes) nodes.gain.gain.setTargetAtTime(volume * (this._localMix.get(id) ?? 1), this.ctx.currentTime, 0.01)
  }

  setTrackPan(id: string, pan: number) {
    const nodes = this.trackNodes.get(id)
    if (nodes) nodes.panner.pan.setTargetAtTime(pan, this.ctx.currentTime, 0.01)
  }

  /** Engine-local loop switch (project state untouched) — export passes must run to the end. */
  setLoopEnabled(v: boolean) { this.loopEnabled = v }

  setMasterVolume(v: number) {
    this.masterGain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02)
  }

  setMixerEq(trackId: string, low: number, mid: number, high: number) {
    const eq = this.mixerEqNodes.get(trackId)
    if (!eq) return
    const t = this.ctx.currentTime
    eq.low.gain.setTargetAtTime(low, t, 0.01)
    eq.mid.gain.setTargetAtTime(mid, t, 0.01)
    eq.hi.gain.setTargetAtTime(high, t, 0.01)
  }

  getMixerEq(trackId: string): { low: number; mid: number; hi: number } {
    const eq = this.mixerEqNodes.get(trackId)
    if (!eq) return { low: 0, mid: 0, hi: 0 }
    return { low: eq.low.gain.value, mid: eq.mid.gain.value, hi: eq.hi.gain.value }
  }

  // Per-track 4-band tone EQ (persisted on the track). All values in dB.
  setTrackTone(trackId: string, tone?: { sub?: number; bass?: number; mid?: number; treble?: number }) {
    const eq = this.mixerEqNodes.get(trackId)
    if (!eq) return
    const t = this.ctx.currentTime
    eq.sub.gain.setTargetAtTime(tone?.sub ?? 0, t, 0.01)
    eq.low.gain.setTargetAtTime(tone?.bass ?? 0, t, 0.01)
    eq.mid.gain.setTargetAtTime(tone?.mid ?? 0, t, 0.01)
    eq.hi.gain.setTargetAtTime(tone?.treble ?? 0, t, 0.01)
  }

  getTrackAnalyser(trackId: string): AnalyserNode | null {
    return this.trackNodes.get(trackId)?.analyser ?? null
  }

  setPlaybackRate(rate: number) {
    this.varispeedRate = Math.max(0.25, Math.min(2.0, rate))
    for (const entry of this.scheduledSources) {
      const base = entry.basePlaybackRate ?? 1.0
      try { entry.source.playbackRate.value = base * this.varispeedRate } catch { /* source may have ended */ }
    }
  }

  getTrackLevel(id: string): Uint8Array | null {
    const nodes = this.trackNodes.get(id)
    if (!nodes) return null
    const data = new Uint8Array(nodes.analyser.frequencyBinCount)
    nodes.analyser.getByteTimeDomainData(data)
    return data
  }

  getMasterLevel(): Uint8Array {
    const data = new Uint8Array(this.masterAnalyser.frequencyBinCount)
    this.masterAnalyser.getByteTimeDomainData(data)
    return data
  }

  // ── Buffer loading ─────────────────────────────────────────────────────────

  async loadClipBuffer(clip: AudioClip): Promise<AudioBuffer | null> {
    if (this.bufferCache.has(clip.id)) return this.bufferCache.get(clip.id)!
    // Concurrent callers (pre-warm + scheduler + UI) share one in-flight load —
    // returning null to the second caller while the first is mid-fetch made
    // audio look undecodable.
    const inFlight = this._loadInFlight.get(clip.id)
    if (inFlight) return inFlight
    const p = this._loadClipBufferInner(clip).finally(() => { this._loadInFlight.delete(clip.id) })
    this._loadInFlight.set(clip.id, p)
    return p
  }
  private _loadInFlight = new Map<string, Promise<AudioBuffer | null>>()

  private async _loadClipBufferInner(clip: AudioClip): Promise<AudioBuffer | null> {
    // Try the local URL first (blob: for fresh recordings, signed URL for
    // imports). A collaborator receives clips whose blob: URLs belong to
    // another browser — those fail, and we fall back to the clip's r2Key.
    const tryUrl = async (url: string): Promise<AudioBuffer | null> => {
      try {
        const res = await fetch(url)
        if (!res.ok) return null
        const ab  = await res.arrayBuffer()
        const buf = await this.ctx.decodeAudioData(ab)
        this.bufferCache.set(clip.id, buf)
        return buf
      } catch {
        return null
      }
    }
    if (clip.audioUrl) {
      const buf = await tryUrl(clip.audioUrl)
      if (buf) return buf
    }
    if (clip.r2Key) {
      try {
        const res = await fetch(`/api/media/signed-url?key=${encodeURIComponent(clip.r2Key)}`)
        if (res.ok) {
          const { url } = await res.json() as { url: string }
          return await tryUrl(url)
        }
      } catch { /* fall through */ }
    }
    // Sound-library fallback: pad bounces carry the source entry's id, and
    // older saves can often be rescued from the clip name ("Pad – Folder –
    // Name"), since pad clips were never uploaded before libraryId existed.
    const fromEntry = async (entry: { audioBlob?: Blob } | null): Promise<AudioBuffer | null> => {
      if (!entry?.audioBlob) return null
      try {
        const buf = await this.ctx.decodeAudioData(await entry.audioBlob.arrayBuffer())
        this.bufferCache.set(clip.id, buf)
        return buf
      } catch { return null }
    }
    try {
      const { libraryFulfill } = await import('./default-samples')
      if (clip.libraryId) {
        const buf = await fromEntry(await libraryFulfill(clip.libraryId))
        if (buf) return buf
      }
      // Name-based rescue is a last resort for OLD saves only, and it must
      // never guess: a wrong match plays audio that isn't on the track.
      //  - clips that had a real source (r2Key) stay silent on failure rather
      //    than being substituted (the failure may be transient)
      //  - recorder-generated names are never library entries
      //  - the match must be unambiguous (exactly one candidate)
      if (!clip.r2Key && !/^(Recording|Jam Capture|MIDI Capture|Morph)$|recording$/i.test(clip.name.trim())) {
        const parts = clip.name.split(' – ')
        const { libraryGetAll } = await import('./sound-library')
        const all = await libraryGetAll()
        const candidates = parts.length >= 3
          ? all.filter(e => e.folder === parts[1] && e.name === parts[2])
          : all.filter(e => e.name === clip.name)
        if (candidates.length === 1) {
          const buf = await fromEntry(await libraryFulfill(candidates[0].id))
          if (buf) return buf
        }
      }
    } catch { /* library unavailable (SSR/tests) */ }
    return null
  }

  evictBuffer(clipId: string) { this.bufferCache.delete(clipId) }

  async loadBufferFromArrayBuffer(clipId: string, ab: ArrayBuffer): Promise<AudioBuffer> {
    const buf = await this.ctx.decodeAudioData(ab)
    this.bufferCache.set(clipId, buf)
    return buf
  }

  // ── Transport ──────────────────────────────────────────────────────────────

  get currentBeat(): number {
    if (!this.isPlaying) return this._startBeat
    return this._startBeat + (this.ctx.currentTime - this._startCtxTime) * (this.tempo / 60)
  }

  beatsToSeconds(beats: number): number { return beats * (60 / this.tempo) }
  secondsToBeats(seconds: number): number { return seconds * (this.tempo / 60) }

  async play(fromBeat?: number) {
    if (this.ctx.state === 'suspended') await this.ctx.resume()
    if (fromBeat !== undefined) this._startBeat = fromBeat
    this._startCtxTime = this.ctx.currentTime
    this.isPlaying = true
    this._nextMetronomeBeat = Math.ceil(this._startBeat)
    this._noteKeyVersion++; this._scheduledNoteKeys.clear()
    this._startScheduler()
    this.startJamBuffer()
    this._announcePlayback()
    this.dispatchEvent(new CustomEvent('transport', { detail: { playing: true, beat: this._startBeat } }))
  }

  stop() {
    this._startBeat = this.currentBeat  // preserve position (pause, not rewind)
    this.isPlaying = false
    this._stopScheduler()
    this._killAllSources()
    this._stopAllSessionSlots()
    this._noteKeyVersion++; this._scheduledNoteKeys.clear()
    this.dispatchEvent(new CustomEvent('transport', { detail: { playing: false, beat: this._startBeat } }))
  }

  seek(beat: number) {
    const wasPlaying = this.isPlaying
    if (wasPlaying) { this._killAllSources(); this._stopScheduler() }
    this._startBeat = beat
    if (wasPlaying) {
      this._startCtxTime = this.ctx.currentTime
      this._nextMetronomeBeat = Math.ceil(beat)
      this._noteKeyVersion++; this._scheduledNoteKeys.clear()
      this._startScheduler()
    }
    this.dispatchEvent(new CustomEvent('seek', { detail: { beat } }))
  }

  get isClosed(): boolean { return this.ctx.state === 'closed' }

  updateProject(project: DawProject) {
    if (this.ctx.state === 'closed') return
    if (project.tempo !== this.tempo) {
      // Rebase the transport clock BEFORE swapping tempo: currentBeat is
      // startBeat + elapsed × (tempo/60), so changing the multiplier without
      // rebasing re-scales the whole elapsed time — the playhead leaps, and a
      // backward leap makes the scheduler re-fire clips on top of their
      // still-playing sources (stacking louder with every BPM nudge).
      const beatNow = this.currentBeat
      const sessionNow = this._sessionClockRunning ? this._sessionBeat() : null
      this.tempo = project.tempo
      if (this.isPlaying) {
        this._startBeat = beatNow
        this._startCtxTime = this.ctx.currentTime
      }
      if (sessionNow !== null) {
        this._sessionClockStartCtxTime = this.ctx.currentTime - sessionNow * (60 / this.tempo)
      }
    }
    this.loopEnabled  = project.loopEnabled
    this.loopStart    = project.loopStart
    this.loopEnd      = project.loopEnd
    this.swing        = project.swing ?? 0
    this._beatsPerBar = project.timeSignatureNum ?? 4
    this._clips       = project.arrangementClips.filter(isAudioClip)
    this._midiClips   = project.arrangementClips.filter(isMidiClip)
    // Pre-warm audio buffers too: clips resolving through slow paths (r2,
    // library fallback) were silent for the first pass after a reload and
    // "appeared" a few plays later once their buffer finally cached.
    for (const clip of this._clips) {
      if (!this.bufferCache.has(clip.id)) void this.loadClipBuffer(clip)
    }
    // Pre-warm preset buffers for every note so the first playthrough sounds.
    // Loading lazily from the scheduler misses the note: by the time the
    // buffer resolves, the playhead has already passed it.
    const sessionMidi = Object.values(project.sessionGrid ?? {})
      .flatMap(row => row ?? [])
      .filter((c): c is MidiClip => !!c && isMidiClip(c))
    for (const clip of [...this._midiClips, ...sessionMidi]) {
      if (!clip.presetId) continue
      for (const note of clip.notes) {
        if (!this._presetBufCache.has(`${clip.presetId}:${note.pitch}`)) {
          void this._loadPresetBuffer(clip.presetId, note.pitch)
        }
      }
    }
    this._tracks      = project.tracks
    this._automationLanes = project.automationLanes ?? []
    this._clipEffects     = project.clipEffects ?? []
    this.setMasterVolume(project.masterVolume)

    // Sync return buses first so send gains can connect on new track creation
    for (const rt of project.returnTracks ?? []) {
      this.ensureReturnTrack(rt.id, rt.volume, rt.pan, rt.mute, rt.effects)
    }
    for (const id of this.returnBuses.keys()) {
      if (!(project.returnTracks ?? []).find(rt => rt.id === id)) this.removeReturnTrack(id)
    }

    const anySoloed     = project.tracks.some(t => t.solo)
    const returnTracks  = project.returnTracks ?? []
    for (const t of project.tracks) {
      this.ensureTrack(t.id, t.effects)
      const silenced = t.mute || (anySoloed && !t.solo)
      this.setTrackVolume(t.id, silenced ? 0 : t.volume)
      this.setTrackPan(t.id, t.pan)
      this.setTrackTone(t.id, t.tone)
      for (const rt of returnTracks) {
        const amount = t.sendAmounts?.[rt.id] ?? 0
        const mode   = t.sendModes?.[rt.id] ?? 'post'
        this._setSendAmount(t.id, rt.id, amount, mode)
      }
    }
    // Solo-safe: silence returns during solo unless soloSafe is set
    for (const rt of returnTracks) {
      const bus = this.returnBuses.get(rt.id)
      if (!bus) continue
      const silenced = rt.mute || (anySoloed && !rt.soloSafe)
      bus.gain.gain.value = silenced ? 0 : rt.volume
    }
    for (const id of this.trackNodes.keys()) {
      if (!project.tracks.find(t => t.id === id)) this.removeTrack(id)
    }
  }

  // ── Session launch (quantized) ─────────────────────────────────────────────

  private _nextQuantBeat(): number {
    const now = this.currentBeat
    const bpb = this._beatsPerBar
    switch (this.launchQuantization) {
      case 'none':  return now
      case 'beat':  return Math.ceil(now)
      case '2bar':  return Math.ceil(now / (bpb * 2)) * (bpb * 2)
      case '4bar':  return Math.ceil(now / (bpb * 4)) * (bpb * 4)
      case 'bar':
      default:      return Math.ceil(now / bpb) * bpb
    }
  }

  // Beat position within the session clock (independent of arrangement transport)
  private _sessionBeat(): number {
    if (!this._sessionClockRunning) return 0
    return (this.ctx.currentTime - this._sessionClockStartCtxTime) * (this.tempo / 60)
  }

  // Next quantized beat on the session clock, returns ctx time
  private _nextSessionQuantCtxTime(q: LaunchQuantization): number {
    if (!this._sessionClockRunning) return this.ctx.currentTime  // immediate
    const now    = this._sessionBeat()
    const bpb    = this._beatsPerBar
    let nextBeat: number
    switch (q) {
      case 'none':  nextBeat = now; break
      case 'beat':  nextBeat = Math.ceil(now); break
      case '2bar':  nextBeat = Math.ceil(now / (bpb * 2)) * (bpb * 2); break
      case '4bar':  nextBeat = Math.ceil(now / (bpb * 4)) * (bpb * 4); break
      case 'bar':
      default:      nextBeat = Math.ceil(now / bpb) * bpb; break
    }
    return this._sessionClockStartCtxTime + nextBeat * (60 / this.tempo)
  }

  private _ensureSessionTicker() {
    if (this._sessionTickHandle !== null) return
    this._sessionTickHandle = setInterval(() => this._sessionTick(), SCHEDULER_INTERVAL)
  }

  private _stopSessionTicker() {
    if (this._sessionTickHandle !== null) {
      clearInterval(this._sessionTickHandle)
      this._sessionTickHandle = null
    }
  }

  private _sessionTick() {
    const now = this.ctx.currentTime
    for (const [trackId, queued] of this._sessionQueue.entries()) {
      if (now + SCHEDULE_LOOKAHEAD >= queued.launchCtxTime) {
        this._launchSessionSlot(trackId, queued.clip, queued.launchCtxTime)
        this._sessionQueue.delete(trackId)
      }
    }
    for (const [trackId, queued] of this._sessionMidiQueue.entries()) {
      if (now + SCHEDULE_LOOKAHEAD >= queued.launchCtxTime) {
        this._launchSessionMidiSlot(trackId, queued.clip, queued.launchCtxTime)
        this._sessionMidiQueue.delete(trackId)
      }
    }
    const hasActive = this._sessionQueue.size > 0 || this._sessionSlots.size > 0
                   || this._sessionMidiQueue.size > 0 || this._sessionMidiSlots.size > 0
    if (!hasActive) {
      this._stopSessionTicker()
      this._sessionClockRunning = false
    }
  }

  async queueSession(trackId: string, clip: AudioClip, quantOverride?: LaunchQuantization) {
    if (this.ctx.state === 'suspended') await this.ctx.resume()

    // Toggle off if this clip is already playing
    const playing = this._sessionSlots.get(trackId)
    if (playing && playing.clip.id === clip.id) {
      this._stopSessionTrack(trackId)
      return
    }

    // Preload buffer
    await this.loadClipBuffer(clip)

    const q = quantOverride ?? this.launchQuantization
    let launchCtxTime: number

    if (this.isPlaying) {
      // Quantize against the running arrangement transport
      const savedQ = quantOverride ? this.launchQuantization : undefined
      if (quantOverride) this.launchQuantization = quantOverride
      const launchBeat = this._nextQuantBeat()
      if (savedQ !== undefined) this.launchQuantization = savedQ
      launchCtxTime = this.ctx.currentTime + this.beatsToSeconds(launchBeat - this.currentBeat)
    } else if (this._sessionClockRunning) {
      // Quantize against the running session clock
      launchCtxTime = this._nextSessionQuantCtxTime(q)
    } else {
      // First clip — start session clock now and launch immediately
      this._sessionClockStartCtxTime = this.ctx.currentTime
      this._sessionClockRunning      = true
      launchCtxTime                  = this.ctx.currentTime
    }
    this._announcePlayback()

    this._sessionQueue.set(trackId, { clip, launchCtxTime })
    this._ensureSessionTicker()

    this.dispatchEvent(new CustomEvent('session-state', {
      detail: { trackId, clipId: clip.id, state: 'queued' },
    }))
  }

  stopSessionTrack(trackId: string) { this._stopSessionTrack(trackId) }

  private _stopSessionTrack(trackId: string) {
    const slot = this._sessionSlots.get(trackId)
    if (slot) {
      const now = this.ctx.currentTime
      if (slot.gainNode) {
        slot.gainNode.gain.setTargetAtTime(0, now, 0.01)
      }
      setTimeout(() => {
        try { slot.source?.stop() } catch { /* ok */ }
        slot.source?.disconnect()
        slot.gainNode?.disconnect()
      }, 50)
      const clipId = slot.clip.id
      this._sessionSlots.delete(trackId)
      this.dispatchEvent(new CustomEvent('session-state', {
        detail: { trackId, clipId, state: 'idle' },
      }))
    }
    this._sessionQueue.delete(trackId)
  }

  private _launchSessionSlot(trackId: string, clip: AudioClip, launchCtxTime: number) {
    const buf = this.bufferCache.get(clip.id)
    if (!buf) return

    this.ensureTrack(trackId)
    const nodes = this.trackNodes.get(trackId)!

    // Stop any currently playing slot
    const existing = this._sessionSlots.get(trackId)
    if (existing) {
      try { existing.source?.stop() } catch { /* ok */ }
      existing.source?.disconnect()
      existing.gainNode?.disconnect()
    }

    const source    = this.ctx.createBufferSource()
    const gainNode  = this.ctx.createGain()
    source.buffer   = buf
    source.loop     = clip.loopEnabled
    if (clip.loopEnabled) {
      source.loopStart = clip.trimStart
      source.loopEnd   = buf.duration - clip.trimEnd
    }
    gainNode.gain.value = clip.gain
    source.connect(gainNode)
    gainNode.connect(nodes.effectsInput)

    const contextNow = this.ctx.currentTime
    const duration   = buf.duration - clip.trimStart - clip.trimEnd
    // If we're past the launch time (scheduled ahead), offset into the clip so the
    // first loop boundary stays aligned with the session clock
    const elapsed = Math.max(0, contextNow - launchCtxTime)
    const offset  = clip.trimStart + (elapsed % duration)
    const startAt = Math.max(contextNow, launchCtxTime)

    source.start(startAt, offset, clip.loopEnabled ? undefined : duration - (elapsed % duration))

    const slot: SessionSlot = {
      clip, source, gainNode,
      startContextTime: startAt,
      loopCount: 0,
    }
    this._sessionSlots.set(trackId, slot)

    source.onended = () => {
      source.disconnect()
      gainNode.disconnect()
      if (this._sessionSlots.get(trackId)?.source === source) {
        this._sessionSlots.delete(trackId)
        this.dispatchEvent(new CustomEvent('session-state', {
          detail: { trackId, clipId: clip.id, state: 'idle' },
        }))
      }
    }

    this.dispatchEvent(new CustomEvent('session-state', {
      detail: { trackId, clipId: clip.id, state: 'playing' },
    }))
  }

  private _stopAllSessionSlots() {
    for (const trackId of this._sessionSlots.keys()) {
      this._stopSessionTrack(trackId)
    }
    for (const trackId of [...this._sessionMidiSlots.keys()]) {
      this._stopSessionMidiTrack(trackId)
    }
    this._sessionQueue.clear()
    this._sessionMidiQueue.clear()
    this._stopSessionTicker()
    this._sessionClockRunning = false
  }

  async queueSessionMidi(trackId: string, clip: MidiClip, quantOverride?: LaunchQuantization) {
    if (this.ctx.state === 'suspended') await this.ctx.resume()

    const playing = this._sessionMidiSlots.get(trackId)
    if (playing && playing.clip.id === clip.id) {
      this._stopSessionMidiTrack(trackId)
      return
    }

    const q = quantOverride ?? this.launchQuantization
    let launchCtxTime: number

    if (this.isPlaying) {
      const launchBeat = this._nextQuantBeat()
      launchCtxTime = this.ctx.currentTime + this.beatsToSeconds(launchBeat - this.currentBeat)
    } else if (this._sessionClockRunning) {
      launchCtxTime = this._nextSessionQuantCtxTime(q)
    } else {
      this._sessionClockStartCtxTime = this.ctx.currentTime
      this._sessionClockRunning      = true
      launchCtxTime                  = this.ctx.currentTime
    }

    this._sessionMidiQueue.set(trackId, { clip, launchCtxTime })
    this._ensureSessionTicker()
    this.dispatchEvent(new CustomEvent('session-state', { detail: { trackId, clipId: clip.id, state: 'queued' } }))
  }

  private _stopSessionMidiTrack(trackId: string) {
    const slot = this._sessionMidiSlots.get(trackId)
    if (slot) {
      clearInterval(slot.intervalId)
      const clipId = slot.clip.id
      this._sessionMidiSlots.delete(trackId)
      this.dispatchEvent(new CustomEvent('session-state', { detail: { trackId, clipId, state: 'idle' } }))
    }
    this._sessionMidiQueue.delete(trackId)
  }

  private _launchSessionMidiSlot(trackId: string, clip: MidiClip, launchCtxTime: number) {
    const track = this._tracks.find(t => t.id === trackId)
    const nodes = this.trackNodes.get(trackId)
    if (!track || !nodes) return

    const existing = this._sessionMidiSlots.get(trackId)
    if (existing) { clearInterval(existing.intervalId); this._sessionMidiSlots.delete(trackId) }

    const clipDurBeats = clip.durationBeats || 4
    const clipDurSec   = this.beatsToSeconds(clipDurBeats)
    const processedNotes = this._applyMidiEffects(clip.notes, track.midiEffects ?? [])

    const scheduleLoop = (iterationStart: number) => {
      const rollFx = clip.rollFx
      const sustainSec = rollFx?.sustain ?? 0
      for (const note of processedNotes) {
        const noteStartAt = iterationStart + this.beatsToSeconds(this._applySwing(note.startBeat))
        const noteDur     = this.beatsToSeconds(note.durationBeats)
        if (noteStartAt < this.ctx.currentTime - 0.1) continue  // already past
        let noteDest: AudioNode = nodes.midiInput
        if (DawEngine.rollFxActive(rollFx)) {
          const chain = this._buildRollFxChain(rollFx!, noteDest)
          noteDest = chain.input
          const ttlMs = (noteStartAt - this.ctx.currentTime + noteDur + sustainSec + chain.tailSec + 1.5) * 1000
          setTimeout(() => {
            for (const nd of chain.nodes) { try { nd.disconnect() } catch { /* ok */ } }
          }, Math.max(0, ttlMs))
        }
        if (clip.presetId) {
          const bufKey = `${clip.presetId}:${note.pitch}`
          const buf    = this._presetBufCache.get(bufKey)
          if (buf === undefined) void this._loadPresetBuffer(clip.presetId, note.pitch)
          if (buf) {
            const target = (note.velocity ?? 100) / 127
            const loop = noteDur + sustainSec > buf.duration - 0.05 ? this._getLoopMeta(bufKey, buf) : null
            // 3ms attack — decoded sample edges rarely sit on a zero
            // crossing, and an instant jump to full gain clicks like a
            // tiny metronome tap on every note.
            const velGain = this.ctx.createGain()
            velGain.gain.setValueAtTime(0.0001, noteStartAt)
            velGain.gain.linearRampToValueAtTime(target, noteStartAt + 0.003)
            const src = this.ctx.createBufferSource(); src.buffer = buf
            if (loop) { src.loop = true; src.loopStart = loop.start; src.loopEnd = loop.end }
            src.connect(velGain); velGain.connect(noteDest)
            this._registerMidiVoice(src, velGain)
            src.start(noteStartAt)
            if (sustainSec > 0) {
              velGain.gain.setValueAtTime(target, noteStartAt + noteDur)
              velGain.gain.linearRampToValueAtTime(0.0001, noteStartAt + noteDur + sustainSec)
              src.stop(noteStartAt + noteDur + sustainSec + 0.05)
            } else if (loop) {
              velGain.gain.setValueAtTime(target, Math.max(noteStartAt + 0.003, noteStartAt + noteDur - 0.08))
              velGain.gain.linearRampToValueAtTime(0.0001, noteStartAt + noteDur)
              src.stop(noteStartAt + noteDur + 0.02)
            } else {
              // micro-release — stopping mid-waveform clicks the same way
              velGain.gain.setValueAtTime(target, Math.max(noteStartAt + 0.003, noteStartAt + noteDur - 0.008))
              velGain.gain.linearRampToValueAtTime(0.0001, noteStartAt + noteDur)
              src.stop(noteStartAt + noteDur + 0.01)
            }
            src.onended = () => { src.disconnect(); velGain.disconnect() }
          }
        } else {
          playInstrumentNote(this.ctx, noteDest, track.instrument, note.pitch, note.velocity, noteStartAt, noteDur + sustainSec)
        }
      }
    }

    scheduleLoop(launchCtxTime)
    const intervalId = setInterval(() => {
      if (!this._sessionMidiSlots.has(trackId)) return
      const elapsed   = this.ctx.currentTime - launchCtxTime
      const iteration = Math.floor(elapsed / clipDurSec) + 1
      const nextStart = launchCtxTime + iteration * clipDurSec
      if (nextStart - this.ctx.currentTime < SCHEDULE_LOOKAHEAD * 2) {
        scheduleLoop(nextStart)
      }
    }, SCHEDULER_INTERVAL)

    this._sessionMidiSlots.set(trackId, { clip, startCtxTime: launchCtxTime, intervalId })
    this.dispatchEvent(new CustomEvent('session-state', { detail: { trackId, clipId: clip.id, state: 'playing' } }))
  }

  // Returns current state of a session slot
  getSessionState(trackId: string, clipId: string): 'idle' | 'queued' | 'playing' {
    const queued      = this._sessionQueue.get(trackId)
    const playing     = this._sessionSlots.get(trackId)
    const midiQueued  = this._sessionMidiQueue.get(trackId)
    const midiPlaying = this._sessionMidiSlots.get(trackId)
    if (queued?.clip.id      === clipId) return 'queued'
    if (playing?.clip.id     === clipId) return 'playing'
    if (midiQueued?.clip.id  === clipId) return 'queued'
    if (midiPlaying?.clip.id === clipId) return 'playing'
    return 'idle'
  }

  stopSessionMidiTrack(trackId: string) { this._stopSessionMidiTrack(trackId) }

  // Returns 0..1 playback progress for a session slot
  getSessionProgress(trackId: string): number {
    const slot = this._sessionSlots.get(trackId)
    if (!slot) return 0
    const buf = this.bufferCache.get(slot.clip.id)
    if (!buf) return 0
    const elapsed  = this.ctx.currentTime - slot.startContextTime
    const duration = buf.duration - slot.clip.trimStart - slot.clip.trimEnd
    if (slot.clip.loopEnabled) return (elapsed % duration) / duration
    return Math.min(1, elapsed / duration)
  }

  // ── Preset buffer loading ─────────────────────────────────────────────────

  private async _loadPresetBuffer(presetId: string, pitch: number): Promise<void> {
    const key = `${presetId}:${pitch}`
    if (this._presetLoading.has(key)) return
    this._presetLoading.add(key)
    try {
      const preset = this._presets.find(p => p.id === presetId)
      if (!preset) { this._presetBufCache.set(key, null); return }

      const entries = await libraryGetAll()
      const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']
      const noteName = `${NOTE_NAMES[pitch % 12]}${Math.floor(pitch / 12) - 1}`
      const inFolder = entries.filter(e => e.folder === preset.folder || e.parentFolder === preset.folder)
      const exact    = inFolder.find(e => e.name === noteName)
      const entry    = exact ?? inFolder.reduce<typeof inFolder[0] | null>((best, e) => {
        if (!best) return e
        const eMidi  = e.renderSpec?.midiNote ?? 60
        const bMidi  = best.renderSpec?.midiNote ?? 60
        return Math.abs(eMidi - pitch) < Math.abs(bMidi - pitch) ? e : best
      }, null)
      if (!entry) { this._presetBufCache.set(key, null); return }

      const fulfilled = await libraryFulfill(entry.id)
      if (!fulfilled?.audioBlob || !this.ctx) { this._presetBufCache.set(key, null); return }
      const buf = await this.ctx.decodeAudioData(await fulfilled.audioBlob.arrayBuffer())
      this._presetBufCache.set(key, buf)
    } catch {
      this._presetBufCache.set(key, null)
    } finally {
      this._presetLoading.delete(key)
    }
  }

  // ── Arrangement scheduling ─────────────────────────────────────────────────

  private _startScheduler() {
    if (this.schedulerHandle !== null) return
    this.schedulerHandle = setInterval(() => this._tick(), SCHEDULER_INTERVAL)
  }

  private _stopScheduler() {
    if (this.schedulerHandle !== null) {
      clearInterval(this.schedulerHandle)
      this.schedulerHandle = null
    }
  }

  private _tick() {
    if (!this.isPlaying) return

    // Loop wraparound
    if (this.loopEnabled && this.currentBeat >= this.loopEnd) {
      this._killAllSources()
      this._noteKeyVersion++; this._scheduledNoteKeys.clear()
      this._startBeat    = this.loopStart
      this._startCtxTime = this.ctx.currentTime
      this._nextMetronomeBeat = Math.ceil(this.loopStart)
    }

    const now          = this.currentBeat
    const contextNow   = this.ctx.currentTime
    const aheadBeats   = this.secondsToBeats(SCHEDULE_LOOKAHEAD)

    // ── Arrangement audio clips ──────────────────────────────────────────
    // Overlay guard: identical clips stacked at (or within ~10ms of) the same
    // spot would play doubled — and a few-ms offset comb-filters, which reads
    // as feedback. Only the first plays. 0.02 beats ≈ 10ms at 120bpm; any
    // intentional doubling lives further apart than that.
    const seenOverlay: Array<{ trackId: string; startBeat: number; durationBeats: number; sig: string }> = []

    for (const clip of this._clips) {
      const sig = `${clip.r2Key ?? clip.libraryId ?? clip.audioUrl ?? clip.name}`
      const dup = seenOverlay.some(o =>
        o.trackId === clip.trackId && o.sig === sig &&
        Math.abs(o.startBeat - clip.startBeat) < 0.02 &&
        Math.abs(o.durationBeats - clip.durationBeats) < 0.02)
      if (dup) continue
      seenOverlay.push({ trackId: clip.trackId, startBeat: clip.startBeat, durationBeats: clip.durationBeats, sig })
      const alreadyScheduled = this.scheduledSources.some(s => s.clipId === clip.id)
      if (alreadyScheduled) continue

      const clipEnd = clip.startBeat + clip.durationBeats
      if (clipEnd < now) continue
      if (clip.startBeat > now + aheadBeats) continue

      const buf = this.bufferCache.get(clip.id)
      if (!buf) {
        void this.loadClipBuffer(clip)  // fire-and-forget; cached on next tick
        continue
      }

      this._scheduleArrangementClip(clip, buf, now, contextNow)
    }

    // ── Arrangement MIDI clips ───────────────────────────────────────────
    // Same exact-overlay guard for MIDI clips: an identical clip pasted onto
    // itself would double every note.
    const seenMidiOverlay = new Set<string>()

    for (const clip of this._midiClips) {
      const midiOverlayKey = `${clip.trackId}|${clip.startBeat.toFixed(4)}|${clip.durationBeats.toFixed(4)}|${clip.presetId ?? ''}|${clip.notes.length}|${clip.name}`
      if (seenMidiOverlay.has(midiOverlayKey)) continue
      seenMidiOverlay.add(midiOverlayKey)
      const track = this._tracks.find(t => t.id === clip.trackId)
      if (!track || track.mute) continue
      const nodes = this.trackNodes.get(clip.trackId)
      if (!nodes) continue

      const processedNotes = this._applyMidiEffects(clip.notes, track.midiEffects ?? [])

      // Looped clips repeat the note pattern every loopLengthBeats until the
      // clip end. Each occurrence is a (note, repetition) pair with its own
      // dedup key; non-looped clips keep the original single-occurrence key.
      const loopLen = clip.loopEnabled && clip.loopLengthBeats && clip.loopLengthBeats > 0
        ? clip.loopLengthBeats
        : null
      const occurrences: { note: MidiNote; relBeat: number; key: NoteKey; maxDur: number }[] = []
      for (const note of processedNotes) {
        if (!loopLen) {
          occurrences.push({
            note, relBeat: note.startBeat,
            key: `${clip.id}:${note.id}` as NoteKey,
            maxDur: note.durationBeats,
          })
          continue
        }
        const kMax = Math.ceil(clip.durationBeats / loopLen)
        for (let k = 0; k < kMax; k++) {
          const relBeat = k * loopLen + note.startBeat
          if (relBeat >= clip.durationBeats) break
          occurrences.push({
            note, relBeat,
            key: `${clip.id}:${note.id}:${k}` as NoteKey,
            // Truncate the last repetition at the clip boundary
            maxDur: Math.min(note.durationBeats, clip.durationBeats - relBeat),
          })
        }
      }

      // Unison guard: two same-pitch notes overlapping inside one clip play the
      // identical sound twice — a loudness accident (usually an invisible
      // stacked paste), never a musical layer. The earlier note wins; a note
      // starting inside another's span at the same pitch is skipped.
      const unisonSkip = new Set<string>()
      for (const a of occurrences) {
        for (const b of occurrences) {
          if (a === b || a.note.pitch !== b.note.pitch) continue
          const startsInside = b.relBeat > a.relBeat - 1e-6 && b.relBeat < a.relBeat + a.maxDur - 1e-6
          const tieBreak = Math.abs(b.relBeat - a.relBeat) < 1e-6 ? a.key < b.key : a.relBeat < b.relBeat
          if (startsInside && tieBreak && !unisonSkip.has(a.key)) unisonSkip.add(b.key)
        }
      }

      for (const { note, relBeat, key: noteKey, maxDur } of occurrences) {
        if (this._scheduledNoteKeys.has(noteKey)) continue
        if (unisonSkip.has(noteKey)) { this._scheduledNoteKeys.add(noteKey); continue }

        const noteAbsBeat = clip.startBeat + this._applySwing(relBeat)
        const noteEnd     = clip.startBeat + relBeat + maxDur
        if (noteEnd < now) continue
        if (noteAbsBeat > now + aheadBeats) continue

        const startAt      = contextNow + this.beatsToSeconds(Math.max(0, noteAbsBeat - now))
        const alreadyBeats = Math.max(0, now - noteAbsBeat)
        const remaining    = this.beatsToSeconds(maxDur - alreadyBeats)

        // FX-lane clip effects overlapping this note: thread the note's audio
        // through them (audio clips already do this; MIDI silently bypassed
        // them — the "volume effect doesn't touch the piano roll" bug).
        // 'pitch' is excluded: it detunes audio sources, MIDI has none.
        let noteDest: AudioNode = nodes.midiInput
        const rollFx = clip.rollFx
        const sustainSec = rollFx?.sustain ?? 0
        const fxCleanup: { nodes: AudioNode[]; oscs: OscillatorNode[] } = { nodes: [], oscs: [] }
        {
          const overlapping = this._clipEffects.filter(e =>
            e.trackId === clip.trackId && e.type !== 'pitch' &&
            e.startBeat < noteAbsBeat + maxDur &&
            e.startBeat + e.durationBeats > noteAbsBeat
          )
          if (overlapping.length > 0) {
            const entry = this.ctx.createGain()
            fxCleanup.nodes.push(entry)
            let last: AudioNode = entry
            for (const eff of overlapping) {
              const effContextStart  = contextNow + Math.max(0, this.beatsToSeconds(eff.startBeat - now))
              const effSeekOffsetSec = Math.max(0, this.beatsToSeconds(now - eff.startBeat))
              const r = this._buildClipEffect(eff, last, startAt, effContextStart, effSeekOffsetSec)
              last = r.output
              fxCleanup.nodes.push(...r.extraNodes)
              fxCleanup.oscs.push(...r.extraOscs)
            }
            last.connect(nodes.midiInput)
            noteDest = entry
            // Tear the chain down after the note (plus a tail for time-based FX)
            const ttlMs = (startAt - contextNow + remaining + sustainSec + 3) * 1000
            setTimeout(() => {
              for (const o of fxCleanup.oscs)  { try { o.stop(); o.disconnect() } catch { /* ok */ } }
              for (const nd of fxCleanup.nodes) { try { nd.disconnect() } catch { /* ok */ } }
            }, Math.max(0, ttlMs))
          }
        }

        // Clip sound settings: distortion/filter/reverb wrap this note only
        if (DawEngine.rollFxActive(rollFx)) {
          const chain = this._buildRollFxChain(rollFx!, noteDest)
          noteDest = chain.input
          const ttlMs = (startAt - contextNow + remaining + sustainSec + chain.tailSec + 1.5) * 1000
          setTimeout(() => {
            for (const nd of chain.nodes) { try { nd.disconnect() } catch { /* ok */ } }
          }, Math.max(0, ttlMs))
        }

        // Use clip-level preset if set, otherwise fall back to track instrument
        if (clip.presetId) {
          const bufKey = `${clip.presetId}:${note.pitch}`
          const buf    = this._presetBufCache.get(bufKey)
          if (buf === undefined) {
            void this._loadPresetBuffer(clip.presetId, note.pitch)
            continue
          }
          if (buf !== null) {
            // Notes longer than the sample loop its sustain plateau so a bowed
            // chord or pad holds for the whole note, however long it is.
            const needSec = remaining + sustainSec
            let offsetSec = this.beatsToSeconds(alreadyBeats)
            const loop = (needSec > buf.duration - 0.05 || offsetSec >= buf.duration)
              ? this._getLoopMeta(bufKey, buf) : null
            if (!loop && offsetSec >= buf.duration) { this._scheduledNoteKeys.add(noteKey); continue }
            if (loop && offsetSec > loop.end) {
              // Entering mid-note beyond the loop region: fold into the loop
              offsetSec = loop.start + ((offsetSec - loop.start) % (loop.end - loop.start))
            }
            const velGain = this.ctx.createGain()
            const target = (note.velocity ?? 100) / 127
            // Fade in — 5ms entering mid-waveform, 3ms on a fresh onset:
            // even sample starts click when they don't sit on a zero crossing.
            velGain.gain.setValueAtTime(0.0001, startAt)
            velGain.gain.linearRampToValueAtTime(target, startAt + (offsetSec > 0 ? 0.005 : 0.003))
            const src = this.ctx.createBufferSource()
            src.buffer = buf
            if (loop) { src.loop = true; src.loopStart = loop.start; src.loopEnd = loop.end }
            src.connect(velGain)
            velGain.connect(noteDest)
            this._registerMidiVoice(src, velGain)
            src.start(startAt, offsetSec)
            if (remaining > 0) {
              if (sustainSec > 0) {
                // Sustain: let the sample ring past the note's end with a release
                // ramp instead of the hard cut — pedal-like, far more natural.
                velGain.gain.setValueAtTime(target, startAt + remaining)
                velGain.gain.linearRampToValueAtTime(0.0001, startAt + remaining + sustainSec)
                src.stop(startAt + remaining + sustainSec + 0.05)
              } else if (loop) {
                // A looped note ends at full level — an 80ms release avoids the click
                velGain.gain.setValueAtTime(target, Math.max(startAt + 0.005, startAt + remaining - 0.08))
                velGain.gain.linearRampToValueAtTime(0.0001, startAt + remaining)
                src.stop(startAt + remaining + 0.02)
              } else {
                // micro-release — stopping mid-waveform clicks
                velGain.gain.setValueAtTime(target, Math.max(startAt + 0.005, startAt + remaining - 0.008))
                velGain.gain.linearRampToValueAtTime(0.0001, startAt + remaining)
                src.stop(startAt + remaining + 0.01)
              }
            }
            src.onended = () => { src.disconnect(); velGain.disconnect() }
          }
        } else {
          playInstrumentNote(this.ctx, noteDest, track.instrument, note.pitch, note.velocity, startAt, remaining + sustainSec)
        }

        this._scheduledNoteKeys.add(noteKey)
        const expireMs = (startAt - contextNow + remaining + 0.1) * 1000
        const keyVer   = this._noteKeyVersion
        setTimeout(() => { if (this._noteKeyVersion === keyVer) this._scheduledNoteKeys.delete(noteKey) }, Math.max(0, expireMs))
      }
    }

    // ── Automation ───────────────────────────────────────────────────────
    for (const lane of this._automationLanes) {
      if (lane.points.length === 0) continue
      const norm  = interpolateAutomation(lane, now)
      const value = lane.min + norm * (lane.max - lane.min)
      this._applyAutomation(lane.trackId, lane.parameter, value)
    }

    this.dispatchEvent(new CustomEvent('tick', { detail: { beat: now } }))
  }

  private _applyAutomation(trackId: string, parameter: string, value: number) {
    const nodes = this.trackNodes.get(trackId)
    if (!nodes) return
    const t = this.ctx.currentTime

    if (parameter === 'volume') {
      this._baseVol.set(trackId, value)
      nodes.gain.gain.setTargetAtTime(value * (this._localMix.get(trackId) ?? 1), t, 0.01)
      return
    }
    if (parameter === 'pan') {
      nodes.panner.pan.setTargetAtTime(value, t, 0.01)
      return
    }
    // Effects params: 'fx:{effectId}:{paramKey}'
    if (parameter.startsWith('fx:')) {
      const [, effectId, paramKey] = parameter.split(':')
      const handle = this.effectsChains.get(trackId)?.handles.get(effectId)
      handle?.setParam(paramKey, value)
    }
  }

  // Swing: offbeat 16ths (beat pos ≈ 0.25, 0.75, 1.25…) are delayed by up to 1/8 beat
  private _applySwing(beat: number): number {
    if (this.swing === 0) return beat
    const sub16  = Math.round(beat * 4)  // 16th note index
    const isOdd  = sub16 % 2 !== 0       // "offbeat" 16th
    return isOdd ? beat + this.swing * 0.125 : beat
  }

  // Process MIDI notes through a chain of MIDI effects; returns possibly expanded set of notes
  private _applyMidiEffects(notes: MidiNote[], midiEffects: MidiEffect[]): MidiNote[] {
    if (!midiEffects || midiEffects.length === 0) return notes

    let result = [...notes]
    for (const fx of midiEffects) {
      if (fx.type === 'velocity') {
        const p = fx.params as VelocityMidiParams
        if (!p.enabled) continue
        result = result.map(n => {
          const range  = p.outMax - p.outMin
          const scaled = p.outMin + (n.velocity / 127) * range
          const rand   = p.random > 0 ? (Math.random() * 2 - 1) * p.random : 0
          return { ...n, velocity: Math.max(0, Math.min(127, Math.round(scaled + rand))) }
        })
      } else if (fx.type === 'scale') {
        const p = fx.params as ScaleMidiParams
        if (!p.enabled) continue
        const SCALES: Record<string, number[]> = {
          'major':     [0,2,4,5,7,9,11],
          'minor':     [0,2,3,5,7,8,10],
          'penta-maj': [0,2,4,7,9],
          'penta-min': [0,3,5,7,10],
          'dorian':    [0,2,3,5,7,9,10],
          'chromatic': [0,1,2,3,4,5,6,7,8,9,10,11],
        }
        const intervals = SCALES[p.scale] ?? SCALES.major
        result = result.map(n => {
          const pc      = ((n.pitch - p.root) % 12 + 12) % 12
          const octave  = Math.floor((n.pitch - p.root) / 12)
          let best = intervals[0], bestDist = 13
          for (const iv of intervals) {
            const d = Math.abs(pc - iv)
            if (d < bestDist) { bestDist = d; best = iv }
          }
          return { ...n, pitch: p.root + octave * 12 + best }
        })
      } else if (fx.type === 'chord') {
        const p = fx.params as ChordMidiParams
        if (!p.enabled) continue
        const extra: MidiNote[] = []
        for (const n of result) {
          for (const iv of p.intervals) {
            extra.push({ ...n, id: n.id + '_chord_' + iv, pitch: n.pitch + iv })
          }
        }
        result = [...result, ...extra]
      } else if (fx.type === 'arp') {
        const p = fx.params as ArpMidiParams
        if (!p.enabled) continue
        // Group notes that start close together into chords (within 0.05 beats)
        const sorted = [...result].sort((a, b) => a.startBeat - b.startBeat)
        const chords: MidiNote[][] = []
        for (const n of sorted) {
          const last = chords[chords.length - 1]
          if (last && Math.abs(n.startBeat - last[0].startBeat) < 0.05) {
            last.push(n)
          } else {
            chords.push([n])
          }
        }
        const arpNotes: MidiNote[] = []
        let cursor = sorted[0]?.startBeat ?? 0
        for (const chord of chords) {
          // Sort chord pitches by style
          let pitches = chord.map(n => n.pitch)
          if (p.style === 'down') pitches = [...pitches].reverse()
          else if (p.style === 'updown') pitches = [...pitches, ...[...pitches].reverse().slice(1, -1)]
          else if (p.style === 'random') pitches = [...pitches].sort(() => Math.random() - 0.5)

          // Expand across octaves
          const expanded: number[] = []
          for (let oct = 0; oct < p.octaves; oct++) {
            for (const pitch of pitches) expanded.push(pitch + oct * 12)
          }
          if (p.style === 'down') expanded.reverse()

          for (let i = 0; i < expanded.length; i++) {
            arpNotes.push({
              id: chord[0].id + '_arp_' + i,
              pitch: expanded[i],
              startBeat: cursor,
              durationBeats: p.rate * p.gate,
              velocity: chord[0].velocity,
            })
            cursor += p.rate
          }
        }
        result = arpNotes
      }
    }
    return result
  }

  private _scheduleArrangementClip(clip: AudioClip, buf: AudioBuffer, now: number, contextNow: number) {
    const nodes = this.trackNodes.get(clip.trackId)
    if (!nodes) return
    const track = this._tracks.find(t => t.id === clip.trackId)
    if (track?.mute) return

    const source   = this.ctx.createBufferSource()
    const fadeGain = this.ctx.createGain()
    source.connect(fadeGain)

    // Clip-level pitch transpose (semitones + fine cents)
    const clipDetune = ((clip.pitchSemitones ?? 0) * 100) + (clip.pitchCents ?? 0)

    // Pre-render pitch-shifted buffer (preserves speed) for non-warp, non-reverse clips.
    // Web Audio detune/playbackRate both affect the same rate — pitch-only shift requires
    // offline resample + WSOLA. Warp and reverse modes fall back to plain detune (speed changes).
    let effectiveDetune = clipDetune
    if (clipDetune !== 0 && !clip.warpEnabled && !clip.reverse) {
      const pitchKey = `${clip.id}:pitch:${clipDetune}`
      let pitched = this.pitchShiftCache.get(pitchKey)
      if (!pitched) {
        pitched = pitchShiftBuffer(buf, clipDetune)
        this.pitchShiftCache.set(pitchKey, pitched)
      }
      buf = pitched
      effectiveDetune = 0
    }

    // Warp: resolve the actual playback buffer and timing
    const clipDuration  = this.beatsToSeconds(clip.durationBeats)
    const alreadyPlayed = now > clip.startBeat ? this.beatsToSeconds(now - clip.startBeat) : 0
    const beatOffset    = clip.startBeat - now
    const startAt       = contextNow + this.beatsToSeconds(Math.max(0, beatOffset))

    let playBuf           = buf
    let playTrimStart     = clip.trimStart
    let playTrimEnd       = clip.trimEnd
    let effectiveDuration = 0
    let basePlaybackRate  = 1.0
    let boomerangActive   = false

    // Boomerang (ping-pong): build [forward + reversed] buffer, cached per clip
    if (clip.boomerang && !clip.warpEnabled && !clip.reverse) {
      const bKey = `${clip.id}:boom`
      let boomBuf = this.boomerangCache.get(bKey)
      if (!boomBuf) {
        const trimmed = extractTrimmed(buf, clip.trimStart, clip.trimEnd)
        const nCh = trimmed.numberOfChannels
        const fwdLen = trimmed.length
        boomBuf = this.ctx.createBuffer(nCh, fwdLen * 2, trimmed.sampleRate)
        for (let ch = 0; ch < nCh; ch++) {
          const src = trimmed.getChannelData(ch)
          const dst = boomBuf.getChannelData(ch)
          dst.set(src, 0)
          for (let i = 0; i < fwdLen; i++) dst[fwdLen + i] = src[fwdLen - 1 - i]
        }
        this.boomerangCache.set(bKey, boomBuf)
      }
      playBuf = boomBuf
      playTrimStart = 0
      playTrimEnd   = 0
      boomerangActive = true
    }

    if (clip.warpEnabled && !clip.reverse) {
      const nativeDur = buf.duration - clip.trimStart - clip.trimEnd
      const stretchFactor = nativeDur > 0 && clipDuration > 0 ? nativeDur / clipDuration : 1

      if (clip.warpMode === 'stretch' && Math.abs(stretchFactor - 1) > 0.002) {
        // WSOLA: pre-render trimmed + stretched buffer
        const cacheKey = `${clip.id}:${stretchFactor.toFixed(4)}`
        let stretched = this.stretchedBufferCache.get(cacheKey)
        if (!stretched) {
          const trimmed = extractTrimmed(buf, clip.trimStart, clip.trimEnd)
          stretched = wsola(trimmed, stretchFactor)
          this.stretchedBufferCache.set(cacheKey, stretched)
        }
        playBuf        = stretched
        playTrimStart  = 0
        playTrimEnd    = 0
        const seekOff  = Math.min(alreadyPlayed, stretched.duration)
        effectiveDuration = Math.max(0, stretched.duration - seekOff)
        source.buffer = playBuf
        source.start(startAt, seekOff, effectiveDuration)
      } else {
        // Re-pitch: speed and pitch change together (vinyl-style), no rate compensation
        basePlaybackRate = stretchFactor
        source.buffer = buf
        const seekOffset = now > clip.startBeat
          ? this.beatsToSeconds(now - clip.startBeat) * stretchFactor + clip.trimStart
          : clip.trimStart
        const totalDuration = buf.duration - clip.trimStart - clip.trimEnd
        effectiveDuration = Math.min(totalDuration, clipDuration * stretchFactor) - (seekOffset - clip.trimStart)
        effectiveDuration = Math.max(0, effectiveDuration)
        source.start(startAt, seekOffset, effectiveDuration)
      }
    } else {
      // Normal playback (also handles boomerang — playBuf is ping-pong buffer when active)
      source.buffer = playBuf
      const trimStartForSeek = boomerangActive ? 0 : clip.trimStart
      const seekOffset    = now > clip.startBeat
        ? this.beatsToSeconds(now - clip.startBeat) + trimStartForSeek
        : trimStartForSeek
      const totalDuration = playBuf.duration - playTrimStart - playTrimEnd

      if ((clip.loopEnabled || boomerangActive) && !clip.reverse) {
        source.loop      = true
        source.loopStart = playTrimStart
        source.loopEnd   = Math.max(playTrimStart + 0.001, playBuf.duration - playTrimEnd)
        const loopLen    = source.loopEnd - source.loopStart
        const wrapped    = loopLen > 0
          ? source.loopStart + ((Math.max(0, seekOffset - source.loopStart)) % loopLen)
          : seekOffset
        effectiveDuration = Math.max(0, clipDuration - alreadyPlayed)
        source.start(startAt, wrapped)
        if (effectiveDuration > 0) source.stop(startAt + effectiveDuration)
      } else if (clip.reverse) {
        basePlaybackRate = -1.0
        // Reversed playback starts from the trim-end boundary and goes backward
        const revSeekOffset = Math.max(0, playBuf.duration - playTrimEnd - alreadyPlayed)
        effectiveDuration   = Math.max(0, Math.min(totalDuration, clipDuration) - alreadyPlayed)
        source.start(startAt, revSeekOffset, effectiveDuration)
      } else {
        effectiveDuration = Math.max(0, Math.min(totalDuration, clipDuration) - alreadyPlayed)
        source.start(startAt, seekOffset, effectiveDuration)
      }
    }

    source.playbackRate.value = basePlaybackRate * this.varispeedRate
    source.detune.value       = effectiveDetune

    // Build clip-effect chain
    const overlapping = this._clipEffects.filter(e =>
      e.trackId === clip.trackId &&
      e.startBeat < clip.startBeat + clip.durationBeats &&
      e.startBeat + e.durationBeats > clip.startBeat
    )
    const insertEffects = overlapping.filter(e => e.type !== 'pitch')
    const pitchEffects  = overlapping.filter(e => e.type === 'pitch')

    let lastNode: AudioNode = fadeGain
    const allExtraNodes: AudioNode[] = []
    const allExtraOscs: OscillatorNode[] = []
    for (const eff of insertEffects) {
      // When seeking mid-clip, use now-relative timing so already-active effects start immediately
      const effContextStart   = contextNow + Math.max(0, this.beatsToSeconds(eff.startBeat - now))
      const effSeekOffsetSec  = Math.max(0, this.beatsToSeconds(now - eff.startBeat))
      const r = this._buildClipEffect(eff, lastNode, startAt, effContextStart, effSeekOffsetSec)
      lastNode = r.output
      allExtraNodes.push(...r.extraNodes)
      allExtraOscs.push(...r.extraOscs)
    }
    lastNode.connect(nodes.effectsInput)

    // Pitch effects modify source.detune (added on top of effectiveDetune)
    for (const eff of pitchEffects) {
      const effContextStart   = contextNow + Math.max(0, this.beatsToSeconds(eff.startBeat - now))
      const effSeekOffsetSec  = Math.max(0, this.beatsToSeconds(now - eff.startBeat))
      this._applyPitchEffect(eff, source, effContextStart, effectiveDetune, effSeekOffsetSec)
    }

    // Always ramp from 0 to clip.gain at startAt — prevents pop/static from non-zero
    // first sample at any seekOffset.  5 ms is inaudible as a fade but eliminates the click.
    const ANTI_CLICK_S = 0.005
    if (clip.fadeIn > 0) {
      const fs = this.beatsToSeconds(clip.fadeIn)
      fadeGain.gain.setValueAtTime(0, startAt)
      fadeGain.gain.linearRampToValueAtTime(clip.gain, startAt + Math.max(fs, ANTI_CLICK_S))
    } else {
      fadeGain.gain.setValueAtTime(0, startAt)
      fadeGain.gain.linearRampToValueAtTime(clip.gain, startAt + ANTI_CLICK_S)
    }
    if (clip.fadeOut > 0 && effectiveDuration > 0) {
      const fs        = this.beatsToSeconds(clip.fadeOut)
      const fadeStart = Math.max(startAt, startAt + effectiveDuration - fs)
      fadeGain.gain.setValueAtTime(clip.gain, fadeStart)
      fadeGain.gain.linearRampToValueAtTime(0, startAt + effectiveDuration)
    }

    // Reverb tails need to ring out after the source stops — find the longest decay
    const maxReverbTailSec = insertEffects
      .filter(e => e.type === 'reverb')
      .reduce((max, e) => Math.max(max, e.params.reverbDecay ?? 2), 0)

    const entry: ScheduledSource = { source, gainNode: fadeGain, clipId: clip.id, basePlaybackRate }
    this.scheduledSources.push(entry)
    source.onended = () => {
      const idx = this.scheduledSources.indexOf(entry)
      if (idx !== -1) this.scheduledSources.splice(idx, 1)
      source.disconnect()

      const cleanupTail = () => {
        fadeGain.disconnect()
        for (const n of allExtraNodes) { try { n.disconnect() } catch { /* ok */ } }
        for (const o of allExtraOscs) { try { o.stop(); o.disconnect() } catch { /* ok */ } }
        entry.tailTimerId = undefined
      }

      if (maxReverbTailSec > 0) {
        // Keep effect nodes connected so the convolver can ring out naturally
        entry.tailNodes   = allExtraNodes
        entry.tailOscs    = allExtraOscs
        entry.tailTimerId = setTimeout(cleanupTail, maxReverbTailSec * 1000 + 300)
      } else {
        cleanupTail()
      }
    }
  }

  private _slicedCurve(
    points: AutoPoint[],
    durationBeats: number,
    seekOffsetSec: number,
    mapper: (v: number) => number,
  ): { curve: Float32Array; durSec: number } {
    const fullSec   = this.beatsToSeconds(durationBeats)
    const remainSec = Math.max(0.001, fullSec - seekOffsetSec)
    const N         = Math.max(4, Math.ceil(fullSec * 60))
    const all       = sampleAutomation(points, durationBeats, N)
    const idx       = seekOffsetSec > 0 ? Math.min(N - 2, Math.floor((seekOffsetSec / fullSec) * N)) : 0
    const slice     = all.slice(idx)
    const arr       = slice.length >= 2 ? slice : [all[N - 1], all[N - 1]]
    return { curve: new Float32Array(arr.map(mapper)), durSec: remainSec }
  }

  // ── Sustain looping: notes longer than their sample ──────────────────────────
  // A note can be stretched far past its sample's length: the engine loops a
  // stable mid-sample region (zero-crossing snapped) until the note ends. Only
  // sounds that actually sustain loop — naturally decaying sounds (piano hits,
  // plucks) keep their real ending instead of looping a faded tail.

  private _loopMeta = new Map<string, { start: number; end: number } | null>()

  // Every sampled MIDI voice registers here so pause can hard-stop it even if
  // some routing path dodges the midiInput bus swap (belt and braces).
  private _midiVoices = new Set<{ src: AudioBufferSourceNode; gain: GainNode }>()

  private _registerMidiVoice(src: AudioBufferSourceNode, gain: GainNode) {
    const entry = { src, gain }
    this._midiVoices.add(entry)
    const prev = src.onended
    src.onended = (e) => {
      this._midiVoices.delete(entry)
      if (typeof prev === 'function') prev.call(src, e)
    }
  }

  private _getLoopMeta(bufKey: string, buf: AudioBuffer): { start: number; end: number } | null {
    const cached = this._loopMeta.get(bufKey)
    if (cached !== undefined) return cached
    const meta = DawEngine.computeSustainLoop(buf)
    this._loopMeta.set(bufKey, meta)
    return meta
  }

  static computeSustainLoop(buf: AudioBuffer): { start: number; end: number } | null {
    const d = buf.duration
    if (d < 0.8) return null  // one-shots don't sustain
    const sr = buf.sampleRate
    const ch = buf.getChannelData(0)

    const rms = (fromSec: number, winSec = 0.25): number => {
      const from = Math.max(0, Math.floor(fromSec * sr))
      const to = Math.min(ch.length, from + Math.floor(winSec * sr))
      let sum = 0
      for (let i = from; i < to; i++) sum += ch[i] * ch[i]
      return Math.sqrt(sum / Math.max(1, to - from))
    }

    // Loop the plateau: after the attack, before the release tail
    let start = Math.min(1.2, d * 0.35)
    let end = Math.max(start + 0.25, d * 0.9 - 0.05)
    if (end - start < 0.2) return null

    const rmsStart = rms(start)
    const rmsEnd = rms(Math.max(start, end - 0.3))
    if (rmsStart < 0.01) return null                 // silent sustain region
    if (rmsEnd < 0.4 * rmsStart) return null          // decaying sound — let it end naturally

    // Snap both points to positive-going zero crossings to minimise the click
    const snap = (sec: number): number => {
      const center = Math.floor(sec * sr)
      const span = Math.floor(0.05 * sr)
      for (let off = 0; off < span; off++) {
        for (const i of [center + off, center - off]) {
          if (i > 0 && i < ch.length && ch[i - 1] <= 0 && ch[i] > 0) return i / sr
        }
      }
      return sec
    }
    start = snap(start)
    end = snap(end)
    if (end - start < 0.2) return null
    return { start, end }
  }

  // ── Piano-roll clip sound settings (MidiClip.rollFx) ─────────────────────────
  // Per-note chains, torn down after each note — persistent chains would pin
  // the swapped-on-stop midiInput bus (the stale-bus class).

  private _reverbIR: AudioBuffer | null = null
  private _distCurves = new Map<number, Float32Array>()

  private _getReverbIR(): AudioBuffer {
    if (!this._reverbIR) {
      const sr = this.ctx.sampleRate
      const len = Math.floor(sr * 2.2)
      const ir = this.ctx.createBuffer(2, len, sr)
      for (let ch = 0; ch < 2; ch++) {
        const d = ir.getChannelData(ch)
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6)
      }
      this._reverbIR = ir
    }
    return this._reverbIR
  }

  private _getDistCurve(drive: number): Float32Array {
    const key = Math.round(drive * 20)
    let c = this._distCurves.get(key)
    if (!c) {
      const k = 2 + drive * 48
      c = new Float32Array(1024)
      for (let i = 0; i < 1024; i++) {
        const x = i / 511.5 - 1
        c[i] = Math.tanh(k * x) / Math.tanh(k)
      }
      this._distCurves.set(key, c)
    }
    return c
  }

  static rollFxActive(rfx: MidiClip['rollFx']): boolean {
    return !!rfx && ((rfx.distortion ?? 0) > 0 || (rfx.reverbWet ?? 0) > 0 || (rfx.filterHz !== undefined && rfx.filterHz < 17500)
      || (rfx.sub ?? 0) !== 0 || (rfx.bass ?? 0) !== 0 || (rfx.mid ?? 0) !== 0 || (rfx.treble ?? 0) !== 0)
  }

  /** Chain: note → distortion → lowpass → reverb mix → dest. Returns the entry node. */
  private _buildRollFxChain(rfx: NonNullable<MidiClip['rollFx']>, dest: AudioNode): { input: AudioNode; nodes: AudioNode[]; tailSec: number } {
    const nodes: AudioNode[] = []
    const input = this.ctx.createGain()
    nodes.push(input)
    let last: AudioNode = input
    let tail = 0
    if ((rfx.distortion ?? 0) > 0) {
      const ws = this.ctx.createWaveShaper()
      ws.curve = this._getDistCurve(rfx.distortion!) as Float32Array<ArrayBuffer>
      ws.oversample = '2x'
      const pg = this.ctx.createGain()
      pg.gain.value = 1 - rfx.distortion! * 0.4  // tame the level lift saturation adds
      last.connect(ws); ws.connect(pg); last = pg
      nodes.push(ws, pg)
    }
    if (rfx.filterHz !== undefined && rfx.filterHz < 17500) {
      const f = this.ctx.createBiquadFilter()
      f.type = 'lowpass'; f.frequency.value = rfx.filterHz; f.Q.value = 0.8
      last.connect(f); last = f
      nodes.push(f)
    }
    // 4-band tone EQ
    if ((rfx.sub ?? 0) !== 0 || (rfx.bass ?? 0) !== 0 || (rfx.mid ?? 0) !== 0 || (rfx.treble ?? 0) !== 0) {
      const sub = this.ctx.createBiquadFilter(); sub.type = 'lowshelf';  sub.frequency.value = 70;   sub.gain.value = rfx.sub ?? 0
      const bs  = this.ctx.createBiquadFilter(); bs.type = 'lowshelf';   bs.frequency.value = 200;   bs.gain.value = rfx.bass ?? 0
      const md  = this.ctx.createBiquadFilter(); md.type = 'peaking';    md.frequency.value = 1000; md.Q.value = 1; md.gain.value = rfx.mid ?? 0
      const tr  = this.ctx.createBiquadFilter(); tr.type = 'highshelf';  tr.frequency.value = 8000;  tr.gain.value = rfx.treble ?? 0
      last.connect(sub); sub.connect(bs); bs.connect(md); md.connect(tr); last = tr
      nodes.push(sub, bs, md, tr)
    }
    if ((rfx.reverbWet ?? 0) > 0) {
      const wetAmt = rfx.reverbWet!
      const dry = this.ctx.createGain(); dry.gain.value = 1 - wetAmt * 0.5
      const conv = this.ctx.createConvolver(); conv.buffer = this._getReverbIR()
      const wet = this.ctx.createGain(); wet.gain.value = wetAmt
      const sum = this.ctx.createGain()
      last.connect(dry); dry.connect(sum)
      last.connect(conv); conv.connect(wet); wet.connect(sum)
      last = sum
      nodes.push(dry, conv, wet, sum)
      tail = 2.4
    }
    last.connect(dest)
    return { input, nodes, tailSec: tail }
  }

  private _buildClipEffect(
    eff: ClipEffect,
    input: AudioNode,
    startAt: number,
    effContextStart: number,
    effSeekOffsetSec = 0,
  ): { output: AudioNode; extraNodes: AudioNode[]; extraOscs: OscillatorNode[] } {
    const extraNodes: AudioNode[] = []
    const extraOscs: OscillatorNode[] = []
    const ctx = this.ctx
    function n<T extends AudioNode>(node: T): T { extraNodes.push(node); return node }

    switch (eff.type) {
      case 'volume': {
        const g = n(ctx.createGain())
        const meta = CLIP_EFFECT_PARAM_META.volume
        if (eff.automation?.points.length) {
          const { curve, durSec } = this._slicedCurve(eff.automation.points, eff.durationBeats, effSeekOffsetSec, v => normToParam(v, meta))
          g.gain.setValueCurveAtTime(curve, effContextStart, durSec)
        } else {
          const env = eff.params.shapeEnvelope
          if (env && env.length > 0) {
            const baseGain = eff.params.gain ?? 1
            const sr       = eff.params.shapeSampleRate ?? 30
            const skip     = Math.floor(effSeekOffsetSec * sr)
            const startVal = skip < env.length ? env[skip] : env[env.length - 1]
            g.gain.setValueAtTime(Math.max(0, startVal * baseGain), effContextStart)
            for (let i = skip + 1; i < env.length; i++) {
              const t = effContextStart + (i - skip) / sr
              if (t > ctx.currentTime) g.gain.linearRampToValueAtTime(Math.max(0, env[i] * baseGain), t)
            }
          } else {
            g.gain.value = eff.params.gain ?? 1
          }
        }
        input.connect(g)
        return { output: g, extraNodes, extraOscs }
      }
      case 'pitch':
        // Handled separately via _applyPitchEffect (modifies source.detune, not an insert node)
        return { output: input, extraNodes, extraOscs }
      case 'filter': {
        const f = n(ctx.createBiquadFilter())
        f.type = eff.params.filterType ?? 'lowpass'
        f.Q.value = eff.params.filterQ ?? 1
        if (eff.automation?.points.length) {
          const meta = CLIP_EFFECT_PARAM_META.filter
          const { curve, durSec } = this._slicedCurve(eff.automation.points, eff.durationBeats, effSeekOffsetSec, v => normToParam(v, meta))
          f.frequency.setValueCurveAtTime(curve, effContextStart, durSec)
        } else {
          f.frequency.value = eff.params.frequency ?? 1000
        }
        input.connect(f)
        return { output: f, extraNodes, extraOscs }
      }
      case 'tremolo': {
        const depth = eff.params.tremoloDepth ?? 0.5
        const outG = n(ctx.createGain()); outG.gain.value = 1 - depth * 0.5
        const lfoG = n(ctx.createGain()); lfoG.gain.value = depth * 0.5
        const lfo = ctx.createOscillator(); extraOscs.push(lfo)
        lfo.type = 'sine'
        if (eff.automation?.points.length) {
          const meta = CLIP_EFFECT_PARAM_META.tremolo
          const { curve, durSec } = this._slicedCurve(eff.automation.points, eff.durationBeats, effSeekOffsetSec, v => normToParam(v, meta))
          lfo.frequency.setValueCurveAtTime(curve, effContextStart, durSec)
        } else {
          lfo.frequency.value = eff.params.tremoloRate ?? 4
        }
        lfo.connect(lfoG); lfoG.connect(outG.gain)
        // Start LFO offset by seek so its phase matches mid-effect position
        input.connect(outG); lfo.start(startAt - effSeekOffsetSec)
        return { output: outG, extraNodes, extraOscs }
      }
      case 'reverb': {
        const staticWet = eff.params.reverbWet ?? 0.3
        const dry  = n(ctx.createGain())
        const wetG = n(ctx.createGain())
        const conv = n(ctx.createConvolver()); conv.buffer = this._makeIR(eff.params.reverbDecay ?? 2)
        const mix  = n(ctx.createGain()); mix.gain.value = 1
        if (eff.automation?.points.length) {
          const { curve: wetCurve, durSec } = this._slicedCurve(eff.automation.points, eff.durationBeats, effSeekOffsetSec, v => v)
          const dryCurve = new Float32Array(wetCurve.map(v => 1 - v))
          wetG.gain.setValueCurveAtTime(wetCurve, effContextStart, durSec)
          dry.gain.setValueCurveAtTime(dryCurve, effContextStart, durSec)
        } else {
          wetG.gain.value = staticWet; dry.gain.value = 1 - staticWet
        }
        input.connect(dry); dry.connect(mix)
        input.connect(conv); conv.connect(wetG); wetG.connect(mix)
        return { output: mix, extraNodes, extraOscs }
      }
      case 'delay': {
        const staticWet = eff.params.delayWet ?? 0.3
        const dry   = n(ctx.createGain())
        const delay = n(ctx.createDelay(2.0)); delay.delayTime.value = eff.params.delayTime ?? 0.375
        const fbG   = n(ctx.createGain()); fbG.gain.value = Math.min(0.95, eff.params.feedback ?? 0.4)
        const wetG  = n(ctx.createGain())
        const mix   = n(ctx.createGain()); mix.gain.value = 1
        if (eff.automation?.points.length) {
          const { curve: wetCurve, durSec } = this._slicedCurve(eff.automation.points, eff.durationBeats, effSeekOffsetSec, v => v)
          const dryCurve = new Float32Array(wetCurve.map(v => 1 - v))
          wetG.gain.setValueCurveAtTime(wetCurve, effContextStart, durSec)
          dry.gain.setValueCurveAtTime(dryCurve, effContextStart, durSec)
        } else {
          wetG.gain.value = staticWet; dry.gain.value = 1 - staticWet
        }
        input.connect(dry); dry.connect(mix)
        input.connect(delay); delay.connect(fbG); fbG.connect(delay)
        delay.connect(wetG); wetG.connect(mix)
        return { output: mix, extraNodes, extraOscs }
      }
      case 'distortion': {
        const ws = n(ctx.createWaveShaper())
        ws.curve = this._makeDistortionCurve(eff.params.distortion ?? 0.5)
        ws.oversample = '2x'
        if (eff.automation?.points.length) {
          // The shaper curve itself can't be automated — crossfade clean and
          // distorted paths along the drawn curve, like reverb/delay wet.
          const dry  = n(ctx.createGain())
          const wetG = n(ctx.createGain())
          const mix  = n(ctx.createGain()); mix.gain.value = 1
          const { curve: wetCurve, durSec } = this._slicedCurve(eff.automation.points, eff.durationBeats, effSeekOffsetSec, v => v)
          const dryCurve = new Float32Array(wetCurve.map(v => 1 - v))
          wetG.gain.setValueCurveAtTime(wetCurve, effContextStart, durSec)
          dry.gain.setValueCurveAtTime(dryCurve, effContextStart, durSec)
          input.connect(dry); dry.connect(mix)
          input.connect(ws); ws.connect(wetG); wetG.connect(mix)
          return { output: mix, extraNodes, extraOscs }
        }
        input.connect(ws)
        return { output: ws, extraNodes, extraOscs }
      }
      default:
        return { output: input, extraNodes, extraOscs }
    }
  }

  private _applyPitchEffect(
    eff: ClipEffect,
    source: AudioBufferSourceNode,
    effContextStart: number,
    clipDetuneOffset = 0,
    effSeekOffsetSec = 0,
  ) {
    const meta      = CLIP_EFFECT_PARAM_META.pitch
    const baseCents = (eff.params.semitones ?? 0) * 100 + clipDetuneOffset

    if (eff.automation?.points.length) {
      const { curve, durSec } = this._slicedCurve(
        eff.automation.points, eff.durationBeats, effSeekOffsetSec,
        v => normToParam(v, meta) * 100 + clipDetuneOffset,
      )
      source.detune.setValueCurveAtTime(curve, effContextStart, durSec)
      source.detune.setValueAtTime(clipDetuneOffset, effContextStart + durSec)
    } else {
      const env = eff.params.shapeEnvelope
      if (env && env.length > 0) {
        const sr    = eff.params.shapeSampleRate ?? 30
        const skip  = Math.floor(effSeekOffsetSec * sr)
        const start = skip < env.length ? env[skip] : env[env.length - 1]
        source.detune.setValueAtTime(baseCents + start * 100, effContextStart)
        for (let i = skip + 1; i < env.length; i++) {
          const t = effContextStart + (i - skip) / sr
          if (t > this.ctx.currentTime)
            source.detune.linearRampToValueAtTime(baseCents + env[i] * 100, t)
        }
        source.detune.setValueAtTime(clipDetuneOffset, effContextStart + (env.length - skip) / sr)
      } else {
        source.detune.setValueAtTime(baseCents, effContextStart)
        source.detune.setValueAtTime(clipDetuneOffset, effContextStart + this.beatsToSeconds(eff.durationBeats) - effSeekOffsetSec)
      }
    }
  }

  private _makeIR(decay: number): AudioBuffer {
    const key = Math.round(decay * 10)
    if (this._irCache.has(key)) return this._irCache.get(key)!
    const len = Math.ceil(this.ctx.sampleRate * Math.min(decay, 5))
    const buf = this.ctx.createBuffer(2, len, this.ctx.sampleRate)
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch)
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2)
    }
    this._irCache.set(key, buf)
    return buf
  }

  private _makeDistortionCurve(amount: number): Float32Array<ArrayBuffer> {
    const n = 256; const curve = new Float32Array(new ArrayBuffer(n * 4))
    const k = amount * 100
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / n - 1
      curve[i] = ((Math.PI + k) * x) / (Math.PI + k * Math.abs(x))
    }
    return curve
  }

  private _killAllSources() {
    const now      = this.ctx.currentTime
    const stopAt   = now + 0.015  // 15 ms fade window — inaudible but click-free
    for (const { source, gainNode, tailNodes, tailOscs, tailTimerId } of this.scheduledSources) {
      try {
        gainNode.gain.cancelScheduledValues(now)
        gainNode.gain.setTargetAtTime(0, now, 0.003)  // ~15 ms time constant
        source.stop(stopAt)
      } catch { /* ok */ }
      if (tailTimerId !== undefined) clearTimeout(tailTimerId)
      if (tailNodes) for (const n of tailNodes) { try { n.disconnect() } catch { /* ok */ } }
      if (tailOscs)  for (const o of tailOscs)  { try { o.stop(stopAt); o.disconnect() } catch { /* ok */ } }
    }
    this.scheduledSources = []

    // Hard-stop every registered sampled MIDI voice (looped drones included) —
    // scheduled ramps are cancelled so nothing can resurrect them.
    for (const { src, gain } of this._midiVoices) {
      try {
        gain.gain.cancelScheduledValues(now)
        gain.gain.setTargetAtTime(0, now, 0.003)
        src.stop(stopAt)
      } catch { /* not started yet or already stopped */ }
    }
    this._midiVoices.clear()

    // Cut off ringing MIDI voices (preset samples and synth instruments):
    // they connect through each track's midiInput bus, so fade the bus out
    // and swap in a fresh one for whatever plays next.
    for (const nodes of this.trackNodes.values()) {
      const old = nodes.midiInput
      old.gain.cancelScheduledValues(now)
      old.gain.setTargetAtTime(0, now, 0.003)
      setTimeout(() => { try { old.disconnect() } catch { /* ok */ } }, 100)
      const fresh = this.ctx.createGain()
      fresh.connect(nodes.effectsInput)
      nodes.midiInput = fresh
    }
  }

  clearStretchedCache(clipId?: string) {
    if (clipId) {
      for (const key of [...this.stretchedBufferCache.keys()]) {
        if (key.startsWith(clipId + ':')) this.stretchedBufferCache.delete(key)
      }
    } else {
      this.stretchedBufferCache.clear()
    }
  }

  clearPitchCache(clipId?: string) {
    if (clipId) {
      for (const key of [...this.pitchShiftCache.keys()]) {
        if (key.startsWith(clipId + ':')) this.pitchShiftCache.delete(key)
      }
    } else {
      this.pitchShiftCache.clear()
    }
  }

  clearBoomerangCache(clipId?: string) {
    if (clipId) {
      this.boomerangCache.delete(`${clipId}:boom`)
    } else {
      this.boomerangCache.clear()
    }
  }

  // ── One-shot preview (for session slots without transport running) ──────────

  async playClipOnce(clip: AudioClip, trackId: string): Promise<AudioBufferSourceNode | undefined> {
    if (this.ctx.state === 'suspended') await this.ctx.resume()
    const buf = await this.loadClipBuffer(clip)
    if (!buf) return

    this.ensureTrack(trackId)
    const nodes   = this.trackNodes.get(trackId)!
    const source  = this.ctx.createBufferSource()
    const gainNode = this.ctx.createGain()
    source.buffer = buf
    gainNode.gain.value = clip.gain
    source.connect(gainNode)
    gainNode.connect(nodes.effectsInput)
    source.start(0, clip.trimStart, buf.duration - clip.trimStart - clip.trimEnd)
    source.onended = () => { source.disconnect(); gainNode.disconnect() }
    return source
  }

  // ── Metronome ──────────────────────────────────────────────────────────────

  private _buildMetronomeBuffers() {
    const sr  = this.ctx.sampleRate
    const len = Math.floor(sr * 0.04)
    const tick = this.ctx.createBuffer(1, len, sr)
    const tock = this.ctx.createBuffer(1, len, sr)
    const td = tick.getChannelData(0)
    const wd = tock.getChannelData(0)
    for (let i = 0; i < len; i++) {
      const env = Math.exp(-i / (sr * 0.015))
      td[i] = Math.sin(2 * Math.PI * 1800 * i / sr) * env
      wd[i] = Math.sin(2 * Math.PI * 900  * i / sr) * env * 0.5
    }
    this._tickBuf = tick
    this._tockBuf = tock
  }

  setMetronome(on: boolean) {
    if (!on) {
      if (this.metronomeHandle !== null) { clearInterval(this.metronomeHandle); this.metronomeHandle = null }
      return
    }
    if (this.metronomeHandle !== null) return
    this.metronomeHandle = setInterval(() => this._scheduleMetronome(), SCHEDULER_INTERVAL)
  }

  private _scheduleMetronome() {
    if (!this.isPlaying) return
    const now         = this.ctx.currentTime
    const currentBeat = this.currentBeat
    const ahead       = this.secondsToBeats(SCHEDULE_LOOKAHEAD)
    while (this._nextMetronomeBeat <= currentBeat + ahead) {
      const beatOffset = this._nextMetronomeBeat - currentBeat
      const when       = now + this.beatsToSeconds(Math.max(0, beatOffset))
      const isDownbeat = (this._nextMetronomeBeat % this._beatsPerBar) === 0
      const buf        = isDownbeat ? this._tickBuf : this._tockBuf
      if (buf) {
        const src = this.ctx.createBufferSource()
        src.buffer = buf
        const g = this.ctx.createGain()
        g.gain.value = 0.6
        src.connect(g); g.connect(this.masterGain)
        src.start(when)
        src.onended = () => { src.disconnect(); g.disconnect() }
      }
      this._nextMetronomeBeat++
    }
  }

  /** Recording latency compensation in seconds: manual override from
   *  settings, else the context's own estimate. Recorded clips are shifted
   *  earlier by this much so takes line up with what the performer heard. */
  recordLatencySec(): number {
    try {
      const stored = localStorage.getItem('100lights-rec-latency-ms')
      if (stored !== null) return Math.max(0, Number(stored)) / 1000
    } catch { /* ssr/no storage */ }
    return this.ctx.baseLatency + (this.ctx.outputLatency ?? 0)
  }

  /** Stem export: tap each listed track's post-fader output with a
   *  MediaStreamDestination so one playback pass captures every stem.
   *  Returns the taps; call the returned dispose() when done. */
  tapTrackOutputs(trackIds: string[]): { taps: Map<string, MediaStreamAudioDestinationNode>; dispose: () => void } {
    const taps = new Map<string, MediaStreamAudioDestinationNode>()
    for (const id of trackIds) {
      this.ensureTrack(id)
      const nodes = this.trackNodes.get(id)
      if (!nodes) continue
      const dest = this.ctx.createMediaStreamDestination()
      nodes.analyser.connect(dest)  // post-fader, post-pan — what the mix hears
      taps.set(id, dest)
    }
    return {
      taps,
      dispose: () => {
        for (const [id, dest] of taps) {
          try { this.trackNodes.get(id)?.analyser.disconnect(dest) } catch { /* ok */ }
        }
        taps.clear()
      },
    }
  }

  /** Count-in: metronome clicks for N beats before a take starts. Clicks go
   *  straight to the hardware output so they're never captured. Resolves when
   *  the last click has sounded. */
  async countIn(beats: number, tempo: number): Promise<void> {
    if (this.ctx.state === 'suspended') await this.ctx.resume()
    const secPerBeat = 60 / tempo
    const start = this.ctx.currentTime + 0.06
    for (let i = 0; i < beats; i++) {
      const isDownbeat = (i % this._beatsPerBar) === 0
      const buf = isDownbeat ? this._tickBuf : this._tockBuf
      if (!buf) continue
      const src = this.ctx.createBufferSource()
      src.buffer = buf
      const g = this.ctx.createGain()
      g.gain.value = 0.7
      src.connect(g); g.connect(this.ctx.destination)
      src.start(start + i * secPerBeat)
      src.onended = () => { src.disconnect(); g.disconnect() }
    }
    await new Promise(r => setTimeout(r, (0.06 + beats * secPerBeat) * 1000))
  }

  // ── Recording ─────────────────────────────────────────────────────────────

  private _mediaRecorder: MediaRecorder | null = null
  private _recChunks:   Blob[]                 = []
  private _captureNode: MediaStreamAudioDestinationNode | null = null
  private _recStartBeat = 0
  private _micStreams = new Map<string, { stream: MediaStream; source: MediaStreamAudioSourceNode }>()

  async startMicInput(trackId: string, source: string): Promise<void> {
    // Resume a suspended AudioContext before touching getUserMedia —
    // browsers suspend AudioContext until a user gesture, and a suspended
    // context won't process mic audio even after it's connected.
    if (this.ctx.state === 'suspended') await this.ctx.resume()
    // Stop any existing stream for this track first
    this.stopMicInput(trackId)
    const stream = await captureAudioInput(source)
    const srcNode = this.ctx.createMediaStreamSource(stream)
    this.ensureTrack(trackId)
    const nodes = this.trackNodes.get(trackId)!
    srcNode.connect(nodes.effectsInput)
    this._micStreams.set(trackId, { stream, source: srcNode })
  }

  stopMicInput(trackId: string): void {
    const entry = this._micStreams.get(trackId)
    if (!entry) return
    try { entry.source.disconnect() } catch { /* ok */ }
    entry.stream.getTracks().forEach(t => t.stop())
    this._micStreams.delete(trackId)
  }

  stopAllMicInputs(): void {
    for (const trackId of [...this._micStreams.keys()]) {
      this.stopMicInput(trackId)
    }
  }

  /** Live amplitude trail while recording — one entry every ~45ms, drawn by
   *  the arrangement's recording ghost so you watch the take appear. */
  recordingPeaks: number[] = []
  private _recPeakTimer: number | null = null
  private _recAnalyser: AnalyserNode | null = null
  get recordingStartBeat(): number { return this._recStartBeat }

  // ── Input monitoring (record-setup box) ──────────────────────────────────
  // A live mic preview with the chosen effects, routed STRAIGHT to the
  // hardware output — bypassing masterCompressor keeps it out of the
  // recorder tap, so monitoring is never captured.
  private _monitor: { ctx: AudioContext; stream: MediaStream; src: MediaStreamAudioSourceNode; nodes: AudioNode[]; oscs: OscillatorNode[] } | null = null
  /** Effects chosen in the record-setup box — attached as FX-lane bars under
   *  the recorded clips when they land. */
  pendingRecordFx: MonitorFx[] = []
  setPendingRecordFx(fxs: MonitorFx[]): void { this.pendingRecordFx = fxs }

  get monitorActive(): boolean { return !!this._monitor }

  async startMonitor(source: string, fxs: MonitorFx[]): Promise<void> {
    this.stopMonitor()
    // A dedicated context requesting zero latency gets a smaller output
    // buffer than the engine's ctx (which carries the whole mix graph) —
    // this is what makes the monitor feel immediate.
    const monCtx = new AudioContext({ latencyHint: 0 })
    if (monCtx.state === 'suspended') await monCtx.resume()
    const stream = await captureAudioInput(source)
    const src = monCtx.createMediaStreamSource(stream)
    this._monitor = { ctx: monCtx, stream, src, nodes: [], oscs: [] }
    this._buildMonitorChain(fxs)
  }

  updateMonitorFx(fxs: MonitorFx[]): void {
    if (this._monitor) this._buildMonitorChain(fxs)
  }

  stopMonitor(): void {
    const m = this._monitor
    if (!m) return
    for (const o of m.oscs) { try { o.stop() } catch { /* ok */ } }
    for (const n of m.nodes) { try { n.disconnect() } catch { /* ok */ } }
    try { m.src.disconnect() } catch { /* ok */ }
    m.stream.getTracks().forEach(t => t.stop())
    void m.ctx.close().catch(() => {})
    this._monitor = null
  }

  private _buildMonitorChain(fxs: MonitorFx[]): void {
    const m = this._monitor
    if (!m) return
    for (const o of m.oscs) { try { o.stop() } catch { /* ok */ } }
    for (const n of m.nodes) { try { n.disconnect() } catch { /* ok */ } }
    try { m.src.disconnect() } catch { /* ok */ }
    m.nodes = []; m.oscs = []
    const ctx = m.ctx
    const reg = <T extends AudioNode>(n: T): T => { m.nodes.push(n); return n }
    let node: AudioNode = m.src
    for (const fx of fxs) {
      switch (fx.type) {
        case 'volume': {
          const g = reg(ctx.createGain()); g.gain.value = fx.value
          node.connect(g); node = g; break
        }
        case 'filter': {
          const f = reg(ctx.createBiquadFilter()); f.type = 'lowpass'; f.frequency.value = fx.value; f.Q.value = 1
          node.connect(f); node = f; break
        }
        case 'distortion': {
          const ws = reg(ctx.createWaveShaper())
          ws.curve = this._makeDistortionCurve(fx.value); ws.oversample = '2x'
          node.connect(ws); node = ws; break
        }
        case 'reverb': {
          const dry = reg(ctx.createGain()); dry.gain.value = 1 - fx.value
          const wet = reg(ctx.createGain()); wet.gain.value = fx.value
          const conv = reg(ctx.createConvolver()); conv.buffer = this._makeIR(2)
          const mix = reg(ctx.createGain())
          node.connect(dry); dry.connect(mix)
          node.connect(conv); conv.connect(wet); wet.connect(mix)
          node = mix; break
        }
        case 'delay': {
          const dry = reg(ctx.createGain()); dry.gain.value = 1 - fx.value
          const dl = reg(ctx.createDelay(2)); dl.delayTime.value = 0.375
          const fb = reg(ctx.createGain()); fb.gain.value = 0.4
          const wet = reg(ctx.createGain()); wet.gain.value = fx.value
          const mix = reg(ctx.createGain())
          node.connect(dry); dry.connect(mix)
          node.connect(dl); dl.connect(fb); fb.connect(dl); dl.connect(wet); wet.connect(mix)
          node = mix; break
        }
        case 'tremolo': {
          const out = reg(ctx.createGain()); out.gain.value = 1 - fx.value * 0.5
          const lg = reg(ctx.createGain()); lg.gain.value = fx.value * 0.5
          const lfo = ctx.createOscillator(); m.oscs.push(lfo)
          lfo.type = 'sine'; lfo.frequency.value = 5
          lfo.connect(lg); lg.connect(out.gain); lfo.start()
          node.connect(out); node = out; break
        }
      }
    }
    node.connect(ctx.destination)
  }

  async startRecording(): Promise<void> {
    if (this._mediaRecorder || this.isRecording) return
    if (this.ctx.state === 'suspended') await this.ctx.resume()
    // Tap the master bus — captures everything the engine plays,
    // including any mic inputs already routed through track effects chains.
    this._captureNode  = this.ctx.createMediaStreamDestination()
    this.masterCompressor.connect(this._captureNode)
    this._recChunks    = []
    this._recStartBeat = this.currentBeat
    const preferredMimes = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']
    const mime = preferredMimes.find(m => MediaRecorder.isTypeSupported(m)) ?? ''
    this._mediaRecorder = new MediaRecorder(this._captureNode.stream, mime ? { mimeType: mime } : undefined)
    this._mediaRecorder.ondataavailable = e => { if (e.data.size > 0) this._recChunks.push(e.data) }
    this._mediaRecorder.onerror = e => console.error('[rec] MediaRecorder error:', e)
    this._mediaRecorder.start(100)
    this.isRecording = true
    // live waveform trail
    this.recordingPeaks = []
    const an = this.ctx.createAnalyser()
    an.fftSize = 2048
    this.masterCompressor.connect(an)
    this._recAnalyser = an
    const peakBuf = new Float32Array(an.fftSize)
    this._recPeakTimer = window.setInterval(() => {
      an.getFloatTimeDomainData(peakBuf)
      let m = 0
      for (let i = 0; i < peakBuf.length; i += 4) m = Math.max(m, Math.abs(peakBuf[i]))
      this.recordingPeaks.push(m)
    }, 45)
    console.log('[rec] startRecording — beat:', this._recStartBeat, 'mime:', mime || '(default)', 'stream tracks:', this._captureNode.stream.getTracks().length)
    this.dispatchEvent(new CustomEvent('recording', { detail: { recording: true } }))
  }

  private _stopRecPeaks(): void {
    if (this._recPeakTimer !== null) { clearInterval(this._recPeakTimer); this._recPeakTimer = null }
    if (this._recAnalyser) { try { this.masterCompressor.disconnect(this._recAnalyser) } catch { /* ok */ } this._recAnalyser = null }
  }

  async stopRecording(): Promise<Blob | null> {
    this._stopRecPeaks()
    if (!this._mediaRecorder) return null
    const endBeat = this.currentBeat  // capture before scheduler stops
    this.stopAllMicInputs()
    return new Promise(resolve => {
      this._mediaRecorder!.onstop = () => {
        const mime = this._mediaRecorder?.mimeType || 'audio/webm'
        const blob = new Blob(this._recChunks, { type: mime })
        const durationBeats = Math.max(0.25, endBeat - this._recStartBeat)
        console.log('[rec] stopRecording onstop — chunks:', this._recChunks.length, 'blobSize:', blob.size, 'startBeat:', this._recStartBeat, 'endBeat:', endBeat, 'duration:', durationBeats)
        this._recChunks = []
        if (this._captureNode) {
          try { this.masterCompressor.disconnect(this._captureNode) } catch { /* ok */ }
          this._captureNode = null
        }
        this._mediaRecorder?.stream.getTracks().forEach(t => t.stop())
        this._mediaRecorder = null
        this.isRecording = false
        this.dispatchEvent(new CustomEvent('recording', { detail: { recording: false } }))
        this.dispatchEvent(new CustomEvent('recording-complete', {
          detail: { blob, startBeat: this._recStartBeat, durationBeats },
        }))
        resolve(blob)
      }
      this._mediaRecorder!.stop()
    })
  }

  // ── Tap tempo ─────────────────────────────────────────────────────────────

  private _tapTimes: number[] = []

  tap(): number | null {
    const now = Date.now()
    this._tapTimes = this._tapTimes.filter(t => now - t < 4000)
    this._tapTimes.push(now)
    if (this._tapTimes.length < 2) return null
    const gaps: number[] = []
    for (let i = 1; i < this._tapTimes.length; i++) gaps.push(this._tapTimes[i] - this._tapTimes[i - 1])
    const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length
    return Math.max(40, Math.min(300, Math.round(60000 / avg)))
  }

  // ── Jam buffer ────────────────────────────────────────────────────────────

  startJamBuffer() {
    if (this.isJamActive || this.ctx.state === 'closed') return
    this.isJamActive = true
    this._jamCaptureNode = this.ctx.createMediaStreamDestination()
    this.masterCompressor.connect(this._jamCaptureNode)
    const preferredMimes = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']
    this._jamMime = preferredMimes.find(m => MediaRecorder.isTypeSupported(m)) ?? ''
    this._jamRecorder = new MediaRecorder(
      this._jamCaptureNode.stream,
      this._jamMime ? { mimeType: this._jamMime } : undefined
    )
    this._jamRecorder.ondataavailable = e => {
      if (e.data.size === 0) return
      if (!this._jamHeaderChunk) {
        this._jamHeaderChunk = e.data
        return
      }
      const ts = Date.now()
      this._jamChunks.push({ blob: e.data, ts })
      const cutoff = ts - 40_000
      while (this._jamChunks.length > 1 && this._jamChunks[0].ts < cutoff) this._jamChunks.shift()
    }
    this._jamRecorder.start(500)
  }

  stopJamBuffer() {
    if (!this.isJamActive) return
    this.isJamActive = false
    if (this._jamCaptureNode) {
      try { this.masterCompressor.disconnect(this._jamCaptureNode) } catch { /* ok */ }
      this._jamCaptureNode = null
    }
    if (this._jamRecorder && this._jamRecorder.state !== 'inactive') {
      try { this._jamRecorder.stop() } catch { /* ok */ }
    }
    this._jamRecorder = null
    this._jamChunks = []
    this._jamHeaderChunk = null
  }

  captureJam(durationSeconds = 30): Blob | null {
    if (!this._jamHeaderChunk || this._jamChunks.length === 0) return null
    const cutoff = Date.now() - durationSeconds * 1000
    const recent = this._jamChunks.filter(c => c.ts >= cutoff)
    if (recent.length === 0) return null
    const mime = this._jamMime || 'audio/webm'
    return new Blob([this._jamHeaderChunk, ...recent.map(c => c.blob)], { type: mime })
  }

  // ── Masking detection ─────────────────────────────────────────────────────

  getTrackFrequencyData(trackId: string): Float32Array | null {
    const analyser = this.maskingAnalysers.get(trackId)
    if (!analyser) return null
    const data = new Float32Array(analyser.frequencyBinCount)
    analyser.getFloatFrequencyData(data)
    return data
  }

  // ── Cleanup ────────────────────────────────────────────────────────────────

  dispose() {
    this.stop()
    this.setMetronome(false)
    void this.stopRecording()
    this.stopJamBuffer()
    try { this._exclusiveChan?.close() } catch { /* ok */ }
    this.ctx.close()
  }
}
