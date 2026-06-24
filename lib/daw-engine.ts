'use client'

import type { DawTrack, DawClip, DawProject, AudioClip } from './daw-types'
import { isAudioClip } from './daw-types'

// Per-track Web Audio routing nodes
interface TrackNodes {
  gain: GainNode
  panner: StereoPannerNode
  analyser: AnalyserNode
}

// Scheduled source info for cleanup
interface ScheduledSource {
  source: AudioBufferSourceNode
  gainNode: GainNode  // per-source gain for fade in/out
  clipId: string
}

const SCHEDULE_LOOKAHEAD = 0.15  // seconds
const SCHEDULER_INTERVAL = 40    // ms

export class DawEngine extends EventTarget {
  ctx: AudioContext
  masterGain: GainNode
  masterAnalyser: AnalyserNode
  masterCompressor: DynamicsCompressorNode

  private trackNodes = new Map<string, TrackNodes>()
  bufferCache = new Map<string, AudioBuffer>()  // clipId → AudioBuffer
  private scheduledSources: ScheduledSource[] = []
  private schedulerHandle: ReturnType<typeof setInterval> | null = null
  private metronomeHandle: ReturnType<typeof setInterval> | null = null

  // Transport state
  isPlaying = false
  isRecording = false
  tempo = 120
  loopEnabled = false
  loopStart = 0   // beats
  loopEnd = 16    // beats

  // Clock: beat = startBeat + (ctx.currentTime - startCtxTime) * (tempo / 60)
  private _startCtxTime = 0
  private _startBeat = 0

  // Clips to schedule (set from project state on play/update)
  private _clips: AudioClip[] = []
  private _tracks: DawTrack[] = []

  // Metronome click buffers
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

  // ── Track routing ──────────────────────────────────────────────────────

  ensureTrack(id: string) {
    if (this.trackNodes.has(id)) return
    const gain    = this.ctx.createGain()
    const panner  = this.ctx.createStereoPanner()
    const analyser = this.ctx.createAnalyser()
    analyser.fftSize = 256
    gain.connect(panner)
    panner.connect(analyser)
    analyser.connect(this.masterGain)
    this.trackNodes.set(id, { gain, panner, analyser })
  }

