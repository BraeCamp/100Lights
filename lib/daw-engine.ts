'use client'

import type { DawTrack, DawClip, DawProject, AudioClip, MidiClip, AutomationLane, LaunchQuantization } from './daw-types'
import { isAudioClip, isMidiClip } from './daw-types'
import { buildEffectsChain, type EffectHandle } from './daw-effects'
import { playInstrumentNote } from './daw-instruments'

// Per-track Web Audio routing nodes
interface TrackNodes {
  gain: GainNode
  panner: StereoPannerNode
  analyser: AnalyserNode
  effectsInput: GainNode    // sources connect here
  effectsOutput: GainNode   // routes into panner
}

interface ScheduledSource {
  source: AudioBufferSourceNode
  gainNode: GainNode
  clipId: string
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
  private effectsChains = new Map<string, ReturnType<typeof buildEffectsChain>>()
  bufferCache = new Map<string, AudioBuffer>()

  private scheduledSources: ScheduledSource[] = []
  private schedulerHandle: ReturnType<typeof setInterval> | null = null
  private metronomeHandle: ReturnType<typeof setInterval> | null = null

  // Session launch
  private _sessionQueue  = new Map<string, { clip: AudioClip; launchBeat: number }>()
  private _sessionSlots  = new Map<string, SessionSlot>()
  launchQuantization: LaunchQuantization = 'bar'

  // MIDI scheduling
  private _scheduledNoteKeys = new Set<NoteKey>()

  // Transport
  isPlaying = false
  isRecording = false
  tempo = 120
  loopEnabled = false
  loopStart = 0
  loopEnd = 16

  private _startCtxTime = 0
  private _startBeat    = 0

  private _clips: AudioClip[] = []
  private _midiClips: MidiClip[] = []
  private _tracks: DawTrack[] = []
  private _automationLanes: AutomationLane[] = []

  // Metronome
  private _tickBuf: AudioBuffer | null = null
  private _tockBuf: AudioBuffer | null = null
  private _nextMetronomeBeat = 0

  constructor() {
    super()
    this.ctx = new AudioContext()

    this.masterCompressor = this.ctx.createDynamicsCompressor()
    this.masterCompressor.threshold.value = -12
    this.masterCompressor.knee.value = 6
    this.masterCompressor.ratio.value = 3
    this.masterCompressor.attack.value = 0.003
    this.masterCompressor.release.value = 0.15
    this.masterCompressor.connect(this.ctx.destination)

    this.masterAnalyser = this.ctx.createAnalyser()
    this.masterAnalyser.fftSize = 256
    this.masterAnalyser.connect(this.masterCompressor)

    this.masterGain = this.ctx.createGain()
    this.masterGain.gain.value = 0.85
    this.masterGain.connect(this.masterAnalyser)

    this._buildMetronomeBuffers()
  }

  // ── Track routing ──────────────────────────────────────────────────────────

  ensureTrack(id: string, effects?: DawTrack['effects']) {
    if (this.ctx.state === 'closed') return
    if (!this.trackNodes.has(id)) {
      const effectsInput  = this.ctx.createGain()
      const effectsOutput = this.ctx.createGain()
      const gain          = this.ctx.createGain()
      const panner        = this.ctx.createStereoPanner()
      const analyser      = this.ctx.createAnalyser()
      analyser.fftSize = 256

      effectsOutput.connect(gain)
      gain.connect(panner)
      panner.connect(analyser)
      analyser.connect(this.masterGain)

      this.trackNodes.set(id, { gain, panner, analyser, effectsInput, effectsOutput })
    }

    // (Re)build effects chain when effects array is provided
    if (effects !== undefined) {
      this._rebuildEffectsChain(id, effects)
    }
  }

