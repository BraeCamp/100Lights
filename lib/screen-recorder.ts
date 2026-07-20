/**
 * Screen + studio-audio recording.
 *
 * The important choice here is where the audio comes from. Screen capture can
 * carry a system-audio track, but browsers only offer it on some platforms,
 * it picks up notification sounds and every other tab, and on macOS it's
 * frequently unavailable entirely. Instead this taps the DAW's own master
 * output through a MediaStreamDestination, so a recording gets exactly what
 * the studio is playing — clean, at full quality, with nothing else in it.
 *
 * The screen share is still requested with `audio: true`, but only as a
 * fallback for when no engine node is supplied.
 */

export interface RecorderSources {
  /** The DAW's master output node — tapped for pristine studio audio. */
  masterNode?: AudioNode
  /** The AudioContext that node belongs to. */
  audioContext?: AudioContext
  /** Also capture the microphone (for talking over the demo). */
  includeMic?: boolean
}

export interface RecordingResult {
  blob: Blob
  mimeType: string
  durationMs: number
  sizeBytes: number
}

/** Best container the browser will actually give us, in preference order. */
function pickMimeType(): string {
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
    'video/mp4',
  ]
  for (const t of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) return t
  }
  return ''
}

export class ScreenRecorder {
  private recorder: MediaRecorder | null = null
  private chunks: Blob[] = []
  private displayStream: MediaStream | null = null
  private micStream: MediaStream | null = null
  private tap: MediaStreamAudioDestinationNode | null = null
  private startedAt = 0
  private mixCtx: AudioContext | null = null

  /** Fires if the user stops sharing from the browser's own share bar. */
  onExternalStop?: () => void

  get recording() { return this.recorder?.state === 'recording' }

  async start(sources: RecorderSources = {}): Promise<void> {
    if (this.recording) return

    // Ask for the screen first: if the user cancels this, nothing else should
    // have been opened (no mic prompt, no dangling audio nodes).
    this.displayStream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 30 },
      audio: true,
    })

    const audioTracks: MediaStreamTrack[] = []

    if (sources.masterNode && sources.audioContext) {
      // Tap the studio's master bus. `connect` here is additive — it does not
      // interrupt the existing path to the speakers.
      this.tap = sources.audioContext.createMediaStreamDestination()
      sources.masterNode.connect(this.tap)
      audioTracks.push(...this.tap.stream.getAudioTracks())
    } else {
      // No engine handed over — fall back to whatever the share gave us.
      audioTracks.push(...this.displayStream.getAudioTracks())
    }

    if (sources.includeMic) {
      try {
        this.micStream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
        })
        audioTracks.push(...this.micStream.getAudioTracks())
      } catch {
        // Denied or unavailable — record without narration rather than fail.
      }
    }

    // MediaRecorder takes only ONE audio track, so multiple sources have to be
    // mixed down first rather than simply appended to the stream.
    let finalAudio: MediaStreamTrack[] = audioTracks
    if (audioTracks.length > 1) {
      this.mixCtx = new AudioContext()
      const dest = this.mixCtx.createMediaStreamDestination()
      for (const t of audioTracks) {
        const src = this.mixCtx.createMediaStreamSource(new MediaStream([t]))
        const g = this.mixCtx.createGain()
        // Slight trim so two full-scale sources can't clip when summed.
        g.gain.value = 0.85
        src.connect(g); g.connect(dest)
      }
      finalAudio = dest.stream.getAudioTracks()
    }

    const mixed = new MediaStream([
      ...this.displayStream.getVideoTracks(),
      ...finalAudio,
    ])

    const mimeType = pickMimeType()
    this.recorder = new MediaRecorder(mixed, mimeType ? { mimeType, videoBitsPerSecond: 4_000_000 } : undefined)
    this.chunks = []
    this.recorder.ondataavailable = e => { if (e.data.size) this.chunks.push(e.data) }
    this.startedAt = Date.now()
    // 1s timeslice so a crash still leaves recoverable chunks.
    this.recorder.start(1000)

    // The browser's own "Stop sharing" button ends the track without telling
    // MediaRecorder, which would otherwise keep running and record a frozen
    // frame forever.
    this.displayStream.getVideoTracks()[0]?.addEventListener('ended', () => {
      this.onExternalStop?.()
    })
  }

  async stop(): Promise<RecordingResult | null> {
    const rec = this.recorder
    if (!rec || rec.state === 'inactive') { this.cleanup(); return null }

    const done = new Promise<void>(resolve => { rec.onstop = () => resolve() })
    rec.stop()
    await done

    const mimeType = rec.mimeType || 'video/webm'
    const blob = new Blob(this.chunks, { type: mimeType })
    const durationMs = Date.now() - this.startedAt
    this.cleanup()
    if (!blob.size) return null
    return { blob, mimeType, durationMs, sizeBytes: blob.size }
  }

  /** Release every device and node. Safe to call twice. */
  cleanup() {
    this.displayStream?.getTracks().forEach(t => t.stop())
    this.micStream?.getTracks().forEach(t => t.stop())
    // Disconnecting the tap matters: leaving it attached keeps a live
    // MediaStreamDestination hanging off the master bus for the whole session.
    try { this.tap?.disconnect() } catch { /* already gone */ }
    void this.mixCtx?.close().catch(() => {})
    this.displayStream = null
    this.micStream = null
    this.tap = null
    this.mixCtx = null
    this.recorder = null
    this.chunks = []
  }
}

export function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function formatSize(bytes: number): string {
  return bytes > 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

/** Is screen capture available at all? Safari and mobile often say no. */
export function screenRecordingSupported(): boolean {
  return typeof navigator !== 'undefined'
    && !!navigator.mediaDevices?.getDisplayMedia
    && typeof MediaRecorder !== 'undefined'
}
