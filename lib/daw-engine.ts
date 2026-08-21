'use client'

import type { DawTrack, DawClip, DawProject, AudioClip, MidiClip, AutomationLane, LaunchQuantization, ClipEffect, AutoPoint, ReturnTrack, MidiEffect, MidiNote, VelocityMidiParams, ScaleMidiParams, ChordMidiParams, ArpMidiParams, PolyInstrumentParams, ApolloInstrumentParams, RollFx, TrackInstrument } from './daw-types'
import { isAudioClip, isMidiClip } from './daw-types'
import { tempoSegments, beatToSeconds as mapBeatToSeconds, secondsToBeat as mapSecondsToBeat, meterSegments, nearestBarBeat, type TempoSegment, type MeterSegment } from './tempo-map'
import { resolveNoteFx, fxHasAudibleField, fxHasPitchMod, FX_FIELD_BY_KEY, fieldIsSet } from './roll-fx'
import { resolveArtic, ARTIC_GAP_BEATS, LEGATO_ONSET_SKIP, type ClipArtic } from './articulation'
import { barParamValue, activeBarFields } from './effect-bar'
import { ensurePolySample } from './poly-sample-cache'
import { buildEffectsChain, type EffectHandle } from './daw-effects'
import { buildHeliosFxChain } from './apollo/daw-fx'
import { translateInstrument } from './apollo/daw-synth'
import { snapToScale, arpeggiate, SCALE_INTERVALS, type ArpStyle } from './music-scales'
import { preloadApolloInstrument, apolloStopAll, setApolloCtxTempo } from './apollo/daw-instrument'
import { playInstrumentNote, preloadDrumInstrument, type DrumVoiceHandle } from './daw-instruments'
import { CLIP_EFFECT_PARAM_META, sampleAutomation, normToParam } from './clip-effect-utils'
import { encodeWav } from './wav-codec'
import { wsola, extractTrimmed, pitchShiftBuffer } from './wsola'
import { libraryGetAll } from './sound-library'
import { libraryFulfill, renderPresetAtPitch } from './default-samples'
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
  mainDest: AudioNode                  // where analyser's main output goes (master, or a group bus input)
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
// How far ahead to start decoding sampled-preset / clip buffers before their
// notes are actually scheduled. A cache miss inside the 0.15s schedule window
// skips the note (it fires late once the buffer finally decodes ~0.5s later),
// so we warm buffers this far out to give decodeAudioData time to finish first.
const PREFETCH_LOOKAHEAD = 2.5   // seconds