  private _rebuildEffectsChain(trackId: string, effects: DawTrack['effects']) {
    const nodes = this.trackNodes.get(trackId)
    if (!nodes) return

    // Tear down old chain
    const old = this.effectsChains.get(trackId)
    if (old) {
      try { nodes.effectsInput.disconnect() } catch { /* ok */ }
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
  }

  getEffectHandle(trackId: string, effectId: string): EffectHandle | undefined {
    return this.effectsChains.get(trackId)?.handles.get(effectId)
  }

  removeTrack(id: string) {
    const nodes = this.trackNodes.get(id)
    if (!nodes) return
    const chain = this.effectsChains.get(id)
    if (chain) { chain.dispose(); this.effectsChains.delete(id) }
    nodes.gain.disconnect()
    nodes.panner.disconnect()
    nodes.analyser.disconnect()
    nodes.effectsInput.disconnect()
    nodes.effectsOutput.disconnect()
    this.trackNodes.delete(id)
  }

  setTrackVolume(id: string, volume: number) {
    const nodes = this.trackNodes.get(id)
    if (nodes) nodes.gain.gain.setTargetAtTime(volume, this.ctx.currentTime, 0.01)
  }

  setTrackPan(id: string, pan: number) {
    const nodes = this.trackNodes.get(id)
    if (nodes) nodes.panner.pan.setTargetAtTime(pan, this.ctx.currentTime, 0.01)
  }

  setMasterVolume(v: number) {
    this.masterGain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02)
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
    const url = clip.audioUrl
    if (!url) return null
    try {
      const res = await fetch(url)
      const ab  = await res.arrayBuffer()
      const buf = await this.ctx.decodeAudioData(ab)
      this.bufferCache.set(clip.id, buf)
      return buf
    } catch {
      return null
    }
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
    this._scheduledNoteKeys.clear()
    this._startScheduler()
    this.dispatchEvent(new CustomEvent('transport', { detail: { playing: true, beat: this._startBeat } }))
  }

  stop() {
    this._startBeat = this.currentBeat  // preserve position (pause, not rewind)
    this.isPlaying = false
    this._stopScheduler()
    this._killAllSources()
    this._stopAllSessionSlots()
    this._scheduledNoteKeys.clear()
    this.dispatchEvent(new CustomEvent('transport', { detail: { playing: false, beat: this._startBeat } }))
  }

  seek(beat: number) {
    const wasPlaying = this.isPlaying
    if (wasPlaying) { this._killAllSources(); this._stopScheduler() }
    this._startBeat = beat
    if (wasPlaying) {
      this._startCtxTime = this.ctx.currentTime
      this._nextMetronomeBeat = Math.ceil(beat)
      this._scheduledNoteKeys.clear()
      this._startScheduler()
    }
    this.dispatchEvent(new CustomEvent('seek', { detail: { beat } }))
  }

  get isClosed(): boolean { return this.ctx.state === 'closed' }

  updateProject(project: DawProject) {
    if (this.ctx.state === 'closed') return
    this.tempo       = project.tempo
    this.loopEnabled = project.loopEnabled
    this.loopStart   = project.loopStart
    this.loopEnd     = project.loopEnd
    this._clips      = project.arrangementClips.filter(isAudioClip)
    this._midiClips  = project.arrangementClips.filter(isMidiClip)
    this._tracks     = project.tracks
    this._automationLanes = project.automationLanes ?? []
    this.setMasterVolume(project.masterVolume)

    for (const t of project.tracks) {
      this.ensureTrack(t.id, t.effects)
      const effective = t.mute ? 0 : t.volume
      this.setTrackVolume(t.id, effective)
      this.setTrackPan(t.id, t.pan)
    }
    for (const id of this.trackNodes.keys()) {
      if (!project.tracks.find(t => t.id === id)) this.removeTrack(id)
    }
  }

  // ── Session launch (quantized) ─────────────────────────────────────────────

  private _nextQuantBeat(): number {
    const now = this.currentBeat
    switch (this.launchQuantization) {
      case 'none':  return now
      case 'beat':  return Math.ceil(now)
      case '2bar':  return Math.ceil(now / 8) * 8
      case '4bar':  return Math.ceil(now / 16) * 16
      case 'bar':
      default:      return Math.ceil(now / 4) * 4
    }
  }

