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
  /** Show the mouse cursor / clicks in the recording (getDisplayMedia cursor). */
  captureCursor?: boolean
  /** Draw a "Made with 100Lights" tag over the video (free tier). */
  watermark?: boolean
}

/** Draw the "Made with 100Lights" tag bottom-right, scaled to the frame. */
export function drawWatermark(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const pad      = Math.max(6, Math.round(h * 0.012))
  const fontSize = Math.max(12, Math.round(h * 0.022))
  const label    = 'Made with 100Lights'
  ctx.save()
  ctx.font = `600 ${fontSize}px system-ui, -apple-system, "Segoe UI", sans-serif`
  const textW = ctx.measureText(label).width
  const dotR  = fontSize * 0.3
  const pillH = fontSize + pad * 1.3
  const pillW = textW + pad * 2 + dotR * 2 + pad * 0.7
  const x = w - pillW - pad * 1.5
  const y = h - pillH - pad * 1.5
  const r = pillH / 2
  // pill
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + pillW, y, x + pillW, y + pillH, r)
  ctx.arcTo(x + pillW, y + pillH, x, y + pillH, r)
  ctx.arcTo(x, y + pillH, x, y, r)
  ctx.arcTo(x, y, x + pillW, y, r)
  ctx.closePath()
  ctx.fillStyle = 'rgba(0,0,0,0.5)'
  ctx.fill()
  // accent dot
  ctx.beginPath()
  ctx.arc(x + pad + dotR, y + pillH / 2, dotR, 0, Math.PI * 2)
  ctx.fillStyle = '#a78bfa'
  ctx.fill()
  // label
  ctx.fillStyle = 'rgba(255,255,255,0.96)'
  ctx.textBaseline = 'middle'
  ctx.fillText(label, x + pad + dotR * 2 + pad * 0.6, y + pillH / 2 + 1)
  ctx.restore()
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
  // Watermark compositing pipeline (free tier)
  private wmVideo: HTMLVideoElement | null = null
  private wmStream: MediaStream | null = null
  private wmRAF = 0

  /** Fires if the user stops sharing from the browser's own share bar. */
  onExternalStop?: () => void

  get recording() { return this.recorder?.state === 'recording' }

  /** Wall-clock epoch (ms) the recording started — the absolute anchor for
   *  mapping session events to video frames. 0 before start(). */
  get startedAtMs() { return this.startedAt }

  /** Actual captured video dimensions + frame rate, read from the share's video
   *  track. Null before start(). Used by the session-capture layer to size ROIs. */
  get dimensions(): { width: number; height: number; fps: number } | null {
    const t = this.displayStream?.getVideoTracks()[0]
    if (!t) return null
    const s = t.getSettings()
    return { width: s.width ?? 0, height: s.height ?? 0, fps: Math.round(s.frameRate ?? 30) }
  }

  async start(sources: RecorderSources = {}): Promise<void> {
    if (this.recording) return

    // Ask for the screen first: if the user cancels this, nothing else should
    // have been opened (no mic prompt, no dangling audio nodes).
    // `cursor: 'always'` shows the pointer and clicks; 'motion' only while it
    // moves. Not in lib.dom's MediaTrackConstraints, so set it dynamically.
    const video: MediaTrackConstraints = { frameRate: 30 }
    ;(video as Record<string, unknown>).cursor = sources.captureCursor ? 'always' : 'motion'
    this.displayStream = await navigator.mediaDevices.getDisplayMedia({
      video,
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

    // Free tier: route the screen video through a canvas so a "Made with
    // 100Lights" tag is burned into every frame. Pro records the raw stream.
    const videoTracks = sources.watermark
      ? await this.startWatermarkComposite(this.displayStream)
      : this.displayStream.getVideoTracks()

    const mixed = new MediaStream([
      ...videoTracks,
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

  // Play the screen stream into a hidden <video>, redraw it into a canvas every
  // frame with the watermark on top, and hand back the canvas's captured track.
  private async startWatermarkComposite(display: MediaStream): Promise<MediaStreamTrack[]> {
    const track = display.getVideoTracks()[0]
    const settings = track?.getSettings() ?? {}
    const video = document.createElement('video')
    video.srcObject = new MediaStream(display.getVideoTracks())
    video.muted = true
    video.playsInline = true
    await video.play().catch(() => {})
    if (!video.videoWidth) {
      await new Promise<void>(r => { video.onloadedmetadata = () => r() })
    }
    const w = video.videoWidth || (settings.width as number) || 1280
    const h = video.videoHeight || (settings.height as number) || 720
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return display.getVideoTracks()   // no 2d context → fall back to raw
    const draw = () => {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      drawWatermark(ctx, canvas.width, canvas.height)
      this.wmRAF = requestAnimationFrame(draw)
    }
    this.wmRAF = requestAnimationFrame(draw)
    this.wmVideo = video
    this.wmStream = canvas.captureStream(30)
    return this.wmStream.getVideoTracks()
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
    if (this.wmRAF) cancelAnimationFrame(this.wmRAF)
    this.wmStream?.getTracks().forEach(t => t.stop())
    if (this.wmVideo) { try { this.wmVideo.pause(); this.wmVideo.srcObject = null } catch { /* gone */ } }
    this.displayStream = null
    this.micStream = null
    this.tap = null
    this.mixCtx = null
    this.wmRAF = 0
    this.wmStream = null
    this.wmVideo = null
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

/** Can we take a still screenshot? Just needs getDisplayMedia (no MediaRecorder). */
export function screenshotSupported(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia
}

/**
 * Grab a single frame of what's on screen as a PNG blob. Uses the same
 * screen-share picker as recording (so it captures canvas/WebGL exactly),
 * biased to the current tab where the browser supports it. Returns null if
 * unsupported or the picker was cancelled.
 */
export async function captureScreenshot(watermark = false): Promise<Blob | null> {
  if (!screenshotSupported()) return null
  let stream: MediaStream | null = null
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 30 },
      audio: false,
      // Chrome-only hint: default the picker to this tab, so a screenshot of
      // the studio is one confirm click. Ignored elsewhere.
      ...({ preferCurrentTab: true } as Record<string, unknown>),
    })
    const video = document.createElement('video')
    video.srcObject = stream
    video.muted = true
    await video.play()
    if (!video.videoWidth) await new Promise<void>(r => { video.onloadedmetadata = () => r() })
    await new Promise<void>(r => requestAnimationFrame(() => r()))
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    ctx?.drawImage(video, 0, 0)
    if (watermark && ctx) drawWatermark(ctx, canvas.width, canvas.height)
    return await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/png'))
  } catch {
    return null
  } finally {
    stream?.getTracks().forEach(t => t.stop())
  }
}