  removeTrack(id: string) {
    const nodes = this.trackNodes.get(id)
    if (!nodes) return
    nodes.gain.disconnect()
    nodes.panner.disconnect()
    nodes.analyser.disconnect()
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

  // Returns Float32Array of level data (0-255) for the track analyser
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

  // ── Buffer loading ─────────────────────────────────────────────────────

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

  evictBuffer(clipId: string) {
    this.bufferCache.delete(clipId)
  }

  // Decode raw audio data (e.g., from recorded blob) and cache under clipId
  async loadBufferFromArrayBuffer(clipId: string, ab: ArrayBuffer): Promise<AudioBuffer> {
    const buf = await this.ctx.decodeAudioData(ab)
    this.bufferCache.set(clipId, buf)
    return buf
  }

  // ── Transport ──────────────────────────────────────────────────────────

  get currentBeat(): number {
    if (!this.isPlaying) return this._startBeat
    const elapsed = this.ctx.currentTime - this._startCtxTime
    return this._startBeat + elapsed * (this.tempo / 60)
  }

  set currentBeat(b: number) {
    this._startBeat = b
    if (this.isPlaying) {
      this._startCtxTime = this.ctx.currentTime
    }
  }

  beatsToSeconds(beats: number): number { return beats * (60 / this.tempo) }
  secondsToBeats(seconds: number): number { return seconds * (this.tempo / 60) }

  async play(fromBeat?: number) {
    if (this.ctx.state === 'suspended') await this.ctx.resume()
    if (fromBeat !== undefined) this._startBeat = fromBeat
    this._startCtxTime = this.ctx.currentTime
    this.isPlaying = true
    this._nextMetronomeBeat = Math.ceil(this._startBeat)
    this._startScheduler()
    this.dispatchEvent(new CustomEvent('transport', { detail: { playing: true, beat: this._startBeat } }))
  }

  stop() {
    this.isPlaying = false
    this._stopScheduler()
    this._killAllSources()
    this.dispatchEvent(new CustomEvent('transport', { detail: { playing: false, beat: this._startBeat } }))
  }

  seek(beat: number) {
    const wasPlaying = this.isPlaying
    if (wasPlaying) {
      this._killAllSources()
      this._stopScheduler()
    }
    this._startBeat = beat
    if (wasPlaying) {
      this._startCtxTime = this.ctx.currentTime
      this._nextMetronomeBeat = Math.ceil(beat)
      this._startScheduler()
    }
    this.dispatchEvent(new CustomEvent('seek', { detail: { beat } }))
  }

  // Called from UI when project clips/tracks change
  updateProject(project: DawProject) {
    this.tempo       = project.tempo
    this.loopEnabled = project.loopEnabled
    this.loopStart   = project.loopStart
    this.loopEnd     = project.loopEnd
    this._tracks     = project.tracks
    this._clips      = project.arrangementClips.filter(isAudioClip)
    this.setMasterVolume(project.masterVolume)

    // Sync track nodes
    for (const t of project.tracks) {
      this.ensureTrack(t.id)
      const effective = t.mute ? 0 : t.volume
      this.setTrackVolume(t.id, effective)
      this.setTrackPan(t.id, t.pan)
    }
    // Remove deleted tracks
    for (const id of this.trackNodes.keys()) {
      if (!project.tracks.find(t => t.id === id)) this.removeTrack(id)
    }
  }

  // ── Scheduling ─────────────────────────────────────────────────────────

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

    // Loop handling
    if (this.loopEnabled && this.currentBeat >= this.loopEnd) {
      this._killAllSources()
      this._startBeat = this.loopStart
      this._startCtxTime = this.ctx.currentTime
      this._nextMetronomeBeat = Math.ceil(this.loopStart)
    }

    const now   = this.currentBeat
    const ahead = this.secondsToBeats(SCHEDULE_LOOKAHEAD)

    for (const clip of this._clips) {
      const alreadyScheduled = this.scheduledSources.some(s => s.clipId === clip.id)
      if (alreadyScheduled) continue

      const clipEnd = clip.startBeat + clip.durationBeats
      if (clipEnd < now) continue
      if (clip.startBeat > now + ahead) continue

      const buf = this.bufferCache.get(clip.id)
      if (!buf) continue

      this._scheduleClip(clip, buf, now)
    }

    // Dispatch position tick for UI
    this.dispatchEvent(new CustomEvent('tick', { detail: { beat: this.currentBeat } }))
  }

  private _scheduleClip(clip: AudioClip, buf: AudioBuffer, now: number) {
    const nodes = this.trackNodes.get(clip.trackId)
    if (!nodes) return

    const track = this._tracks.find(t => t.id === clip.trackId)
    if (track?.mute) return

    const source   = this.ctx.createBufferSource()
    const fadeGain = this.ctx.createGain()
    source.buffer  = buf
    source.playbackRate.value = 1

    source.connect(fadeGain)
    fadeGain.connect(nodes.gain)

    // Timing
    const contextNow = this.ctx.currentTime
    const beatOffset = clip.startBeat - now
    const startAt    = contextNow + this.beatsToSeconds(Math.max(0, beatOffset))
    const seekOffset = (now > clip.startBeat)
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

    // Fade in
    if (clip.fadeIn > 0) {
      const fadeSec = this.beatsToSeconds(clip.fadeIn)
      fadeGain.gain.setValueAtTime(0, startAt)
      fadeGain.gain.linearRampToValueAtTime(clip.gain, startAt + fadeSec)
    } else {
      fadeGain.gain.value = clip.gain
    }

    // Fade out
    if (clip.fadeOut > 0) {
      const fadeSec  = this.beatsToSeconds(clip.fadeOut)
      const fadeStart = startAt + playDuration - fadeSec
      fadeGain.gain.setValueAtTime(clip.gain, fadeStart)
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
      try { source.stop(); source.disconnect(); gainNode.disconnect() } catch { /* already stopped */ }
    }
    this.scheduledSources = []
  }

  // ── One-shot clip playback (session view / preview) ───────────────────

  async playClipOnce(clip: AudioClip, trackId: string) {
    if (this.ctx.state === 'suspended') await this.ctx.resume()
    const buf = await this.loadClipBuffer(clip)
    if (!buf) return

    this.ensureTrack(trackId)
    const nodes = this.trackNodes.get(trackId)!
    const source = this.ctx.createBufferSource()
    source.buffer = buf

    const gainNode = this.ctx.createGain()
    gainNode.gain.value = clip.gain
    source.connect(gainNode)
    gainNode.connect(nodes.gain)
    source.start(0, clip.trimStart, buf.duration - clip.trimStart - clip.trimEnd)
    source.onended = () => { source.disconnect(); gainNode.disconnect() }
    return source
  }