  async queueSession(trackId: string, clip: AudioClip) {
    if (this.ctx.state === 'suspended') await this.ctx.resume()

    // Toggle off if this clip is already playing
    const playing = this._sessionSlots.get(trackId)
    if (playing && playing.clip.id === clip.id) {
      this._stopSessionTrack(trackId)
      return
    }

    // Preload buffer
    await this.loadClipBuffer(clip)

    const launchBeat = this.isPlaying ? this._nextQuantBeat() : 0
    this._sessionQueue.set(trackId, { clip, launchBeat })

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

  private _launchSessionSlot(trackId: string, clip: AudioClip, launchBeat: number) {
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
    const offset     = this.currentBeat > launchBeat
      ? this.beatsToSeconds(this.currentBeat - launchBeat) + clip.trimStart
      : clip.trimStart
    const startAt = this.currentBeat > launchBeat
      ? contextNow
      : contextNow + this.beatsToSeconds(launchBeat - this.currentBeat)

    const duration = buf.duration - clip.trimStart - clip.trimEnd
    source.start(startAt, offset, clip.loopEnabled ? undefined : duration)

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
    this._sessionQueue.clear()
  }

  // Returns current state of a session slot
  getSessionState(trackId: string, clipId: string): 'idle' | 'queued' | 'playing' {
    const queued  = this._sessionQueue.get(trackId)
    const playing = this._sessionSlots.get(trackId)
    if (queued?.clip.id  === clipId) return 'queued'
    if (playing?.clip.id === clipId) return 'playing'
    return 'idle'
  }

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
      this._scheduledNoteKeys.clear()
      this._startBeat    = this.loopStart
      this._startCtxTime = this.ctx.currentTime
      this._nextMetronomeBeat = Math.ceil(this.loopStart)
    }

    const now          = this.currentBeat
    const contextNow   = this.ctx.currentTime
    const aheadBeats   = this.secondsToBeats(SCHEDULE_LOOKAHEAD)

    // ── Session queue: launch clips that have reached their launch beat ──
    for (const [trackId, queued] of this._sessionQueue.entries()) {
      if (now + aheadBeats >= queued.launchBeat) {
        this._launchSessionSlot(trackId, queued.clip, queued.launchBeat)
        this._sessionQueue.delete(trackId)
      }
    }