function interpolateAutomation(lane: AutomationLane, beat: number): number {
  const range = lane.max - lane.min
  if (lane.points.length === 0) {
    return range === 0 ? 0 : (lane.defaultValue - lane.min) / range   // guard max===min → NaN into an AudioParam
  }
  const sorted = [...lane.points].sort((a, b) => a.beat - b.beat)
  if (beat <= sorted[0].beat) return sorted[0].value
  if (beat >= sorted[sorted.length - 1].beat) return sorted[sorted.length - 1].value
  for (let i = 1; i < sorted.length; i++) {
    if (beat <= sorted[i].beat) {
      const span = sorted[i].beat - sorted[i - 1].beat
      if (span === 0) return sorted[i].value   // duplicate-beat points → avoid 0/0
      const t = (beat - sorted[i - 1].beat) / span
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
  // Momentary "performance FX" inserted after the master gain — hold a pad to
  // sweep a filter / duck the mix, release to reset. Neutral by default.
  perfFilter!: BiquadFilterNode
  perfGain!: GainNode
  // Active choke-group voices: key `${trackId}:${group}` → the voice's flat gain.
  private _chokeVoices = new Map<string, GainNode>()

  private trackNodes = new Map<string, TrackNodes>()
  private returnBuses = new Map<string, ReturnBus>()
  private effectsChains = new Map<string, ReturnType<typeof buildEffectsChain>>()
  private _chainSigs = new Map<string, string>()
  // Per-clip SHARED rollFx chain, built once and reused by every note in the
  // clip (keyed by clipId). Every note in a clip has the same reverb/delay/EQ/
  // filter/drive, so building that graph — Convolver included — per note was the
  // main cause of playback stutter in dense arrangements. Torn down on stop /
  // project change; rebuilt if the clip's sound signature changes.
  private _clipFxChains = new Map<string, { input: AudioNode; nodes: AudioNode[]; tailSec: number; sig: string }>()
  // Per-clip cache of note occurrences + the unison-skip set. Both are position-
  // INDEPENDENT (clip-relative), yet were recomputed every 25ms scheduler tick —
  // and the unison guard is O(notes²), ~600k ops/tick for a 780-note clip. Cache
  // it, rebuild only when the clip's notes change (cleared on project change).
  private _unisonCache = new Map<string, { sig: string; occurrences: { note: MidiNote; relBeat: number; key: NoteKey; maxDur: number; connFrom?: number }[]; unisonSkip: Set<string> }>()
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
  private _presetLoading  = new Map<string, Promise<void>>()   // key → in-flight load, so awaiters share the same decode

  setPresets(presets: MidiPreset[]) { this._presets = presets }

  // Transport
  isPlaying = false
  isRecording = false
  tempo = 120
  /** Normalized tempo map (single [beat0, tempo] segment until markers are set).
   *  Source of truth for beat↔seconds during arrangement playback — see tempo-map.ts. */
  private _tempoSegs: TempoSegment[] = [{ beat: 0, bpm: 120 }]
  /** Normalized meter map — drives the metronome downbeat accent under time-sig
   *  changes (single [beat0, 4/4] segment until meter markers are set). */
  private _meterSegs: MeterSegment[] = [{ beat: 0, num: 4, den: 4 }]
  loopEnabled = false
  loopStart = 0
  loopEnd = 16
  swing = 0
  private _beatsPerBar = 4

  private _startCtxTime = 0
  private _startBeat    = 0

  // Offline-render virtualization: when `_renderNow` is non-null the scheduler
  // reads these instead of the wall clock / live ctx time, so one _tick() call
  // pre-schedules the whole window into an OfflineAudioContext. null in normal
  // playback (real-time path completely unaffected).
  private _renderNow: number | null = null
  private _renderCtxBase = 0
  private _renderLookahead = 0

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

  constructor(opts?: { ctx?: AudioContext }) {
    super()
    // An injected context (e.g. an OfflineAudioContext passed in loosely typed)
    // lets the whole graph build off-line for faster-than-real-time rendering.
    // Default is the normal real-time context — studio behaviour is unchanged.
    this.ctx = opts?.ctx ?? new AudioContext({ latencyHint: 'interactive' })

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

    // Performance-FX insert: masterGain → perfFilter → perfGain → analyser.
    this.perfFilter = this.ctx.createBiquadFilter()
    this.perfFilter.type = 'lowpass'
    this.perfFilter.frequency.value = 22000
    this.perfFilter.Q.value = 0.7
    this.perfGain = this.ctx.createGain()
    this.perfGain.gain.value = 1
    this.perfFilter.connect(this.perfGain)
    this.perfGain.connect(this.masterAnalyser)

    this.masterGain = this.ctx.createGain()
    this.masterGain.gain.value = 0.85
    this.masterGain.connect(this.perfFilter)

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

  // Per-track preference: Helios FX is the default; a track sets heliosFx:false
  // to force the legacy WebAudio path (and untranslatable chains fall back
  // automatically). Kept engine-side so ensureTrack callers stay unchanged.
  private heliosFxPref = new Map<string, boolean>()
  private _fxSnapshots = new Map<string, DawTrack['effects']>()

  // Legacy synths on Helios: poly/wavetable instruments translate to Apollo
  // patches and play through the per-track Apollo engine path. Cached by the
  // params OBJECT (SET_INSTRUMENT replaces it, invalidating naturally).
  private _heliosSynthCache = new WeakMap<object, ApolloInstrumentParams | null>()
  private _resolveInstrument(track: DawTrack): TrackInstrument {
    const inst = track.instrument
    if (!inst || (inst.type !== 'poly' && inst.type !== 'wavetable')) return inst
    // poly translates faithfully (same primitives) → Helios by default.
    // wavetable maps its table CONTENT approximately → explicit opt-in only.
    if (inst.type === 'poly' ? track.heliosSynth === false : track.heliosSynth !== true) return inst
    let patch = this._heliosSynthCache.get(inst.params as object)
    if (patch === undefined) {
      patch = translateInstrument(inst) as ApolloInstrumentParams | null
      this._heliosSynthCache.set(inst.params as object, patch)
    }
    return patch ? { type: 'apollo', params: patch } : inst
  }
  setHeliosFxPref(trackId: string, on: boolean) {
    if (this.heliosFxPref.get(trackId) === on) return
    this.heliosFxPref.set(trackId, on)
    this._chainSigs.delete(trackId)   // force a rebuild on next sync
  }

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

      this.trackNodes.set(id, { gain, panner, analyser, effectsInput, midiInput, effectsOutput, sendGains, preSendGains, sendModes, mainDest: this.masterGain })

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
      const wantHelios = this.heliosFxPref.get(id) !== false
      // Helios chains stream continuous param edits into the running worklet
      // (no rebuild, no tail cut) — only STRUCTURE changes rebuild. The legacy
      // path keeps its historical rebuild-on-any-change behavior.
      const sig = wantHelios
        ? JSON.stringify(effects.map(e => ({ i: e.id, t: e.type, en: (e.params as { enabled?: boolean }).enabled !== false }))) + (tempoDependent ? `@${this.tempo}` : '') + '#helios'
        : JSON.stringify(effects) + (tempoDependent ? `@${this.tempo}` : '') + '#legacy'
      if (this._chainSigs.get(id) !== sig) {
        this._chainSigs.set(id, sig)
        this._rebuildEffectsChain(id, effects)
        this._fxSnapshots.set(id, JSON.parse(JSON.stringify(effects)) as DawTrack['effects'])
      } else if (wantHelios) {
        const prev = this._fxSnapshots.get(id)
        const chain = this.effectsChains.get(id)
        if (prev && chain) {
          for (let k = 0; k < effects.length; k++) {
            const cur = effects[k], old = prev[k]
            if (!old || old.id !== cur.id) continue
            const cp = cur.params as unknown as Record<string, unknown>
            const op = old.params as unknown as Record<string, unknown>
            for (const key of Object.keys(cp)) {
              if (cp[key] !== op[key]) chain.handles.get(cur.id)?.setParam(key, cp[key] as number | string | boolean)
            }
          }
        }
        this._fxSnapshots.set(id, JSON.parse(JSON.stringify(effects)) as DawTrack['effects'])
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

    // Helios first (Apollo's hardened engine renders the whole chain in one
    // worklet); untranslatable chains and opted-out tracks use the legacy
    // per-node graph. Same {input,output,handles,dispose} shape either way.
    const wantHelios = this.heliosFxPref.get(trackId) !== false
    const chain = (wantHelios ? buildHeliosFxChain(this.ctx, effects, this.tempo) : null)
      ?? buildEffectsChain(this.ctx, effects, this.tempo)
    nodes.effectsInput.connect(chain.input)
    chain.output.connect(nodes.effectsOutput)
    this.effectsChains.set(trackId, chain as ReturnType<typeof buildEffectsChain>)
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
    this._clearClipFxChains()   // a removed track's clip buses would dangle on its old midiInput
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

    const chain = buildHeliosFxChain(this.ctx, effects, this.tempo) ?? buildEffectsChain(this.ctx, effects, this.tempo)
    bus.input.connect(chain.input)
    chain.output.connect(bus.effectsOutput)
    this.returnEffectsChains.set(returnId, chain as ReturnType<typeof buildEffectsChain>)
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

  /** Point a track's main output at a new destination (a group bus, or master),
   *  reconnecting only that edge so the return-send taps survive. */
  private _routeTrackOutput(id: string, dest: AudioNode) {
    const n = this.trackNodes.get(id)
    if (!n || n.mainDest === dest) return
    try { n.analyser.disconnect(n.mainDest) } catch { /* edge already gone */ }
    try { n.analyser.connect(dest) } catch { /* dest gone */ }
    n.mainDest = dest
  }

  /** Group-aware mute/solo: a track is silenced by its own mute, its group's
   *  mute, or — while any solo is active — by not being on a solo path. A group
   *  bus stays open if it or any of its children is soloed. */
  private _trackSilenced(t: DawTrack, group: DawTrack | undefined, anySolo: boolean, tracks: DawTrack[]): boolean {
    if (t.mute) return true
    if (group && group.mute) return true
    if (!anySolo) return false
    if (t.kind === 'group') {
      const childSoloed = tracks.some(c => c.groupId === t.id && c.solo)
      return !(t.solo || childSoloed)
    }
    return !(t.solo || (group?.solo ?? false))
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

  // When a drum voice with a choke group starts, fade the previous voice in the
  // same (track, group) to silence at that moment — the classic hi-hat choke.
  private _choke(trackId: string, handle: DrumVoiceHandle | undefined, when: number) {
    if (!handle || !handle.chokeGroup) return
    const key = `${trackId}:${handle.chokeGroup}`
    const prev = this._chokeVoices.get(key)
    if (prev && prev !== handle.gain) {
      try {
        prev.gain.cancelScheduledValues(when)
        prev.gain.setTargetAtTime(0.0001, when, 0.004)  // ~12ms fade, click-free
      } catch { /* node already finished */ }
    }
    this._chokeVoices.set(key, handle.gain)
  }

  // Momentary performance FX (hold to apply, 'off' to reset). Ramps so it sweeps.
  perfFX(mode: 'lp' | 'hp' | 'duck' | 'off') {
    if (this.ctx.state === 'closed') return
    const t = this.ctx.currentTime, ramp = 0.18
    const f = this.perfFilter, g = this.perfGain
    if (mode === 'lp') {
      f.type = 'lowpass'; f.Q.setTargetAtTime(7, t, 0.02)
      f.frequency.setTargetAtTime(360, t, ramp)
      g.gain.setTargetAtTime(1, t, ramp)
    } else if (mode === 'hp') {
      f.type = 'highpass'; f.Q.setTargetAtTime(3, t, 0.02)
      f.frequency.setTargetAtTime(1600, t, ramp)
      g.gain.setTargetAtTime(1, t, ramp)
    } else if (mode === 'duck') {
      f.type = 'lowpass'; f.frequency.setTargetAtTime(22000, t, ramp); f.Q.setTargetAtTime(0.7, t, 0.02)
      g.gain.setTargetAtTime(0.22, t, ramp)
    } else { // off — return everything to transparent
      f.frequency.setTargetAtTime(22000, t, ramp)
      f.Q.setTargetAtTime(0.7, t, ramp)
      g.gain.setTargetAtTime(1, t, ramp)
    }
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
    if (this._renderNow != null) return this._renderNow
    if (!this.isPlaying) return this._startBeat
    // Map-aware: elapsed wall-clock seconds are added to the song-seconds at the
    // anchor beat, then mapped back to a beat. With one tempo segment this reduces
    // to `_startBeat + elapsed × tempo/60` — identical to the old single-tempo math.
    const elapsed = this.ctx.currentTime - this._startCtxTime
    return this._beatAtSongSeconds(this._songSeconds(this._startBeat) + elapsed)
  }

  /** Wall-clock seconds from beat 0 to `beat`, across tempo-map segments. */
  private _songSeconds(beat: number): number { return mapBeatToSeconds(beat, this._tempoSegs) }
  /** Inverse of _songSeconds. */
  private _beatAtSongSeconds(sec: number): number { return mapSecondsToBeat(sec, this._tempoSegs) }
  /** Seconds spanned between two absolute beats (signed), across the tempo map. */
  private _spanSeconds(fromBeat: number, toBeat: number): number {
    return this._songSeconds(toBeat) - this._songSeconds(fromBeat)
  }
  /** ctx-time at which absolute `beat` occurs, given the current transport anchor
   *  (now = currentBeat at contextNow). Collapses to contextNow + (beat-now)×60/tempo. */
  private _ctxTimeForBeat(beat: number, now: number, contextNow: number): number {
    return contextNow + this._spanSeconds(now, beat)
  }

  /**
   * Beat position for VISUAL playheads only — lagged by the output-path latency
   * so the on-screen playhead lines up with what's actually heard. A note
   * scheduled at ctx.currentTime doesn't reach the speakers until
   * `outputLatency` later (Bluetooth/wireless adds ~150-250ms; wired ~5-20ms),
   * so an uncompensated playhead visibly crosses a note before you hear it.
   * NEVER use this for scheduling, recording, or edit positions — only drawing.
   */
  get displayBeat(): number {
    if (!this.isPlaying) return this._startBeat
    const lat = this.ctx.outputLatency ?? 0
    return Math.max(0, this.currentBeat - this.secondsToBeats(lat))
  }

  beatsToSeconds(beats: number): number { return beats * (60 / this.tempo) }
  secondsToBeats(seconds: number): number { return seconds * (this.tempo / 60) }

  async play(fromBeat?: number) {
    if (this.ctx.state === 'suspended') await this.ctx.resume()
    if (fromBeat !== undefined) this._startBeat = fromBeat
    // Small scheduling headroom: without it, clips sitting exactly at the play
    // position get startAt values already in the past by the time they're
    // scheduled — the source clamps to "now" while the anti-click ramp stays
    // anchored at startAt, chopping a random slice off the first transient
    // (the "first hit is quieter" bug). 30 ms is imperceptible on Play.
    this._startCtxTime = this.ctx.currentTime + 0.03
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
    this._clearClipFxChains()   // release the shared reverb/delay graphs (frees CPU while paused)
    this._noteKeyVersion++; this._scheduledNoteKeys.clear()
    this._unisonCache.clear()
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
    const newSegs = tempoSegments(project)
    const segsChanged = newSegs.length !== this._tempoSegs.length ||
      newSegs.some((s, i) => s.beat !== this._tempoSegs[i].beat || s.bpm !== this._tempoSegs[i].bpm)
    if (segsChanged || project.tempo !== this.tempo) {
      // Rebase the transport clock BEFORE swapping the tempo map: currentBeat maps
      // elapsed wall-clock seconds through the segments, so replacing them without
      // rebasing re-scales elapsed time and the playhead leaps (a backward leap
      // makes the scheduler re-fire clips on top of still-playing sources, stacking
      // louder). Capturing beatNow under the OLD map and re-anchoring keeps the
      // playhead continuous across a tempo/marker edit.
      const beatNow = this.currentBeat
      const sessionNow = this._sessionClockRunning ? this._sessionBeat() : null
      this.tempo = project.tempo
      this._tempoSegs = newSegs
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
    this._meterSegs   = meterSegments(project)
    this._clips       = project.arrangementClips.filter(isAudioClip)
    this._midiClips   = project.arrangementClips.filter(isMidiClip)
    // Notes may have changed — drop the cached occurrences/unison sets so they
    // rebuild from the new note data on the next tick. (Fires only on edits.)
    this._unisonCache.clear()
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
    // Pre-warm sample-oscillator buffers for poly instruments — same reason as
    // preset buffers: a lazily-loaded sample would miss its first note.
    setApolloCtxTempo(this.ctx, project.tempo)
    for (const track of project.tracks) {
      if (track.instrument?.type === 'drum') void preloadDrumInstrument(this.ctx, track.instrument)
      if (track.instrument?.type === 'apollo') {
        void preloadApolloInstrument(this.ctx, this.trackNodes.get(track.id)?.midiInput, track.instrument.params as ApolloInstrumentParams)
      } else if (track.instrument && (track.instrument.type === 'poly' || track.instrument.type === 'wavetable')) {
        const resolved = this._resolveInstrument(track)
        if (resolved.type === 'apollo') {
          void preloadApolloInstrument(this.ctx, this.trackNodes.get(track.id)?.midiInput, resolved.params as ApolloInstrumentParams)
        }
      }
      if (track.instrument?.type !== 'poly') continue
      const oscs = (track.instrument.params as PolyInstrumentParams).oscillators
      if (!oscs) continue
      for (const l of oscs) if (l.source === 'sample' && l.sampleId) void ensurePolySample(this.ctx, l.sampleId)
    }
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
    const byId          = new Map(project.tracks.map(t => [t.id, t]))
    // Pass 1: make sure every node exists — so a group bus is ready before its
    // children try to route into it.
    for (const t of project.tracks) { this.setHeliosFxPref(t.id, t.heliosFx !== false); this.ensureTrack(t.id, t.effects) }
    // Pass 2: route each track to its group bus (or master) and set its params.
    for (const t of project.tracks) {
      const group      = t.groupId ? byId.get(t.groupId) : undefined
      const groupNodes = group ? this.trackNodes.get(group.id) : undefined
      this._routeTrackOutput(t.id, groupNodes ? groupNodes.effectsInput : this.masterGain)
      const silenced = this._trackSilenced(t, group, anySoloed, project.tracks)
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
      for (const note of processedNotes) {
        const rfx = this._resolveNoteFx(clip, note)
        const sustainSec = rfx.sustain ?? 0
        const noteStartAt = iterationStart + this.beatsToSeconds(this._applySwing(note.startBeat))
        const noteDur     = this.beatsToSeconds(note.durationBeats)
        if (noteStartAt < this.ctx.currentTime - 0.1) continue  // already past
        let noteDest: AudioNode = nodes.midiInput
        if (this._rollFxActive(rfx)) {
          const chain = this._buildRollFxChain(rfx, noteDest, noteStartAt, noteDur, clip.lfoShape)
          noteDest = chain.input
          const ttlMs = (noteStartAt - this.ctx.currentTime + noteDur + sustainSec + chain.tailSec + 1.5) * 1000
          setTimeout(() => this._teardownFxNodes(chain.nodes), Math.max(0, ttlMs))
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
            const vibLfo = fxHasPitchMod(rfx) ? this._applyNotePitchMods(src, rfx, noteStartAt, noteStartAt + noteDur + sustainSec + 0.2, 0, 0, clip.lfoShape) : null
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
            src.onended = () => { src.disconnect(); velGain.disconnect(); vibLfo?.disconnect() }
          }
        } else {
          const h = playInstrumentNote(this.ctx, noteDest, this._resolveInstrument(track), note.pitch, note.velocity, noteStartAt, noteDur + sustainSec)
          this._choke(trackId, h, noteStartAt)
        }
      }
    }

    scheduleLoop(launchCtxTime)
    // The initial call covers iteration 0; the interval schedules each later
    // loop exactly once. Without the `iteration > lastScheduled` guard, the
    // 25 ms interval re-scheduled the SAME iteration ~12× during each lookahead
    // window, stacking a fresh copy of every note per fire → runaway loudness.
    let lastScheduled = 0
    const intervalId = setInterval(() => {
      if (!this._sessionMidiSlots.has(trackId)) return
      const elapsed   = this.ctx.currentTime - launchCtxTime
      const iteration = Math.floor(elapsed / clipDurSec) + 1
      const nextStart = launchCtxTime + iteration * clipDurSec
      if (iteration > lastScheduled && nextStart - this.ctx.currentTime < SCHEDULE_LOOKAHEAD * 2) {
        scheduleLoop(nextStart)
        lastScheduled = iteration
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

  private _loadPresetBuffer(presetId: string, pitch: number): Promise<void> {
    const key = `${presetId}:${pitch}`
    // De-dupe by returning the IN-FLIGHT promise, not a bare early-return.
    // updateProject() fires a fire-and-forget load for every note (populating
    // _presetLoading synchronously up to the first await); the offline bounce
    // then calls _preloadAll() which loads the same keys and AWAITS them before
    // the single scheduling pass. If a duplicate call just `return`ed, that await
    // resolved instantly while the real decode was still in flight, so _tick()
    // ran with every preset buffer still `undefined` and skipped every melodic
    // note — the offline "real mix" came out drums-only. Handing back the shared
    // promise makes the await actually wait for the decode.
    const inflight = this._presetLoading.get(key)
    if (inflight) return inflight
    const job = (async () => {
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

        let buf: AudioBuffer | null = null
        if (exact) {
          const fulfilled = await libraryFulfill(entry.id)
          if (fulfilled?.audioBlob && this.ctx) buf = await this.ctx.decodeAudioData(await fulfilled.audioBlob.arrayBuffer())
        } else if (entry.renderSpec && this.ctx) {
          // No native sample for this exact note — it's outside the instrument's
          // seeded range. Render the instrument AT the requested pitch so it plays
          // the right note instead of the nearest seeded one (e.g. Synth Lead's
          // range was C3–C5, so a G5 lead note used to fold down to C5).
          buf = await renderPresetAtPitch(entry.renderSpec, pitch)
        }
        this._presetBufCache.set(key, buf)
      } catch {
        this._presetBufCache.set(key, null)
      } finally {
        this._presetLoading.delete(key)
      }
    })()
    this._presetLoading.set(key, job)
    return job
  }

  /** Kick off buffer decodes for notes/clips coming up within PREFETCH_LOOKAHEAD
   *  seconds, so they're cached before the scheduler needs them. Only touches
   *  buffers that aren't already cached or loading, so it's cheap per tick. */
  private _prefetchUpcoming(now: number) {
    const until = now + this.secondsToBeats(PREFETCH_LOOKAHEAD)
    for (const clip of this._midiClips) {
      if (!clip.presetId) continue
      // A clip is "coming up" if it starts within the window or is still playing.
      // Warm every pitch it uses (loops repeat the same pitches, so time-gating
      // per note would miss later repetitions — the cache check dedups anyway).
      if (clip.startBeat > until || clip.startBeat + clip.durationBeats < now) continue
      for (const note of clip.notes) {
        const key = `${clip.presetId}:${note.pitch}`
        if (!this._presetBufCache.has(key) && !this._presetLoading.has(key)) {
          void this._loadPresetBuffer(clip.presetId, note.pitch)
        }
      }
    }
    for (const clip of this._clips) {
      if (clip.startBeat > until || clip.startBeat + clip.durationBeats < now) continue
      if (!this.bufferCache.has(clip.id)) void this.loadClipBuffer(clip)
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
    // Offline render: read the virtual clock + a full-window lookahead so this one
    // pass schedules the entire window at absolute offline times.
    const offline = this._renderNow != null

    // Loop wraparound (live only)
    if (!offline && this.loopEnabled && this.currentBeat >= this.loopEnd) {
      this._killAllSources()
      this._noteKeyVersion++; this._scheduledNoteKeys.clear()
      this._startBeat    = this.loopStart
      this._startCtxTime = this.ctx.currentTime + 0.03   // same headroom as play() — don't chop the loop-start hit
      this._nextMetronomeBeat = Math.ceil(this.loopStart)
    }

    const now          = offline ? this._renderNow! : this.currentBeat
    const contextNow   = offline ? this._renderCtxBase : this.ctx.currentTime
    const aheadBeats   = offline ? this._renderLookahead : this.secondsToBeats(SCHEDULE_LOOKAHEAD)

    // Warm sampled buffers well before their notes enter the schedule window, so
    // decodeAudioData finishes in time and the note isn't skipped (and then fired
    // late) on first encounter. Cheap: just cache checks + fire-and-forget loads.
    // (Skipped offline — everything is pre-loaded before the render.)
    if (!offline) this._prefetchUpcoming(now)

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

      const artic = this._clipArtic(clip)
      // Groove (micro-timing per bar position) + drawn volume automation — sample
      // each drawn curve into a 64-slot LUT once per clip; indexed per note below.
      const grooveLut = clip.groove && clip.groove.length >= 2 ? sampleAutomation(clip.groove, 1, 64) : null
      const volLut    = clip.volGraph && clip.volGraph.length >= 2 ? sampleAutomation(clip.volGraph, 1, 64) : null
      const barBeats  = this._beatsPerBar || 4
      const processedNotes = this._applyMidiEffects(clip.notes, track.midiEffects ?? [])

      // Looped clips repeat the note pattern every loopLengthBeats until the
      // clip end. Each occurrence is a (note, repetition) pair with its own
      // dedup key; non-looped clips keep the original single-occurrence key.
      const loopLen = clip.loopEnabled && clip.loopLengthBeats && clip.loopLengthBeats > 0
        ? clip.loopLengthBeats
        : null
      // Occurrences + the unison guard are clip-relative (position-independent)
      // and only change when the clip's notes do — so cache them instead of
      // rebuilding (and recomputing the O(notes²) guard) every 25ms tick.
      const uSig = `${processedNotes.length}:${clip.durationBeats}:${loopLen ?? 0}:${processedNotes[0]?.id ?? ''}:${processedNotes[processedNotes.length - 1]?.id ?? ''}`
      let uCached = this._unisonCache.get(clip.id)
      if (!uCached || uCached.sig !== uSig) {
        const occ: { note: MidiNote; relBeat: number; key: NoteKey; maxDur: number; connFrom?: number }[] = []
        for (const note of processedNotes) {
          if (!loopLen) {
            occ.push({
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
            occ.push({
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
        // starting inside another's span at the same pitch is skipped. O(n²), but
        // now computed once per note-change instead of every tick.
        const skip = new Set<string>()
        for (const a of occ) {
          for (const b of occ) {
            if (a === b || a.note.pitch !== b.note.pitch) continue
            const startsInside = b.relBeat > a.relBeat - 1e-6 && b.relBeat < a.relBeat + a.maxDur - 1e-6
            const tieBreak = Math.abs(b.relBeat - a.relBeat) < 1e-6 ? a.key < b.key : a.relBeat < b.relBeat
            if (startsInside && tieBreak && !skip.has(a.key)) skip.add(b.key)
          }
        }
        // Connected-note runs (for articulation): link each playing note to the
        // most recent note it touches/overlaps, so the scheduler can carry a
        // bow / breath across the phrase and slide between pitches. A gap larger
        // than ARTIC_GAP_BEATS breaks the run (the next note re-attacks).
        // Position-independent, so it's cached with the occurrences.
        const bySt = occ.filter(o => !skip.has(o.key)).sort((a, b) => a.relBeat - b.relBeat || a.note.pitch - b.note.pitch)
        let runEnd = -Infinity, prevPitch = -1
        for (const o of bySt) {
          const connected = prevPitch >= 0 && o.relBeat <= runEnd + ARTIC_GAP_BEATS
          if (connected) o.connFrom = prevPitch
          const end = o.relBeat + o.maxDur
          runEnd = connected ? Math.max(runEnd, end) : end
          prevPitch = o.note.pitch
        }
        uCached = { sig: uSig, occurrences: occ, unisonSkip: skip }
        this._unisonCache.set(clip.id, uCached)
      }
      const occurrences = uCached.occurrences
      const unisonSkip = uCached.unisonSkip

      for (const { note, relBeat, key: noteKey, maxDur, connFrom } of occurrences) {
        if (this._scheduledNoteKeys.has(noteKey)) continue
        if (unisonSkip.has(noteKey)) { this._scheduledNoteKeys.add(noteKey); continue }

        const grooveOff = grooveLut ? (grooveLut[Math.min(63, Math.max(0, Math.floor(((relBeat % barBeats) / barBeats) * 64)))] - 0.5) * 2 * 0.06 : 0
        const noteAbsBeat = clip.startBeat + this._applySwing(relBeat) + grooveOff
        const noteEnd     = clip.startBeat + relBeat + maxDur
        if (noteEnd < now) continue
        if (noteAbsBeat > now + aheadBeats) continue

        const startAt      = this._ctxTimeForBeat(Math.max(now, noteAbsBeat), now, contextNow)
        const alreadyBeats = Math.max(0, now - noteAbsBeat)
        // Map-aware note LENGTH: span the note's remaining beats through the tempo
        // map (not the global tempo) so notes in a tempo-changed section play the
        // right duration. Single segment → identical to beatsToSeconds(maxDur-already).
        const remaining    = this._spanSeconds(noteAbsBeat + alreadyBeats, noteAbsBeat + maxDur)

        // FX-lane clip effects overlapping this note: thread the note's audio
        // through them (audio clips already do this; MIDI silently bypassed
        // them — the "volume effect doesn't touch the piano roll" bug).
        // 'pitch' is excluded: it detunes audio sources, MIDI has none.
        let noteDest: AudioNode = nodes.midiInput
        const rfx = this._resolveNoteFx(clip, note)
        const sustainSec = rfx.sustain ?? 0
        const fxCleanup: { nodes: AudioNode[]; oscs: OscillatorNode[] } = { nodes: [], oscs: [] }
        let clipEffectActive = false
        {
          const overlapping = this._clipEffects.filter(e =>
            e.trackId === clip.trackId && e.type !== 'pitch' &&
            e.startBeat < noteAbsBeat + maxDur &&
            e.startBeat + e.durationBeats > noteAbsBeat
          )
          // The clip's own FX Motion is an effect-bar spanning the whole clip, so
          // notes thread through the SAME renderer. graph.t is normalized (0..1);
          // scale it to the clip's beats here so it stretches with the clip.
          const mot = clip.fxMotion
          if (mot && mot.graph.length >= 2 && activeBarFields(mot.fx).length > 0) {
            // Per-note: the shape spans each note (re-triggers). Whole-clip: one
            // shape stretched over the clip, every note tapping it at its position.
            const span  = mot.perNote ? maxDur : clip.durationBeats
            const start = mot.perNote ? noteAbsBeat : clip.startBeat
            overlapping.push({
              id: `motion:${clip.id}`, trackId: clip.trackId,
              startBeat: start, durationBeats: span,
              fx: mot.fx,
              graph: mot.graph.map(p => ({ ...p, t: p.t * span })),
            })
          }
          // Per-parameter graphs: each FX slider switched to "graph" mode is a
          // one-param bar, target = the field's full-effect extreme so the curve
          // reads 0 = off … top = full.
          if (clip.fxGraphs) {
            for (const key of Object.keys(clip.fxGraphs) as (keyof RollFx)[]) {
              const pg = clip.fxGraphs[key]; const field = FX_FIELD_BY_KEY[key]
              if (!pg || pg.graph.length < 2 || !field) continue
              const target = key === 'filterHz' ? field.fromNorm(0) : field.fromNorm(1)
              const span  = pg.perNote ? maxDur : clip.durationBeats
              const start = pg.perNote ? noteAbsBeat : clip.startBeat
              overlapping.push({
                id: `pg:${clip.id}:${key}`, trackId: clip.trackId,
                startBeat: start, durationBeats: span,
                fx: { [key]: target } as RollFx,
                graph: pg.graph.map(p => ({ ...p, t: p.t * span })),
              })
            }
          }
          if (overlapping.length > 0) {
            clipEffectActive = true
            const entry = this.ctx.createGain()
            fxCleanup.nodes.push(entry)
            let last: AudioNode = entry
            for (const eff of overlapping) {
              const effContextStart  = this._ctxTimeForBeat(Math.max(now, eff.startBeat), now, contextNow)
              const effSeekOffsetSec = Math.max(0, this._spanSeconds(eff.startBeat, now))
              const r = eff.fx ? this._buildEffectBar(eff, last, startAt, effContextStart, effSeekOffsetSec) : this._buildClipEffect(eff, last, startAt, effContextStart, effSeekOffsetSec)
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

        // Resolved clip/preset/note sound. When the clip's sound is uniform (no
        // per-note override, no per-note filter sweep, no overlapping FX-lane
        // region) every note routes through ONE cached chain — otherwise we'd
        // rebuild a full reverb/delay/EQ graph (a Convolver!) per note, which is
        // what made dense arrangements stutter. The per-note amplitude envelope
        // that chain used to hold moves onto the note's own gain (`sharedEnv`).
        let sharedEnv = false
        if (this._rollFxActive(rfx)) {
          const canShare = !note.fx && (rfx.filterEnv ?? 0) === 0 && !clipEffectActive
          if (canShare) {
            noteDest = this._getClipFxChain(clip.id, rfx, nodes.midiInput, clip.lfoShape).input
            sharedEnv = true
          } else {
            const chain = this._buildRollFxChain(rfx, noteDest, startAt, remaining, clip.lfoShape)
            noteDest = chain.input
            const ttlMs = (startAt - contextNow + remaining + sustainSec + chain.tailSec + 1.5) * 1000
            setTimeout(() => this._teardownFxNodes(chain.nodes), Math.max(0, ttlMs))
          }
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
            // Articulation. A note connected to a preceding one (same phrase)
            // carries the bow / breath: suppress its re-attack, and on a fresh
            // onset skip the sample's recorded attack transient (legato). If the
            // instrument slides, glide the pitch in from the previous note.
            const legatoAtk  = artic.legato && connFrom !== undefined
            const legatoSkip = legatoAtk && offsetSec <= 0.0001
            const slideCents = (artic.slideSec > 0 && connFrom !== undefined && connFrom !== note.pitch && offsetSec <= 0.0001)
              ? (connFrom - note.pitch) * 100 : 0

            const velGain = this.ctx.createGain()
            const target = (note.velocity ?? 100) / 127
            // Fade in — 5ms entering mid-waveform, 3ms on a fresh onset: even
            // sample starts click when they don't sit on a zero crossing. When
            // this note uses the shared clip chain (`sharedEnv`), the attack /
            // decay / sustain-level that used to live inside that chain are
            // folded onto this gain so they still retrigger per note. Otherwise
            // (sharedEnv false) this is exactly the old 3/5ms fade. A legato note
            // keeps only the click-guard fade — no swell — so the line breathes
            // as one bow.
            const baseAtk = offsetSec > 0 ? 0.005 : 0.003
            const atk  = legatoAtk ? 0.004 : (sharedEnv ? Math.max(baseAtk, rfx.attack ?? 0) : baseAtk)
            const dec  = sharedEnv ? (rfx.decay ?? 0) : 0
            const susL = sharedEnv ? (rfx.sustainLevel ?? 1) : 1
            const susTarget = (dec > 0 || susL < 1) ? target * susL : target
            // A hand-drawn amplitude envelope (clip.ampGraph, 0..1 over the note)
            // replaces the ADSR ramps with a freehand shape, scaled by velocity.
            const ampGraph = clip.ampGraph
            const useAmp = !!ampGraph && ampGraph.length >= 2 && remaining > 0
            const ampDur = Math.max(0.02, remaining + sustainSec)
            if (useAmp) {
              // Sample the whole envelope, then play the portion from where the
              // note already is — entering mid-note continues the shape instead
              // of restarting it.
              const totalSec = Math.max(0.02, this._spanSeconds(noteAbsBeat, noteAbsBeat + maxDur) + sustainSec)
              const N = Math.max(8, Math.ceil(totalSec * 90))
              const full = sampleAutomation(ampGraph!, 1, N)
              const startIdx = Math.min(N - 2, Math.max(0, Math.floor((alreadyBeats / Math.max(1e-6, maxDur)) * N)))
              const slice = full.slice(startIdx)
              const curve = new Float32Array(Math.max(2, slice.length))
              for (let i = 0; i < curve.length; i++) curve[i] = Math.max(0.0001, (slice[i] ?? slice[slice.length - 1] ?? 0) * target)
              velGain.gain.setValueCurveAtTime(curve, startAt, ampDur)
            } else {
              velGain.gain.setValueAtTime(0.0001, startAt)
              velGain.gain.linearRampToValueAtTime(target, startAt + atk)
              if (dec > 0) velGain.gain.linearRampToValueAtTime(target * susL, startAt + atk + dec)
              else if (susL < 1) velGain.gain.setValueAtTime(target * susL, startAt + atk)
            }
            const src = this.ctx.createBufferSource()
            src.buffer = buf
            if (loop) { src.loop = true; src.loopStart = loop.start; src.loopEnd = loop.end }
            // A drawn pitch contour (clip.pitchGraph) bends the note over its
            // length: v 0.5 = in tune, 1 = +12 st, 0 = −12 st. It owns detune, so
            // it replaces the pitch-env / slide / vibrato mods for this note.
            const pitchG = clip.pitchGraph
            let vibLfo: AudioScheduledSourceNode | null = null
            if (pitchG && pitchG.length >= 2) {
              const totalSec = Math.max(0.02, this._spanSeconds(noteAbsBeat, noteAbsBeat + maxDur) + sustainSec)
              const M = Math.max(8, Math.ceil(totalSec * 60))
              const full = sampleAutomation(pitchG, 1, M)
              const sIdx = Math.min(M - 2, Math.max(0, Math.floor((alreadyBeats / Math.max(1e-6, maxDur)) * M)))
              const slice = full.slice(sIdx)
              const base = rfx.detune ?? 0
              const cents = new Float32Array(Math.max(2, slice.length))
              for (let i = 0; i < cents.length; i++) cents[i] = base + ((slice[i] ?? 0.5) - 0.5) * 2 * 1200
              try { src.detune.setValueCurveAtTime(cents, startAt, remaining + sustainSec) } catch { /* overlap */ }
            } else {
              vibLfo = (fxHasPitchMod(rfx) || slideCents !== 0)
                ? this._applyNotePitchMods(src, rfx, startAt, startAt + remaining + sustainSec + 0.2, slideCents, artic.slideSec, clip.lfoShape)
                : null
            }
            src.connect(velGain)
            // Drawn clip volume automation: a gain node after velGain that
            // follows the volume curve over THIS note's slice of the clip, so a
            // held note fades with the curve rather than a fixed level.
            if (volLut) {
              const volNode = this.ctx.createGain()
              const cdur = Math.max(1e-6, clip.durationBeats)
              const p0 = relBeat / cdur, p1 = Math.min(1, (relBeat + maxDur) / cdur)
              const Nv = Math.max(4, Math.ceil((remaining + sustainSec) * 40))
              const vcurve = new Float32Array(Nv)
              for (let i = 0; i < Nv; i++) { const p = p0 + (p1 - p0) * (i / (Nv - 1)); vcurve[i] = Math.max(0.0001, volLut[Math.min(63, Math.max(0, Math.floor(p * 63)))]) }
              try { volNode.gain.setValueCurveAtTime(vcurve, startAt, Math.max(0.02, remaining + sustainSec)) } catch { /* overlap */ }
              velGain.connect(volNode); volNode.connect(noteDest)
              setTimeout(() => { try { volNode.disconnect() } catch { /* ok */ } }, Math.max(0, (startAt - contextNow + remaining + sustainSec + 2) * 1000))
            } else {
              velGain.connect(noteDest)
            }
            this._registerMidiVoice(src, velGain)
            src.start(startAt, legatoSkip ? Math.min(LEGATO_ONSET_SKIP, buf.duration * 0.25) : offsetSec)
            if (useAmp) {
              // The drawn envelope defines the whole shape (incl. its own tail).
              src.stop(startAt + ampDur + 0.03)
            } else if (remaining > 0) {
              if (sustainSec > 0) {
                // Sustain: let the sample ring past the note's end with a release
                // ramp instead of the hard cut — pedal-like, far more natural.
                velGain.gain.setValueAtTime(susTarget, startAt + remaining)
                velGain.gain.linearRampToValueAtTime(0.0001, startAt + remaining + sustainSec)
                src.stop(startAt + remaining + sustainSec + 0.05)
              } else if (loop) {
                // A looped note ends at full level — an 80ms release avoids the click
                velGain.gain.setValueAtTime(susTarget, Math.max(startAt + atk, startAt + remaining - 0.08))
                velGain.gain.linearRampToValueAtTime(0.0001, startAt + remaining)
                src.stop(startAt + remaining + 0.02)
              } else {
                // micro-release — stopping mid-waveform clicks
                velGain.gain.setValueAtTime(susTarget, Math.max(startAt + atk, startAt + remaining - 0.008))
                velGain.gain.linearRampToValueAtTime(0.0001, startAt + remaining)
                src.stop(startAt + remaining + 0.01)
              }
            }
            src.onended = () => { src.disconnect(); velGain.disconnect(); vibLfo?.disconnect() }
          }
        } else {
          // Pass the FULL note length + how far in we are, so a poly voice that
          // uses a sample resumes at the right phase instead of restarting when
          // the playhead enters mid-note.
          const noteOffsetSec = this.beatsToSeconds(alreadyBeats)
          const h = playInstrumentNote(this.ctx, noteDest, this._resolveInstrument(track), note.pitch, note.velocity, startAt, this._spanSeconds(noteAbsBeat, noteAbsBeat + maxDur) + sustainSec, noteOffsetSec)
          this._choke(track.id, h, startAt)
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
        // shared snap (lib/music-scales): same signed octave-wrap as Apollo's
        // scale lock — the old inline version snapped a note just below the
        // root DOWN the whole scale instead of up one semitone
        const intervals = SCALE_INTERVALS[p.scale] ?? SCALE_INTERVALS.major
        result = result.map(n => ({ ...n, pitch: snapToScale(n.pitch, p.root, intervals) }))
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
          // shared ordering (lib/music-scales) — Apollo's arp modes, with an
          // unbiased shuffle (the old sort(() => random-0.5) was biased)
          const expanded = arpeggiate(chord.map(n => n.pitch), p.style as ArpStyle, p.octaves)

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
    // Optional clip gain envelope: an extra node in series, created ONLY when
    // the clip has one — every other clip keeps the untouched source→fadeGain
    // path, so existing playback is unaffected. Automated below once startAt and
    // the effective duration are known.
    const envPoints = clip.gainPoints && clip.gainPoints.length > 0 ? clip.gainPoints : null
    const envGain = envPoints ? this.ctx.createGain() : null
    if (envGain) { source.connect(envGain); envGain.connect(fadeGain) } else { source.connect(fadeGain) }

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
    // Map-aware: the clip's beat window / elapsed / start convert through the
    // tempo map at the clip's actual position, so a tempo change mid-song places
    // and lengths the clip correctly (single-segment → old single-tempo math).
    const clipDuration  = this._spanSeconds(clip.startBeat, clip.startBeat + clip.durationBeats)
    // How far past the clip's start the transport already is. Scheduling always
    // runs a little behind the clock (the first tick after Play especially), so
    // TINY lateness must NOT become a buffer seek — skipping the first few ms
    // of a one-shot eats its transient ("the first snare is quieter"). Under
    // 50 ms late: play the whole clip, a hair late — inaudible and intact.
    // Genuinely mid-clip (a real seek/loop entry): keep the honest offset.
    const lateSec       = now > clip.startBeat ? this._spanSeconds(clip.startBeat, now) : 0
    const alreadyPlayed = lateSec > 0.05 ? lateSec : 0
    const startAt       = alreadyPlayed > 0
      ? this._ctxTimeForBeat(Math.max(now, clip.startBeat), now, contextNow)
      : this._ctxTimeForBeat(clip.startBeat, now, contextNow)

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
        // alreadyPlayed (not the raw clock) — tiny scheduling lateness must not
        // seek into the buffer and eat the transient (first-hit-quieter bug)
        const seekOffset = alreadyPlayed * stretchFactor + clip.trimStart
        const totalDuration = buf.duration - clip.trimStart - clip.trimEnd
        effectiveDuration = Math.min(totalDuration, clipDuration * stretchFactor) - (seekOffset - clip.trimStart)
        effectiveDuration = Math.max(0, effectiveDuration)
        source.start(startAt, seekOffset, effectiveDuration)
      }
    } else {
      // Normal playback (also handles boomerang — playBuf is ping-pong buffer when active)
      source.buffer = playBuf
      const trimStartForSeek = boomerangActive ? 0 : clip.trimStart
      // alreadyPlayed (not the raw clock) — see above
      const seekOffset    = alreadyPlayed + trimStartForSeek
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
    // The clip's own drawn FX (FX Motion + per-parameter graphs) span the whole
    // clip — synthesize them as bars so audio flows through the same renderer.
    const mot = clip.fxMotion
    if (mot && mot.graph.length >= 2 && activeBarFields(mot.fx).length > 0) {
      insertEffects.push({ id: `motion:${clip.id}`, trackId: clip.trackId, startBeat: clip.startBeat, durationBeats: clip.durationBeats, fx: mot.fx, graph: mot.graph.map(p => ({ ...p, t: p.t * clip.durationBeats })) })
    }
    if (clip.fxGraphs) {
      for (const key of Object.keys(clip.fxGraphs) as (keyof RollFx)[]) {
        const pg = clip.fxGraphs[key]; const field = FX_FIELD_BY_KEY[key]
        if (!pg || pg.graph.length < 2 || !field) continue
        const target = key === 'filterHz' ? field.fromNorm(0) : field.fromNorm(1)
        insertEffects.push({ id: `pg:${clip.id}:${key}`, trackId: clip.trackId, startBeat: clip.startBeat, durationBeats: clip.durationBeats, fx: { [key]: target } as RollFx, graph: pg.graph.map(p => ({ ...p, t: p.t * clip.durationBeats })) })
      }
    }

    let lastNode: AudioNode = fadeGain
    const allExtraNodes: AudioNode[] = []
    const allExtraOscs: OscillatorNode[] = []
    // Drawn volume automation across the clip (musical time), sliced from where
    // we already are so seeking mid-clip continues the shape.
    if (clip.volGraph && clip.volGraph.length >= 2) {
      const total = this.beatsToSeconds(clip.durationBeats)
      const N = Math.max(8, Math.ceil(total * 60))
      const full = sampleAutomation(clip.volGraph, 1, N)
      const sIdx = Math.min(N - 2, Math.max(0, Math.floor((alreadyPlayed / Math.max(1e-6, total)) * N)))
      const slice = full.slice(sIdx)
      const vg = this.ctx.createGain()
      const curve = new Float32Array(Math.max(2, slice.length))
      for (let i = 0; i < curve.length; i++) curve[i] = Math.max(0.0001, slice[i] ?? slice[slice.length - 1] ?? 1)
      try { vg.gain.setValueCurveAtTime(curve, startAt, Math.max(0.02, total - alreadyPlayed)) } catch { /* overlap */ }
      lastNode.connect(vg); lastNode = vg
      allExtraNodes.push(vg)
    }
    for (const eff of insertEffects) {
      // When seeking mid-clip, use now-relative timing so already-active effects start immediately
      const effContextStart   = this._ctxTimeForBeat(Math.max(now, eff.startBeat), now, contextNow)
      const effSeekOffsetSec  = Math.max(0, this._spanSeconds(eff.startBeat, now))
      const r = eff.fx ? this._buildEffectBar(eff, lastNode, startAt, effContextStart, effSeekOffsetSec) : this._buildClipEffect(eff, lastNode, startAt, effContextStart, effSeekOffsetSec)
      lastNode = r.output
      allExtraNodes.push(...r.extraNodes)
      allExtraOscs.push(...r.extraOscs)
    }
    // The clip's own sound settings (shared with the piano-roll "Sound" panel).
    if (clip.rollFx && this._rollFxActive(clip.rollFx)) {
      const chain = this._buildRollFxChain(clip.rollFx, nodes.effectsInput, startAt, effectiveDuration || undefined)
      lastNode.connect(chain.input)
      allExtraNodes.push(...chain.nodes)   // stopped/disconnected on teardown
    } else {
      lastNode.connect(nodes.effectsInput)
    }

    // Pitch effects modify source.detune (added on top of effectiveDetune)
    for (const eff of pitchEffects) {
      const effContextStart   = this._ctxTimeForBeat(Math.max(now, eff.startBeat), now, contextNow)
      const effSeekOffsetSec  = Math.max(0, this._spanSeconds(eff.startBeat, now))
      this._applyPitchEffect(eff, source, effContextStart, effectiveDetune, effSeekOffsetSec)
    }

    // Always ramp from 0 to clip.gain at startAt — prevents pop/static from non-zero
    // first sample at any seekOffset.  5 ms is inaudible as a fade but eliminates the click.
    const ANTI_CLICK_S = 0.005
    // If scheduling ran late, the source is clamped to "now" — anchor the ramp
    // there too, or the first samples play into a partially-raised gain and the
    // transient loses a random few dB (audible on one-shots at the playhead).
    const rampAt = Math.max(startAt, fadeGain.context.currentTime)
    if (clip.fadeIn > 0) {
      const fs = this.beatsToSeconds(clip.fadeIn)
      fadeGain.gain.setValueAtTime(0, rampAt)
      fadeGain.gain.linearRampToValueAtTime(clip.gain, rampAt + Math.max(fs, ANTI_CLICK_S))
    } else {
      fadeGain.gain.setValueAtTime(0, rampAt)
      fadeGain.gain.linearRampToValueAtTime(clip.gain, rampAt + ANTI_CLICK_S)
    }
    if (clip.fadeOut > 0 && effectiveDuration > 0) {
      const fs        = this.beatsToSeconds(clip.fadeOut)
      const fadeStart = Math.max(startAt, startAt + effectiveDuration - fs)
      fadeGain.gain.setValueAtTime(clip.gain, fadeStart)
      fadeGain.gain.linearRampToValueAtTime(0, startAt + effectiveDuration)
    }

    // Ride the gain envelope on the dedicated node (multiplies the fades above).
    if (envGain && envPoints && effectiveDuration > 0) {
      const dur = effectiveDuration
      const pts = [...envPoints].sort((a, b) => a.t - b.t)
      envGain.gain.setValueAtTime(Math.max(0, pts[0].g), startAt)
      for (const p of pts) {
        const t = Math.min(1, Math.max(0, p.t))
        envGain.gain.linearRampToValueAtTime(Math.max(0, p.g), startAt + t * dur)
      }
    }

    // Reverb/delay tails need to ring out after the source stops — longest wins.
    const maxReverbTailSec = insertEffects.reduce((max, e) => {
      if (e.fx) {
        let t = 0
        if (fieldIsSet('reverbWet', e.fx.reverbWet)) t = Math.max(t, 0.6 + (e.fx.reverbSize ?? 0.4) * 3.4)
        if (fieldIsSet('delayWet', e.fx.delayWet))   t = Math.max(t, (e.fx.delayTime ?? 0.25) * 8)
        return Math.max(max, t)
      }
      return e.type === 'reverb' ? Math.max(max, e.params?.reverbDecay ?? 2) : max
    }, 0)

    const entry: ScheduledSource = { source, gainNode: fadeGain, clipId: clip.id, basePlaybackRate }
    this.scheduledSources.push(entry)
    source.onended = () => {
      const idx = this.scheduledSources.indexOf(entry)
      if (idx !== -1) this.scheduledSources.splice(idx, 1)
      source.disconnect()

      const cleanupTail = () => {
        fadeGain.disconnect()
        for (const n of allExtraNodes) { try { (n as OscillatorNode).stop?.() } catch { /* not a source */ } try { n.disconnect() } catch { /* ok */ } }
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

  private _reverbIRs = new Map<number, AudioBuffer>()
  private _distCurves = new Map<number, Float32Array>()

  /** Impulse response cached by decay length (seconds) so reverb "size" works. */
  private _getReverbIR(decaySec = 2.2): AudioBuffer {
    const key = Math.round(decaySec * 10) / 10
    let ir = this._reverbIRs.get(key)
    if (!ir) {
      const sr = this.ctx.sampleRate
      const len = Math.max(1, Math.floor(sr * key))
      ir = this.ctx.createBuffer(2, len, sr)
      for (let ch = 0; ch < 2; ch++) {
        const d = ir.getChannelData(ch)
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6)
      }
      this._reverbIRs.set(key, ir)
    }
    return ir
  }

  private _getDistCurve(drive: number): Float32Array {
    // `drive` is the shaping amount 0..1. k scales from 0 (identity — no jump
    // when a drive/distortion slider first leaves zero) up to a hard clip at 1.
    // Finer cache key (×100) keeps the gentle low end from snapping to coarse steps.
    const key = Math.round(drive * 100)
    let c = this._distCurves.get(key)
    if (!c) {
      const k = drive * 50
      c = new Float32Array(1024)
      const norm = Math.tanh(k)
      for (let i = 0; i < 1024; i++) {
        const x = i / 511.5 - 1
        c[i] = norm < 1e-6 ? x : Math.tanh(k * x) / norm   // k→0 ⇒ identity, no NaN
      }
      this._distCurves.set(key, c)
    }
    return c
  }

  /** Tear down a per-note FX chain: stop any LFO oscillators, then disconnect. */
  private _teardownFxNodes(nodes: AudioNode[]) {
    for (const nd of nodes) {
      try { (nd as OscillatorNode).stop?.() } catch { /* not a source / already stopped */ }
      try { nd.disconnect() } catch { /* ok */ }
    }
  }

  /** Signature of the CLIP-shared portion of a resolved rollFx bag — everything
   *  except the parts that legitimately vary per note (amplitude envelope +
   *  filter-envelope sweep, folded onto the note's own gain instead). Two notes
   *  with the same signature can share one FX graph. */
  private _clipFxSig(rfx: RollFx): string {
    const r = rfx as Record<string, unknown>
    let s = ''
    for (const k of Object.keys(r).sort()) {
      if (k === 'attack' || k === 'decay' || k === 'sustainLevel' || k === 'sustain' || k === 'filterEnv') continue
      const v = r[k]
      if (v !== undefined && v !== null) s += k + ':' + v + ';'
    }
    return s
  }

  /** Get (or lazily build) the shared FX chain for a clip, rebuilding only if
   *  the clip's sound signature changed. Built with no note timing, so it holds
   *  none of the per-note envelope — just the static/continuous graph. */
  private _getClipFxChain(clipId: string, rfx: RollFx, dest: AudioNode, lfoShape?: AutoPoint[]): { input: AudioNode; tailSec: number } {
    const sig = this._clipFxSig(rfx) + (lfoShape ? '|lfo:' + lfoShape.length + ':' + (lfoShape[1]?.v ?? '') : '')
    const cached = this._clipFxChains.get(clipId)
    if (cached && cached.sig === sig) return cached
    if (cached) this._teardownFxNodes(cached.nodes)
    const built = this._buildRollFxChain(rfx, dest, undefined, undefined, lfoShape)
    const entry = { input: built.input, nodes: built.nodes, tailSec: built.tailSec, sig }
    this._clipFxChains.set(clipId, entry)
    return entry
  }

  private _clearClipFxChains() {
    for (const c of this._clipFxChains.values()) this._teardownFxNodes(c.nodes)
    this._clipFxChains.clear()
  }

  /** Source-side pitch shaping for a sampled note: fine detune, a pitch-envelope
   *  glide, and vibrato. Returns the vibrato LFO (to disconnect) or null. */
  private _applyNotePitchMods(src: AudioBufferSourceNode, rfx: RollFx, startAt: number, stopAt: number, slideCents = 0, slideSec = 0, lfoShape?: AutoPoint[]): AudioScheduledSourceNode | null {
    const base = rfx.detune ?? 0
    // pitch-envelope and articulation slide are both "start detuned, glide to the
    // note" — combine them into one ramp so they don't fight over src.detune.
    const startOff = ((rfx.pitchEnv ?? 0) !== 0 ? rfx.pitchEnv! * 100 : 0) + slideCents
    const glide = Math.max((rfx.pitchEnv ?? 0) !== 0 ? (rfx.pitchEnvTime ?? 0.08) : 0, slideSec)
    if (startOff !== 0 && glide > 0) {
      src.detune.setValueAtTime(base + startOff, startAt)
      src.detune.linearRampToValueAtTime(base, startAt + glide)
    } else if (base !== 0) {
      src.detune.value = base
    }
    if ((rfx.vibratoDepth ?? 0) > 0) {
      const lfo = this._lfoNode(rfx.vibratoRate ?? 5, lfoShape)
      const lg = this.ctx.createGain(); lg.gain.value = rfx.vibratoDepth! * 100  // ±cents
      lfo.connect(lg); lg.connect(src.detune)
      lfo.start(startAt)
      try { lfo.stop(Math.max(startAt + 0.05, stopAt)) } catch { /* ok */ }
      return lfo
    }
    return null
  }

  /** The effective per-note sound: preset sound → clip rollFx → note override,
   *  with the preset's pitch graphs modulating by the note's pitch. */
  private _resolveNoteFx(clip: MidiClip, note: MidiNote): RollFx {
    const sound = clip.presetId ? this._presets.find(p => p.id === clip.presetId)?.sound : undefined
    if (!sound && !clip.rollFx && !note.fx) return {}
    return resolveNoteFx(sound, clip.rollFx, note)
  }

  /** The clip's effective articulation (legato / slide), from its instrument
   *  family default with any per-clip (or preset) override. Sampled-preset clips
   *  only — synth track instruments don't carry family tags yet. */
  private _clipArtic(clip: MidiClip): ClipArtic {
    if (!clip.presetId) return { legato: false, slideSec: 0 }
    const preset = this._presets.find(p => p.id === clip.presetId)
    if (!preset) return { legato: false, slideSec: 0 }
    const psFx = preset.sound?.fx
    const fx = {
      legato: clip.rollFx?.legato ?? psFx?.legato,
      slide:  clip.rollFx?.slide  ?? psFx?.slide,
    }
    return resolveArtic(preset.group, preset.category, preset.name, fx)
  }

  /** Does a resolved bag need an audio chain? (sustain is applied to the gain
   *  envelope, not the chain, so it doesn't count here.) */
  private _rollFxActive(rfx: RollFx): boolean {
    return fxHasAudibleField(rfx)
  }

  /** Legacy static entry (kept for callers passing a clip's own rollFx). */
  static rollFxActive(rfx: MidiClip['rollFx']): boolean {
    return fxHasAudibleField(rfx)
  }

  /** Per-note chain from a resolved RollFx bag. `startAt`/`dur` enable the
   *  time-scheduled parts (amplitude envelope, filter envelope). */
  // An LFO source: a drawn one-cycle shape looped as a buffer, or a plain sine.
  // Both are AudioScheduledSourceNodes, so callers connect/start/stop uniformly.
  private _lfoBufCache = new Map<string, AudioBuffer>()
  private _lfoNode(rate: number, shape?: AutoPoint[]): AudioScheduledSourceNode {
    if (shape && shape.length >= 2) {
      const N = 256
      const sig = shape.map(p => `${p.t.toFixed(3)}:${p.v.toFixed(3)}`).join('|')
      let buf = this._lfoBufCache.get(sig)
      if (!buf) {
        buf = this.ctx.createBuffer(1, N, this.ctx.sampleRate)
        const ch = buf.getChannelData(0)
        const samp = sampleAutomation(shape, 1, N)
        for (let i = 0; i < N; i++) ch[i] = (samp[i] - 0.5) * 2   // 0..1 → −1..1
        this._lfoBufCache.set(sig, buf)
      }
      const src = this.ctx.createBufferSource()
      src.buffer = buf; src.loop = true
      src.playbackRate.value = Math.max(0.0001, rate * N / this.ctx.sampleRate)  // loop at `rate` Hz
      return src
    }
    const osc = this.ctx.createOscillator(); osc.type = 'sine'; osc.frequency.value = rate
    return osc
  }

  private _buildRollFxChain(rfx: RollFx, dest: AudioNode, startAt?: number, dur?: number, lfoShape?: AutoPoint[]): { input: AudioNode; nodes: AudioNode[]; tailSec: number } {
    const ctx = this.ctx
    const nodes: AudioNode[] = []
    const input = ctx.createGain()
    nodes.push(input)
    let last: AudioNode = input
    let tail = 0
    const gain = (v: number) => { const g = ctx.createGain(); g.gain.value = v; nodes.push(g); return g }

    // Amplitude envelope (attack / decay / sustain level). Release stays on the
    // source's own gain (handled in the note scheduler).
    const atk = rfx.attack ?? 0, dec = rfx.decay ?? 0, susL = rfx.sustainLevel ?? 1
    if (startAt !== undefined && (atk > 0 || dec > 0 || susL < 1)) {
      const eg = gain(1)
      eg.gain.setValueAtTime(atk > 0 ? 0.0001 : 1, startAt)
      const t1 = startAt + Math.max(0.001, atk)
      eg.gain.linearRampToValueAtTime(1, t1)
      if (dec > 0) eg.gain.linearRampToValueAtTime(susL, t1 + dec)
      else if (susL < 1) eg.gain.setValueAtTime(susL, t1)
      last.connect(eg); last = eg
    }

    if (rfx.highpassHz !== undefined && rfx.highpassHz > 22) {
      const f = ctx.createBiquadFilter()
      f.type = 'highpass'; f.frequency.value = rfx.highpassHz; f.Q.value = 0.7
      last.connect(f); last = f; nodes.push(f)
    }
    // Low-pass, with optional envelope sweep and auto-wah LFO.
    const wantLp = (rfx.filterHz !== undefined && rfx.filterHz < 17500) || (rfx.filterEnv ?? 0) !== 0 || (rfx.filterLfoDepth ?? 0) > 0
    if (wantLp) {
      const base = (rfx.filterHz !== undefined && rfx.filterHz < 17500) ? rfx.filterHz : 2000
      const f = ctx.createBiquadFilter()
      f.type = 'lowpass'; f.frequency.value = base; f.Q.value = rfx.filterQ ?? 0.8
      last.connect(f); last = f; nodes.push(f)
      if ((rfx.filterEnv ?? 0) !== 0 && startAt !== undefined) {
        const startFreq = Math.max(30, Math.min(20000, base * Math.pow(2, -3 * rfx.filterEnv!)))
        const envTime = atk > 0 ? atk : 0.2
        f.frequency.setValueAtTime(startFreq, startAt)
        f.frequency.exponentialRampToValueAtTime(Math.max(30, base), startAt + envTime)
      }
      if ((rfx.filterLfoDepth ?? 0) > 0) {
        const lfo = this._lfoNode(rfx.filterLfoRate ?? 5, lfoShape)
        const lg = gain(rfx.filterLfoDepth! * base * 0.6)
        lfo.connect(lg); lg.connect(f.frequency); lfo.start()
        nodes.push(lfo as unknown as AudioNode)
      }
    }
    // Drive — gentle soft-clip, distinct from the harder distortion below.
    if ((rfx.drive ?? 0) > 0) {
      const ws = ctx.createWaveShaper()
      // Gentle soft-clip that scales from clean at 0. Max amount 0.5 keeps drive
      // clearly softer than the harder `distortion` below (which reaches 1.0).
      ws.curve = this._getDistCurve(rfx.drive! * 0.5) as Float32Array<ArrayBuffer>
      ws.oversample = '2x'
      const pg = gain(1 - rfx.drive! * 0.25)
      last.connect(ws); ws.connect(pg); last = pg; nodes.push(ws)
    }
    if ((rfx.distortion ?? 0) > 0) {
      const ws = ctx.createWaveShaper()
      ws.curve = this._getDistCurve(rfx.distortion!) as Float32Array<ArrayBuffer>
      ws.oversample = '2x'
      const pg = gain(1 - rfx.distortion! * 0.4)  // tame the level lift saturation adds
      last.connect(ws); ws.connect(pg); last = pg; nodes.push(ws)
    }
    // Bitcrush — quantise sample amplitude to fewer levels.
    if ((rfx.bitcrush ?? 0) > 0) {
      const bits = Math.max(1.5, 16 - rfx.bitcrush! * 14.5)
      const levels = Math.pow(2, bits)
      const curve = new Float32Array(1024)
      for (let i = 0; i < 1024; i++) { const x = (i / 1023) * 2 - 1; curve[i] = Math.round(x * levels) / levels }
      const ws = ctx.createWaveShaper(); ws.curve = curve as Float32Array<ArrayBuffer>
      last.connect(ws); last = ws; nodes.push(ws)
    }
    // 4-band tone EQ
    if ((rfx.sub ?? 0) !== 0 || (rfx.bass ?? 0) !== 0 || (rfx.mid ?? 0) !== 0 || (rfx.treble ?? 0) !== 0) {
      const sub = ctx.createBiquadFilter(); sub.type = 'lowshelf';  sub.frequency.value = 70;   sub.gain.value = rfx.sub ?? 0
      const bs  = ctx.createBiquadFilter(); bs.type = 'lowshelf';   bs.frequency.value = 200;   bs.gain.value = rfx.bass ?? 0
      const md  = ctx.createBiquadFilter(); md.type = 'peaking';    md.frequency.value = 1000; md.Q.value = 1; md.gain.value = rfx.mid ?? 0
      const tr  = ctx.createBiquadFilter(); tr.type = 'highshelf';  tr.frequency.value = 8000;  tr.gain.value = rfx.treble ?? 0
      last.connect(sub); sub.connect(bs); bs.connect(md); md.connect(tr); last = tr
      nodes.push(sub, bs, md, tr)
    }
    // Chorus — a short modulated delay blended back in.
    if ((rfx.chorusDepth ?? 0) > 0) {
      const d = rfx.chorusDepth!
      const dry = gain(1), wet = gain(0.5 * d), sum = gain(1)
      const dl = ctx.createDelay(0.05); dl.delayTime.value = 0.02
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.8
      const lg = gain(0.006)
      lfo.connect(lg); lg.connect(dl.delayTime); lfo.start()
      last.connect(dry); dry.connect(sum)
      last.connect(dl); dl.connect(wet); wet.connect(sum)
      last = sum; nodes.push(dl, lfo as unknown as AudioNode)
    }
    // Flanger — chorus with feedback and a shorter, deeper sweep.
    if ((rfx.flanger ?? 0) > 0) {
      const a = rfx.flanger!
      const dry = gain(1), wet = gain(a), sum = gain(1)
      const dl = ctx.createDelay(0.02); dl.delayTime.value = 0.003
      const fb = gain(0.6 * a)
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.3
      const lg = gain(0.002 * a)
      lfo.connect(lg); lg.connect(dl.delayTime); lfo.start()
      last.connect(dry); dry.connect(sum)
      last.connect(dl); dl.connect(fb); fb.connect(dl); dl.connect(wet); wet.connect(sum)
      last = sum; nodes.push(dl, fb, lfo as unknown as AudioNode)
    }
    // Phaser — cascaded all-pass filters swept by an LFO.
    if ((rfx.phaser ?? 0) > 0) {
      const a = rfx.phaser!
      const dry = gain(1), wet = gain(a), sum = gain(1)
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.4
      const lg = gain(700 * a)
      let apLast: AudioNode = last
      for (let i = 0; i < 4; i++) {
        const ap = ctx.createBiquadFilter(); ap.type = 'allpass'; ap.frequency.value = 400 + i * 350; ap.Q.value = 0.6
        lg.connect(ap.frequency)
        apLast.connect(ap); apLast = ap; nodes.push(ap)
      }
      lfo.connect(lg); lfo.start()
      last.connect(dry); dry.connect(sum)
      apLast.connect(wet); wet.connect(sum)
      last = sum; nodes.push(lfo as unknown as AudioNode)
    }
    // Tremolo — amplitude LFO.
    if ((rfx.tremoloDepth ?? 0) > 0) {
      const depth = rfx.tremoloDepth!
      const amp = gain(1 - depth * 0.5)
      const lfo = this._lfoNode(rfx.tremoloRate ?? 5, lfoShape)
      const lg = gain(depth * 0.5)
      lfo.connect(lg); lg.connect(amp.gain); lfo.start()
      last.connect(amp); last = amp; nodes.push(lfo as unknown as AudioNode)
    }
    // Auto-pan — pan position LFO.
    if ((rfx.autopanDepth ?? 0) > 0) {
      const p = ctx.createStereoPanner()
      const lfo = this._lfoNode(rfx.autopanRate ?? 2, lfoShape)
      const lg = gain(Math.min(1, rfx.autopanDepth!))
      lfo.connect(lg); lg.connect(p.pan); lfo.start()
      last.connect(p); last = p; nodes.push(p, lfo as unknown as AudioNode)
    }
    // Stereo width (mid/side)
    if (rfx.width !== undefined && Math.abs(rfx.width - 1) > 1e-4) {
      const w = Math.max(0, Math.min(2, rfx.width))
      const split = ctx.createChannelSplitter(2)
      const merge = ctx.createChannelMerger(2)
      const mid = gain(0.5)
      const sideL = gain(0.5 * w), sideR = gain(-0.5 * w), side = gain(1)
      const outL = gain(1), outR = gain(1), negSide = gain(-1)
      last.connect(split)
      split.connect(mid, 0); split.connect(mid, 1)
      split.connect(sideL, 0); split.connect(sideR, 1)
      sideL.connect(side); sideR.connect(side)
      mid.connect(outL); side.connect(outL)
      side.connect(negSide); mid.connect(outR); negSide.connect(outR)
      outL.connect(merge, 0, 0); outR.connect(merge, 0, 1)
      last = merge; nodes.push(split, merge)
    }
    if (rfx.gain !== undefined && Math.abs(rfx.gain - 1) > 1e-4) {
      const g = gain(Math.max(0, rfx.gain)); last.connect(g); last = g
    }
    if (rfx.pan !== undefined && Math.abs(rfx.pan) > 0.02) {
      const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, rfx.pan))
      last.connect(p); last = p; nodes.push(p)
    }
    // Wet sends (reverb + delay) sum in parallel at the end.
    const wantReverb = (rfx.reverbWet ?? 0) > 0
    const wantDelay  = (rfx.delayWet ?? 0) > 0
    if (wantReverb || wantDelay) {
      const sum = gain(1)
      const dry = gain(1 - (rfx.reverbWet ?? 0) * 0.5)
      last.connect(dry); dry.connect(sum)
      if (wantReverb) {
        const decay = 0.6 + (rfx.reverbSize ?? 0.4) * 3.4
        const pre = ctx.createDelay(0.3); pre.delayTime.value = Math.min(0.2, rfx.reverbPredelay ?? 0)
        const conv = ctx.createConvolver(); conv.buffer = this._getReverbIR(decay)
        const wet = gain(rfx.reverbWet!)
        last.connect(pre); pre.connect(conv); conv.connect(wet); wet.connect(sum)
        nodes.push(pre, conv); tail = Math.max(tail, decay + 0.4)
      }
      if (wantDelay) {
        const t = rfx.delayTime ?? 0.25
        const fbAmt = Math.min(0.9, rfx.delayFeedback ?? 0.3)
        const wetAmt = rfx.delayWet!
        const pp = rfx.delayPingpong ?? 0
        if (pp > 0.02) {
          const dL = ctx.createDelay(1.5); dL.delayTime.value = t
          const dR = ctx.createDelay(1.5); dR.delayTime.value = t
          const fbL = gain(fbAmt), fbR = gain(fbAmt)
          const panL = ctx.createStereoPanner(); panL.pan.value = -pp
          const panR = ctx.createStereoPanner(); panR.pan.value = pp
          const wet = gain(wetAmt)
          last.connect(dL)
          dL.connect(fbL); fbL.connect(dR); dR.connect(fbR); fbR.connect(dL)  // cross-feedback
          dL.connect(panL); dR.connect(panR); panL.connect(wet); panR.connect(wet); wet.connect(sum)
          nodes.push(dL, dR, panL, panR)
        } else {
          const dl = ctx.createDelay(1.2); dl.delayTime.value = t
          const fb = gain(fbAmt)
          const wet = gain(wetAmt)
          last.connect(dl); dl.connect(fb); fb.connect(dl); dl.connect(wet); wet.connect(sum)
          nodes.push(dl)
        }
        tail = Math.max(tail, t * 8 + 1)
      }
      last = sum
    }
    last.connect(dest)
    return { input, nodes, tailSec: tail }
  }

  /**
   * Effect bar: build the automated chain for a multi-parameter region. Each
   * active param in `eff.fx` follows the region's single `graph` (0=neutral,
   * 1=target) via setValueCurveAtTime; wet-mix effects fade their wet in, and
   * waveshapers/tremolo/pan crossfade or scale their depth by the graph.
   */
  private _buildEffectBar(
    eff: ClipEffect,
    input: AudioNode,
    _startAt: number,
    effContextStart: number,
    effSeekOffsetSec = 0,
  ): { output: AudioNode; extraNodes: AudioNode[]; extraOscs: OscillatorNode[] } {
    const ctx = this.ctx
    const extraNodes: AudioNode[] = []
    const extraOscs: OscillatorNode[] = []
    const n = <T extends AudioNode>(node: T): T => { extraNodes.push(node); return node }
    const fx = eff.fx ?? {}
    const graph = eff.graph ?? []
    const active = activeBarFields(fx)
    if (active.length === 0) { const g = n(ctx.createGain()); input.connect(g); return { output: g, extraNodes, extraOscs } }

    // A curve for `param.setValueCurveAtTime`, mapping the graph (0..1) → values.
    const sched = (param: AudioParam, map: (g: number) => number) => {
      const { curve, durSec } = this._slicedCurve(graph, eff.durationBeats, effSeekOffsetSec, map)
      // If this bar starts AFTER the note already began, pin the param at its
      // NEUTRAL value (graph = 0) from the note's start until the bar's region.
      // Otherwise the node's construction default (e.g. a lowpass biquad sits at
      // 350 Hz, not "open") processes the note before the effect should exist —
      // which reads as the OTHER effect getting cancelled during the wait. Only
      // when the start is genuinely in the future (not a mid-effect seek-in).
      if (effContextStart > _startAt + 1e-4) {
        try { param.setValueAtTime(map(0), _startAt) } catch { /* ok */ }
      }
      try { param.setValueCurveAtTime(curve, effContextStart, durSec) } catch { /* overlapping curve */ }
    }
    const has = (k: keyof typeof fx) => fieldIsSet(k, fx[k] as number | undefined)
    const F = FX_FIELD_BY_KEY

    let last: AudioNode = input

    if (has('highpassHz')) {
      const f = n(ctx.createBiquadFilter()); f.type = 'highpass'; f.Q.value = 0.7
      sched(f.frequency, g => barParamValue(F.highpassHz, fx.highpassHz!, g))
      last.connect(f); last = f
    }
    if (has('filterHz')) {
      const f = n(ctx.createBiquadFilter()); f.type = 'lowpass'; f.Q.value = fx.filterQ ?? 0.8
      sched(f.frequency, g => barParamValue(F.filterHz, fx.filterHz!, g))
      last.connect(f); last = f
    }
    // Filter envelope sweep + auto-wah LFO — same semantics as the Sound panel
    // (these bar fields used to be silently ignored on audio clips, which read
    // as "my effect changes stopped changing").
    if ((fx.filterEnv ?? 0) > 0 || (fx.filterLfoDepth ?? 0) > 0) {
      const base = (fx.filterHz !== undefined && fx.filterHz < 17500) ? fx.filterHz : 2000
      const f = n(ctx.createBiquadFilter())
      f.type = 'lowpass'; f.frequency.value = base; f.Q.value = fx.filterQ ?? 0.8
      if ((fx.filterEnv ?? 0) > 0) {
        const startFreq = Math.max(30, Math.min(20000, base * Math.pow(2, -3 * fx.filterEnv!)))
        try {
          f.frequency.setValueAtTime(startFreq, effContextStart)
          f.frequency.exponentialRampToValueAtTime(Math.max(30, base), effContextStart + 0.2)
        } catch { /* overlapping automation */ }
      }
      if ((fx.filterLfoDepth ?? 0) > 0) {
        const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = fx.filterLfoRate ?? 5
        const lg = n(ctx.createGain())
        lfo.connect(lg); lg.connect(f.frequency); lfo.start(); extraOscs.push(lfo)
        sched(lg.gain, g => fx.filterLfoDepth! * base * 0.6 * g)
      }
      last.connect(f); last = f
    }
    // Waveshapers (drive/distortion/bitcrush) — crossfade clean↔shaped by the graph.
    const crossfadeShaper = (curveArr: Float32Array) => {
      const ws = n(ctx.createWaveShaper()); ws.curve = curveArr as Float32Array<ArrayBuffer>; ws.oversample = '2x'
      const dry = n(ctx.createGain()), wet = n(ctx.createGain()), sum = n(ctx.createGain())
      last.connect(dry); dry.connect(sum)
      last.connect(ws); ws.connect(wet); wet.connect(sum)
      sched(dry.gain, g => 1 - g)
      sched(wet.gain, g => g)
      last = sum
    }
    if (has('drive'))      crossfadeShaper(this._getDistCurve(fx.drive! * 0.5) as Float32Array<ArrayBuffer>)
    if (has('distortion')) crossfadeShaper(this._getDistCurve(fx.distortion!) as Float32Array<ArrayBuffer>)
    if (has('bitcrush')) {
      const bits = Math.max(1.5, 16 - fx.bitcrush! * 14.5), levels = Math.pow(2, bits)
      const c = new Float32Array(1024); for (let i = 0; i < 1024; i++) { const x = (i / 1023) * 2 - 1; c[i] = Math.round(x * levels) / levels }
      crossfadeShaper(c)
    }
    // Tone EQ — automate each shelf/peak gain from 0 dB → target.
    for (const k of ['sub', 'bass', 'mid', 'treble'] as const) {
      if (!has(k)) continue
      const f = n(ctx.createBiquadFilter())
      if (k === 'sub')  { f.type = 'lowshelf';  f.frequency.value = 70 }
      if (k === 'bass') { f.type = 'lowshelf';  f.frequency.value = 200 }
      if (k === 'mid')  { f.type = 'peaking';   f.frequency.value = 1000; f.Q.value = 1 }
      if (k === 'treble') { f.type = 'highshelf'; f.frequency.value = 8000 }
      sched(f.gain, g => barParamValue(F[k], fx[k]!, g))
      last.connect(f); last = f
    }
    // Chorus / flanger / phaser — build wet path, fade wet in by the graph.
    const modWet = (build: () => { wetIn: AudioNode; wetOut: AudioNode }, target: number) => {
      const { wetIn, wetOut } = build()
      const dry = n(ctx.createGain()), wet = n(ctx.createGain()), sum = n(ctx.createGain())
      last.connect(dry); dry.connect(sum)
      last.connect(wetIn); wetOut.connect(wet); wet.connect(sum)
      sched(wet.gain, g => target * g)
      last = sum
    }
    if (has('chorusDepth')) modWet(() => {
      const dl = n(ctx.createDelay(0.05)); dl.delayTime.value = 0.02
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.8; const lg = n(ctx.createGain()); lg.gain.value = 0.006
      lfo.connect(lg); lg.connect(dl.delayTime); lfo.start(); extraOscs.push(lfo)
      return { wetIn: dl, wetOut: dl }
    }, fx.chorusDepth! * 0.6)
    if (has('flanger')) modWet(() => {
      const dl = n(ctx.createDelay(0.02)); dl.delayTime.value = 0.003
      const fb = n(ctx.createGain()); fb.gain.value = 0.6 * fx.flanger!
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.3; const lg = n(ctx.createGain()); lg.gain.value = 0.002 * fx.flanger!
      lfo.connect(lg); lg.connect(dl.delayTime); lfo.start(); extraOscs.push(lfo)
      dl.connect(fb); fb.connect(dl)
      return { wetIn: dl, wetOut: dl }
    }, fx.flanger!)
    if (has('phaser')) modWet(() => {
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.4; const lg = n(ctx.createGain()); lg.gain.value = 700 * fx.phaser!
      const entry = n(ctx.createGain()); let apLast: AudioNode = entry
      for (let i = 0; i < 4; i++) { const ap = n(ctx.createBiquadFilter()); ap.type = 'allpass'; ap.frequency.value = 400 + i * 350; ap.Q.value = 0.6; lg.connect(ap.frequency); apLast.connect(ap); apLast = ap }
      lfo.connect(lg); lfo.start(); extraOscs.push(lfo)
      return { wetIn: entry, wetOut: apLast }
    }, fx.phaser!)
    // Tremolo — amplitude LFO, depth scaled by the graph.
    if (has('tremoloDepth')) {
      const amp = n(ctx.createGain()); amp.gain.value = 1
      const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = fx.tremoloRate ?? 5
      const lg = n(ctx.createGain())
      lfo.connect(lg); lg.connect(amp.gain); lfo.start(); extraOscs.push(lfo)
      sched(lg.gain, g => fx.tremoloDepth! * 0.5 * g)
      // keep centre so gain stays ~1 while depth grows
      sched(amp.gain, g => 1 - fx.tremoloDepth! * 0.5 * g)
      last.connect(amp); last = amp
    }
    // Auto-pan — pan LFO, depth scaled by the graph.
    if (has('autopanDepth')) {
      const p = n(ctx.createStereoPanner())
      const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = fx.autopanRate ?? 2
      const lg = n(ctx.createGain())
      lfo.connect(lg); lg.connect(p.pan); lfo.start(); extraOscs.push(lfo)
      sched(lg.gain, g => Math.min(1, fx.autopanDepth!) * g)
      last.connect(p); last = p
    }
    // Stereo width (mid/side), side gain automated.
    if (has('width')) {
      const split = n(ctx.createChannelSplitter(2)), merge = n(ctx.createChannelMerger(2))
      const mid = n(ctx.createGain()); mid.gain.value = 0.5
      const sideL = n(ctx.createGain()), sideR = n(ctx.createGain()), side = n(ctx.createGain())
      const outL = n(ctx.createGain()), outR = n(ctx.createGain()), negSide = n(ctx.createGain()); negSide.gain.value = -1
      last.connect(split)
      split.connect(mid, 0); split.connect(mid, 1)
      split.connect(sideL, 0); split.connect(sideR, 1)
      sideL.connect(side); sideR.connect(side)
      mid.connect(outL); side.connect(outL); side.connect(negSide); mid.connect(outR); negSide.connect(outR)
      outL.connect(merge, 0, 0); outR.connect(merge, 0, 1)
      sched(sideL.gain, g => 0.5 * barParamValue(F.width, fx.width!, g))
      sched(sideR.gain, g => -0.5 * barParamValue(F.width, fx.width!, g))
      last = merge
    }
    if (has('gain')) { const g = n(ctx.createGain()); sched(g.gain, x => barParamValue(F.gain, fx.gain!, x)); last.connect(g); last = g }
    if (has('pan'))  { const p = n(ctx.createStereoPanner()); sched(p.pan, x => barParamValue(F.pan, fx.pan!, x)); last.connect(p); last = p }
    // Wet sends (reverb + delay) — fade wet in by the graph.
    if (has('reverbWet')) {
      const conv = n(ctx.createConvolver()); conv.buffer = this._getReverbIR(0.6 + (fx.reverbSize ?? 0.4) * 3.4)
      const dry = n(ctx.createGain()), wet = n(ctx.createGain()), sum = n(ctx.createGain())
      last.connect(dry); dry.connect(sum); last.connect(conv); conv.connect(wet); wet.connect(sum)
      sched(wet.gain, g => fx.reverbWet! * g); last = sum
    }
    if (has('delayWet') || (fx.delayPingpong ?? 0) > 0) {
      const t = fx.delayTime ?? 0.25
      const fbAmt = Math.min(0.9, fx.delayFeedback ?? 0.3)
      const wetTarget = has('delayWet') ? fx.delayWet! : 0.35   // pingpong alone implies a delay
      const pp = Math.max(0, Math.min(1, fx.delayPingpong ?? 0))
      const dry = n(ctx.createGain()), wet = n(ctx.createGain()), sum = n(ctx.createGain())
      last.connect(dry); dry.connect(sum)
      if (pp > 0) {
        // ping-pong: cross-fed L/R delays, stereo spread scaled by the amount
        const dl = n(ctx.createDelay(2)), dr = n(ctx.createDelay(2))
        dl.delayTime.value = t; dr.delayTime.value = t
        const fbl = n(ctx.createGain()), fbr = n(ctx.createGain())
        fbl.gain.value = fbAmt; fbr.gain.value = fbAmt
        const pl = n(ctx.createStereoPanner()), pr = n(ctx.createStereoPanner())
        pl.pan.value = -pp; pr.pan.value = pp
        last.connect(dl)
        dl.connect(fbl); fbl.connect(dr)
        dr.connect(fbr); fbr.connect(dl)
        dl.connect(pl); pl.connect(wet)
        dr.connect(pr); pr.connect(wet)
      } else {
        const dl = n(ctx.createDelay(1.2)); dl.delayTime.value = t
        const fb = n(ctx.createGain()); fb.gain.value = fbAmt
        last.connect(dl); dl.connect(fb); fb.connect(dl); dl.connect(wet)
      }
      wet.connect(sum)
      sched(wet.gain, g => wetTarget * g); last = sum
    }
    return { output: last, extraNodes, extraOscs }
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
    // Legacy single-effect path — only reached for un-migrated data; bars go to
    // _buildEffectBar. Fields are optional on ClipEffect now, so default them.
    const params = eff.params ?? {}
    if (!eff.type) { const g = n(ctx.createGain()); input.connect(g); return { output: g, extraNodes, extraOscs } }

    switch (eff.type) {
      case 'volume': {
        const g = n(ctx.createGain())
        const meta = CLIP_EFFECT_PARAM_META.volume
        if (eff.automation?.points.length) {
          const { curve, durSec } = this._slicedCurve(eff.automation.points, eff.durationBeats, effSeekOffsetSec, v => normToParam(v, meta))
          g.gain.setValueCurveAtTime(curve, effContextStart, durSec)
        } else {
          const env = params.shapeEnvelope
          if (env && env.length > 0) {
            const baseGain = params.gain ?? 1
            const sr       = params.shapeSampleRate ?? 30
            const skip     = Math.floor(effSeekOffsetSec * sr)
            const startVal = skip < env.length ? env[skip] : env[env.length - 1]
            g.gain.setValueAtTime(Math.max(0, startVal * baseGain), effContextStart)
            for (let i = skip + 1; i < env.length; i++) {
              const t = effContextStart + (i - skip) / sr
              if (t > ctx.currentTime) g.gain.linearRampToValueAtTime(Math.max(0, env[i] * baseGain), t)
            }
          } else {
            g.gain.value = params.gain ?? 1
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
        f.type = params.filterType ?? 'lowpass'
        f.Q.value = params.filterQ ?? 1
        if (eff.automation?.points.length) {
          const meta = CLIP_EFFECT_PARAM_META.filter
          const { curve, durSec } = this._slicedCurve(eff.automation.points, eff.durationBeats, effSeekOffsetSec, v => normToParam(v, meta))
          f.frequency.setValueCurveAtTime(curve, effContextStart, durSec)
        } else {
          f.frequency.value = params.frequency ?? 1000
        }
        input.connect(f)
        return { output: f, extraNodes, extraOscs }
      }
      case 'tremolo': {
        const depth = params.tremoloDepth ?? 0.5
        const outG = n(ctx.createGain()); outG.gain.value = 1 - depth * 0.5
        const lfoG = n(ctx.createGain()); lfoG.gain.value = depth * 0.5
        const lfo = ctx.createOscillator(); extraOscs.push(lfo)
        lfo.type = 'sine'
        if (eff.automation?.points.length) {
          const meta = CLIP_EFFECT_PARAM_META.tremolo
          const { curve, durSec } = this._slicedCurve(eff.automation.points, eff.durationBeats, effSeekOffsetSec, v => normToParam(v, meta))
          lfo.frequency.setValueCurveAtTime(curve, effContextStart, durSec)
        } else {
          lfo.frequency.value = params.tremoloRate ?? 4
        }
        lfo.connect(lfoG); lfoG.connect(outG.gain)
        // Start LFO offset by seek so its phase matches mid-effect position
        input.connect(outG); lfo.start(startAt - effSeekOffsetSec)
        return { output: outG, extraNodes, extraOscs }
      }
      case 'reverb': {
        const staticWet = params.reverbWet ?? 0.3
        const dry  = n(ctx.createGain())
        const wetG = n(ctx.createGain())
        const conv = n(ctx.createConvolver()); conv.buffer = this._makeIR(params.reverbDecay ?? 2)
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
        const staticWet = params.delayWet ?? 0.3
        const dry   = n(ctx.createGain())
        const delay = n(ctx.createDelay(2.0)); delay.delayTime.value = params.delayTime ?? 0.375
        const fbG   = n(ctx.createGain()); fbG.gain.value = Math.min(0.95, params.feedback ?? 0.4)
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
        ws.curve = this._makeDistortionCurve(params.distortion ?? 0.5)
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
    const params    = eff.params ?? {}
    const baseCents = (params.semitones ?? 0) * 100 + clipDetuneOffset

    if (eff.automation?.points.length) {
      const { curve, durSec } = this._slicedCurve(
        eff.automation.points, eff.durationBeats, effSeekOffsetSec,
        v => normToParam(v, meta) * 100 + clipDetuneOffset,
      )
      source.detune.setValueCurveAtTime(curve, effContextStart, durSec)
      source.detune.setValueAtTime(clipDetuneOffset, effContextStart + durSec)
    } else {
      const env = params.shapeEnvelope
      if (env && env.length > 0) {
        const sr    = params.shapeSampleRate ?? 30
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
    this._chokeVoices.clear()  // voices are being killed; drop stale choke refs
    // Apollo worklet instruments: silence + discard (the midiInput bus swap
    // below orphans their connection; they rebuild on the next play)
    apolloStopAll(this.ctx)
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

    // Cached per-clip FX chains (shared reverb/delay/EQ graphs) were built wired
    // to the midiInput buses we just swapped away — leaving them cached would
    // route every note scheduled after this point into the dead old bus (silent).
    // Tear them down so the next note rebuilds against the fresh midiInput. This
    // is the loop-wrap / seek counterpart to stop()'s _clearClipFxChains().
    this._clearClipFxChains()
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
      const when       = this._ctxTimeForBeat(Math.max(currentBeat, this._nextMetronomeBeat), currentBeat, now)
      // Downbeat = a bar START in the meter map (honors mid-song time-sig changes);
      // collapses to `% beatsPerBar` when there are no meter markers.
      const isDownbeat = Math.abs(nearestBarBeat(this._nextMetronomeBeat, this._meterSegs) - this._nextMetronomeBeat) < 1e-6
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

  /** Await every sample / preset / poly buffer this project needs, so an offline
   *  render (one synchronous pass) never drops a note whose buffer wasn't ready. */
  private async _preloadAll(): Promise<void> {
    // Collect THUNKS (not started promises) so we can throttle them. Fulfilling a
    // sampled/soundfont preset note spins up a real AudioContext per note (see
    // renderSoundfont); firing every note at once blows past the browser's
    // ~6-live-context limit, so most sampled instruments throw, resolve to a null
    // buffer, and get silently dropped from the bounce — which is why an offline
    // render of a sample-heavy song came out as drums only. Studio playback never
    // hit this because notes load gradually. Run the jobs through a small pool.
    const thunks: Array<() => Promise<unknown>> = []
    for (const clip of this._clips) thunks.push(() => Promise.resolve(this.loadClipBuffer(clip)))
    for (const clip of this._midiClips) {
      const presetId = clip.presetId
      if (!presetId) continue
      const seen = new Set<number>()
      for (const note of clip.notes) {
        if (seen.has(note.pitch)) continue
        seen.add(note.pitch)
        const pitch = note.pitch
        thunks.push(() => Promise.resolve(this._loadPresetBuffer(presetId, pitch)))
      }
    }
    for (const track of this._tracks) {
      // baked drum-pad samples must be decoded before the single offline
      // scheduler pass, or every hit silently falls back to the synth voice
      if (track.instrument?.type === 'drum') {
        const inst = track.instrument
        thunks.push(() => preloadDrumInstrument(this.ctx, inst))
      }
      const resolvedInst = this._resolveInstrument(track)
      if (resolvedInst?.type === 'apollo') {
        // worklet module + patch + samples must be live before the offline
        // scheduler's single pass posts absolute-time note events — this
        // covers real apollo instruments AND translated poly/wavetable ones
        const patch = resolvedInst.params as ApolloInstrumentParams
        const dest = this.trackNodes.get(track.id)?.midiInput
        thunks.push(() => preloadApolloInstrument(this.ctx, dest, patch))
      }
      if (track.instrument?.type !== 'poly') continue
      const oscs = (track.instrument.params as PolyInstrumentParams).oscillators
      if (!oscs) continue
      for (const l of oscs) if (l.source === 'sample' && l.sampleId) {
        const sampleId = l.sampleId
        thunks.push(() => Promise.resolve(ensurePolySample(this.ctx, sampleId)))
      }
    }

    // Preset-note decodes render into their OWN OfflineAudioContexts (which don't
    // count against the browser's ~6 live *real* AudioContext cap — soundfonts now
    // share one decode context), so we can fan out wider than the old bound of 4
    // to use more cores and shorten the one-time full-song bounce.
    const CONCURRENCY = 8
    let next = 0
    const worker = async () => {
      while (next < thunks.length) {
        const idx = next++
        try { await thunks[idx]() } catch { /* a failed preload just leaves that note silent */ }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, thunks.length) }, worker))
  }

  /**
   * Faster-than-real-time render. The engine must have been constructed with an
   * OfflineAudioContext sized to the window, and updateProject()'d. Pre-loads
   * every buffer, then virtual-clocks a single scheduler pass so every note in
   * [startBeat,endBeat] is scheduled at its absolute offline time, and renders the
   * whole graph in one startRendering(). Returns lossless float channels.
   */
  async renderOffline(opts: { startBeat: number; endBeat: number }): Promise<{ sampleRate: number; channels: Float32Array[] }> {
    const start = opts.startBeat, end = opts.endBeat
    const octx = this.ctx as unknown as OfflineAudioContext
    await this._preloadAll()
    // Helios FX chains initialize asynchronously (worklet + patch + ack) —
    // rendering before they confirm bakes a dry/silent chain into the bounce
    await Promise.all(
      [...this.effectsChains.values(), ...this.returnEffectsChains.values()]
        .map(c => (c as { ready?: Promise<void> }).ready)
        .filter(Boolean),
    )
    this.loopEnabled = false
    this.isPlaying   = true
    this._startBeat  = start
    this._renderCtxBase   = 0
    this._renderLookahead = (end - start) + 1e-3
    this._renderNow  = start          // virtual clock ON — scheduler pre-schedules the window
    try { this._tick() } finally {
      this._renderNow = null           // virtual clock OFF
      this.isPlaying  = false
    }
    const rendered = await octx.startRendering()
    const channels: Float32Array[] = []
    for (let c = 0; c < rendered.numberOfChannels; c++) channels.push(rendered.getChannelData(c).slice())
    return { sampleRate: rendered.sampleRate, channels }
  }

  /**
   * Dev/analysis bounce: play a beat range in real time and capture lossless
   * PCM off the master bus (and, with `stems`, each track's post-FX output),
   * returning base64 float WAV(s). Used by window.__dawRenderWav so an agent can
   * render what it built and measure the mix (loudness / clipping / balance).
   * Real-time — a 16s slice takes ~16s. Keep ranges short for quick checks.
   */
  async renderWav(opts: {
    startBeat?: number; endBeat?: number; stems?: boolean; mono?: boolean; tailSec?: number
  } = {}): Promise<{ sampleRate: number; durationSec: number; startBeat: number; endBeat: number; master: string; stems?: Record<string, string> }> {
    if (this.ctx.state === 'suspended') await this.ctx.resume()
    const sr    = this.ctx.sampleRate
    const start = opts.startBeat ?? 0
    const clips = [...this._midiClips, ...this._clips]
    const end   = opts.endBeat ?? (clips.length ? Math.max(...clips.map(c => c.startBeat + c.durationBeats)) : start + 4)
    const tail  = opts.tailSec ?? 1.5
    const mono  = opts.mono ?? false

    type Cap = { name: string; node: AudioNode; proc: ScriptProcessorNode; chunks: [Float32Array, Float32Array][] }
    const caps: Cap[] = []
    const sink = this.ctx.createGain(); sink.gain.value = 0; sink.connect(this.ctx.destination)
    const addCap = (name: string, node: AudioNode) => {
      const proc = this.ctx.createScriptProcessor(8192, 2, 2)
      const chunks: [Float32Array, Float32Array][] = []
      proc.onaudioprocess = (e) => {
        const ib = e.inputBuffer
        const L = new Float32Array(ib.getChannelData(0))
        const R = new Float32Array(ib.numberOfChannels > 1 ? ib.getChannelData(1) : ib.getChannelData(0))
        chunks.push([L, R])
      }
      node.connect(proc); proc.connect(sink)
      caps.push({ name, node, proc, chunks })
    }
    addCap('master', this.masterCompressor)
    if (opts.stems) {
      for (const t of this._tracks) {
        const nodes = this.trackNodes.get(t.id)
        if (nodes) addCap(t.name || t.id, nodes.panner)
      }
    }

    this.seek(start)
    await this.play(start)
    await new Promise<void>(res => {
      const tick = () => { if (!this.isPlaying || this.currentBeat >= end) res(); else setTimeout(tick, 30) }
      tick()
    })
    await new Promise(r => setTimeout(r, Math.round(tail * 1000)))
    this.stop()

    for (const c of caps) { try { c.node.disconnect(c.proc) } catch { /* ok */ } c.proc.onaudioprocess = null; try { c.proc.disconnect() } catch { /* ok */ } }
    try { sink.disconnect() } catch { /* ok */ }

    const b64 = (buf: ArrayBuffer): string => {
      const bytes = new Uint8Array(buf); let s = ''
      const CH = 0x8000
      for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CH)))
      return btoa(s)
    }
    const assemble = (c: Cap): string => {
      const total = c.chunks.reduce((n, ch) => n + ch[0].length, 0)
      const L = new Float32Array(total), R = new Float32Array(total)
      let o = 0
      for (const [l, r] of c.chunks) { L.set(l, o); R.set(r, o); o += l.length }
      let channels: Float32Array[]
      if (mono) { const mchan = new Float32Array(total); for (let i = 0; i < total; i++) mchan[i] = (L[i] + R[i]) * 0.5; channels = [mchan] }
      else channels = [L, R]
      return b64(encodeWav(channels, sr))
    }
    const master = assemble(caps[0])
    let stems: Record<string, string> | undefined
    if (opts.stems) { stems = {}; for (const c of caps.slice(1)) stems[c.name] = assemble(c) }
    const durationSec = caps[0].chunks.reduce((n, ch) => n + ch[0].length, 0) / sr
    return { sampleRate: sr, durationSec, startBeat: start, endBeat: end, master, stems }
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