  // ── Metronome ─────────────────────────────────────────────────────────

  private _buildMetronomeBuffers() {
    const sr = this.ctx.sampleRate
    const len = Math.floor(sr * 0.04)

    const tick = this.ctx.createBuffer(1, len, sr)
    const tock = this.ctx.createBuffer(1, len, sr)
    const td = tick.getChannelData(0)
    const wd = tock.getChannelData(0)

    for (let i = 0; i < len; i++) {
      const env = Math.exp(-i / (sr * 0.015))
      td[i] = Math.sin(2 * Math.PI * 1800 * i / sr) * env  // high click
      wd[i] = Math.sin(2 * Math.PI * 900 * i / sr) * env * 0.5 // low tock
    }

    this._tickBuf = tick
    this._tockBuf = tock
  }

  setMetronome(on: boolean) {
    if (!on) {
      if (this.metronomeHandle !== null) {
        clearInterval(this.metronomeHandle)
        this.metronomeHandle = null
      }
      return
    }
    if (this.metronomeHandle !== null) return
    this.metronomeHandle = setInterval(() => this._scheduleMetronome(), SCHEDULER_INTERVAL)
  }

  private _scheduleMetronome() {
    if (!this.isPlaying) return
    const now = this.ctx.currentTime
    const currentBeat = this.currentBeat
    const ahead = this.secondsToBeats(SCHEDULE_LOOKAHEAD)

    while (this._nextMetronomeBeat <= currentBeat + ahead) {
      const beatOffset = this._nextMetronomeBeat - currentBeat
      const when = now + this.beatsToSeconds(Math.max(0, beatOffset))
      const isDownbeat = (this._nextMetronomeBeat % 4) === 0
      const buf = isDownbeat ? this._tickBuf : this._tockBuf
      if (buf) {
        const src = this.ctx.createBufferSource()
        src.buffer = buf
        const g = this.ctx.createGain()
        g.gain.value = 0.6
        src.connect(g)
        g.connect(this.masterGain)
        src.start(when)
        src.onended = () => { src.disconnect(); g.disconnect() }
      }
      this._nextMetronomeBeat++
    }
  }

  // ── Recording ─────────────────────────────────────────────────────────

  private _mediaRecorder: MediaRecorder | null = null
  private _recChunks: Blob[] = []

  async startRecording(): Promise<void> {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    this._recChunks = []
    this._mediaRecorder = new MediaRecorder(stream)
    this._mediaRecorder.ondataavailable = e => { if (e.data.size > 0) this._recChunks.push(e.data) }
    this._mediaRecorder.start(100)
    this.isRecording = true
    this.dispatchEvent(new CustomEvent('recording', { detail: { recording: true } }))
  }

  async stopRecording(): Promise<Blob | null> {
    if (!this._mediaRecorder) return null
    return new Promise(resolve => {
      this._mediaRecorder!.onstop = () => {
        const blob = new Blob(this._recChunks, { type: 'audio/webm' })
        this._recChunks = []
        this._mediaRecorder?.stream.getTracks().forEach(t => t.stop())
        this._mediaRecorder = null
        this.isRecording = false
        this.dispatchEvent(new CustomEvent('recording', { detail: { recording: false } }))
        resolve(blob)
      }
      this._mediaRecorder!.stop()
    })
  }

  // ── Tap tempo ─────────────────────────────────────────────────────────

  private _tapTimes: number[] = []

  tap(): number | null {
    const now = Date.now()
    this._tapTimes = this._tapTimes.filter(t => now - t < 4000)
    this._tapTimes.push(now)
    if (this._tapTimes.length < 2) return null
    const gaps: number[] = []
    for (let i = 1; i < this._tapTimes.length; i++) {
      gaps.push(this._tapTimes[i] - this._tapTimes[i - 1])
    }
    const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length
    const bpm = Math.round(60000 / avg)
    return Math.max(40, Math.min(300, bpm))
  }

  // ── Cleanup ────────────────────────────────────────────────────────────

  dispose() {
    this.stop()
    this.setMetronome(false)
    this.ctx.close()
  }
}