    // ── Arrangement audio clips ──────────────────────────────────────────
    for (const clip of this._clips) {
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
    for (const clip of this._midiClips) {
      const track = this._tracks.find(t => t.id === clip.trackId)
      if (!track || track.mute) continue
      const nodes = this.trackNodes.get(clip.trackId)
      if (!nodes) continue

      for (const note of clip.notes) {
        const noteKey   = `${clip.id}:${note.id}` as NoteKey
        if (this._scheduledNoteKeys.has(noteKey)) continue

        const noteAbsBeat = clip.startBeat + note.startBeat
        const noteEnd     = noteAbsBeat + note.durationBeats
        if (noteEnd < now) continue
        if (noteAbsBeat > now + aheadBeats) continue

        const startAt = contextNow + this.beatsToSeconds(Math.max(0, noteAbsBeat - now))
        const dur     = this.beatsToSeconds(note.durationBeats)

        this._scheduledNoteKeys.add(noteKey)
        playInstrumentNote(this.ctx, nodes.effectsInput, track.instrument, note.pitch, note.velocity, startAt, dur)

        // Expire key after note is done
        const expireMs = (startAt - contextNow + dur + 0.1) * 1000
        setTimeout(() => this._scheduledNoteKeys.delete(noteKey), Math.max(0, expireMs))
      }
    }

    // ── Automation ───────────────────────────────────────────────────────
    for (const lane of this._automationLanes) {
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
      nodes.gain.gain.setTargetAtTime(value, t, 0.01)
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

  private _scheduleArrangementClip(clip: AudioClip, buf: AudioBuffer, now: number, contextNow: number) {
    const nodes = this.trackNodes.get(clip.trackId)
    if (!nodes) return
    const track = this._tracks.find(t => t.id === clip.trackId)
    if (track?.mute) return

    const source   = this.ctx.createBufferSource()
    const fadeGain = this.ctx.createGain()
    source.buffer  = buf

    source.connect(fadeGain)
    fadeGain.connect(nodes.effectsInput)

    const beatOffset  = clip.startBeat - now
    const startAt     = contextNow + this.beatsToSeconds(Math.max(0, beatOffset))
    const seekOffset  = now > clip.startBeat
      ? this.beatsToSeconds(now - clip.startBeat) + clip.trimStart
      : clip.trimStart

    const totalDuration = buf.duration - clip.trimStart - clip.trimEnd
    const clipDuration  = this.beatsToSeconds(clip.durationBeats)
    const playDuration  = Math.min(totalDuration, clipDuration)

    if (clip.reverse) {
      source.playbackRate.value = -1
      source.start(startAt, buf.duration - clip.trimStart, playDuration)
    } else {
      source.start(startAt, seekOffset, playDuration)
    }

    if (clip.fadeIn > 0) {
      const fs = this.beatsToSeconds(clip.fadeIn)
      fadeGain.gain.setValueAtTime(0, startAt)
      fadeGain.gain.linearRampToValueAtTime(clip.gain, startAt + fs)
    } else {
      fadeGain.gain.value = clip.gain
    }
    if (clip.fadeOut > 0) {
      const fs = this.beatsToSeconds(clip.fadeOut)
      fadeGain.gain.setValueAtTime(clip.gain, startAt + playDuration - fs)
      fadeGain.gain.linearRampToValueAtTime(0, startAt + playDuration)
    }

    const entry: ScheduledSource = { source, gainNode: fadeGain, clipId: clip.id }
    this.scheduledSources.push(entry)
    source.onended = () => {
      const idx = this.scheduledSources.indexOf(entry)
      if (idx !== -1) this.scheduledSources.splice(idx, 1)
      source.disconnect()
      fadeGain.disconnect()
    }
  }

  private _killAllSources() {
    for (const { source, gainNode } of this.scheduledSources) {
      try { source.stop(); source.disconnect(); gainNode.disconnect() } catch { /* ok */ }
    }
    this.scheduledSources = []
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
      const isDownbeat = (this._nextMetronomeBeat % 4) === 0
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

  // ── Recording ─────────────────────────────────────────────────────────────

  private _mediaRecorder: MediaRecorder | null = null
  private _recChunks:   Blob[]                 = []
  private _captureNode: MediaStreamAudioDestinationNode | null = null
  private _recStartBeat = 0

  async startRecording(): Promise<void> {
    if (this._mediaRecorder) await this.stopRecording()
    // Tap the master bus — captures everything the engine plays
    this._captureNode  = this.ctx.createMediaStreamDestination()
    this.masterCompressor.connect(this._captureNode)
    this._recChunks    = []
    this._recStartBeat = this.currentBeat
    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm'
    this._mediaRecorder = new MediaRecorder(this._captureNode.stream, { mimeType: mime })
    this._mediaRecorder.ondataavailable = e => { if (e.data.size > 0) this._recChunks.push(e.data) }
    this._mediaRecorder.start(100)
    this.isRecording = true
    this.dispatchEvent(new CustomEvent('recording', { detail: { recording: true } }))
  }

  async stopRecording(): Promise<Blob | null> {
    if (!this._mediaRecorder) return null
    const endBeat = this.currentBeat  // capture before scheduler stops
    return new Promise(resolve => {
      this._mediaRecorder!.onstop = () => {
        const mime = this._mediaRecorder?.mimeType || 'audio/webm'
        const blob = new Blob(this._recChunks, { type: mime })
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
          detail: { blob, startBeat: this._recStartBeat, durationBeats: Math.max(0.25, endBeat - this._recStartBeat) },
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

  // ── Cleanup ────────────────────────────────────────────────────────────────

  dispose() {
    this.stop()
    this.setMetronome(false)
    this.ctx.close()
  }
}
