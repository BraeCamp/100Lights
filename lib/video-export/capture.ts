/**
 * Real-time timeline capture.
 *
 * Plays the timeline once through a self-contained set of hidden <video>
 * elements, draws each frame with the compositor (so the export matches the
 * preview), and records the canvas + the pre-mixed audio into one MediaRecorder
 * stream — the same proven pattern song-video uses. Runs in real time (a 2-min
 * timeline takes ~2 min) but guarantees preview parity and needs no ffmpeg.
 *
 * Remote (R2) sources are fetched to same-origin object URLs first, so drawing
 * them to the capture canvas never taints it. Audio is supplied pre-rendered by
 * lib/video-export/audio-mix and played through a MediaStreamAudioDestination.
 */

import { drawFrame, pickViewerClip, type CompositorState, type MediaResolver } from './compositor'

export interface CaptureOptions {
  state:              CompositorState
  totalDur:           number        // length of the run (window duration), in seconds
  startOffset?:       number        // timeline time the run starts at (for In/Out range); default 0
  fps:                number
  videoBitsPerSecond: number
  audioBuffer:        AudioBuffer | null
  onProgress?:        (frac: number, msg: string) => void
  signal?:            AbortSignal
}

const READY_TIMEOUT_MS = 15000

/** Resolve a clip URL to a same-origin, canvas-safe URL (fetch remote → blob URL). */
async function toLocalURL(url: string, revokers: string[]): Promise<string> {
  if (url.startsWith('blob:') || url.startsWith('data:')) return url
  const blob = await (await fetch(url)).blob()
  const local = URL.createObjectURL(blob)
  revokers.push(local)
  return local
}

function waitReady(v: HTMLVideoElement): Promise<void> {
  return new Promise(resolve => {
    if (v.readyState >= 2 && v.videoWidth > 0) return resolve()
    const done = () => { cleanup(); resolve() }
    const cleanup = () => {
      v.removeEventListener('loadeddata', done)
      v.removeEventListener('error', done)
      clearTimeout(timer)
    }
    const timer = setTimeout(done, READY_TIMEOUT_MS)
    v.addEventListener('loadeddata', done)
    v.addEventListener('error', done)   // never block the whole export on one bad source
  })
}

function pickMime(): { mime: string; type: string } {
  const prefer = ['video/mp4;codecs=avc1,mp4a', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm']
  const mime = prefer.find(m => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) || 'video/webm'
  return { mime, type: mime.startsWith('video/mp4') ? 'video/mp4' : 'video/webm' }
}

export async function captureTimeline(opts: CaptureOptions): Promise<Blob> {
  const { state, totalDur, fps, videoBitsPerSecond, audioBuffer, onProgress, signal } = opts
  const startOffset = opts.startOffset ?? 0
  if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError')

  const revokers: string[] = []
  const elByUrl = new Map<string, HTMLVideoElement>()   // keyed by ORIGINAL clip url

  // ── 1. Build hidden <video> elements for each unique video source ──────────
  const videoUrls = Array.from(new Set(
    state.items
      .filter(i => (i.contentType === 'video' || i.contentType == null) && i.url)
      .map(i => i.url!),
  ))

  onProgress?.(0.02, 'Preparing media…')
  for (const url of videoUrls) {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError')
    const local = await toLocalURL(url, revokers)
    const v = document.createElement('video')
    v.src = local
    v.muted = true            // audio comes from the pre-mixed buffer, not the elements
    v.playsInline = true
    v.preload = 'auto'
    elByUrl.set(url, v)
  }
  await Promise.all([...elByUrl.values()].map(waitReady))

  // ── 2. Canvas + compositor ─────────────────────────────────────────────────
  const canvas = document.createElement('canvas')
  canvas.width = state.width
  canvas.height = state.height
  const ctx = canvas.getContext('2d', { alpha: false })
  if (!ctx) { revokers.forEach(URL.revokeObjectURL); throw new Error('Could not create canvas context') }
  const media: MediaResolver = { get: (url) => elByUrl.get(url) }

  // Paint the first frame so recording never opens on a black flash.
  drawFrame(ctx, state, media, startOffset)

  // ── 3. Audio graph (pre-rendered mix → capture stream) ─────────────────────
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  const audioCtx = new AC()
  let audioDest: MediaStreamAudioDestinationNode | null = null
  let bufSrc: AudioBufferSourceNode | null = null
  if (audioBuffer) {
    audioDest = audioCtx.createMediaStreamDestination()
    bufSrc = audioCtx.createBufferSource()
    bufSrc.buffer = audioBuffer
    bufSrc.connect(audioDest)
  }

  // ── 4. Combined stream + recorder ───────────────────────────────────────────
  const vStream = canvas.captureStream(fps)
  const tracks = [
    ...vStream.getVideoTracks(),
    ...(audioDest ? audioDest.stream.getAudioTracks() : []),
  ]
  const stream = new MediaStream(tracks)
  const { mime, type } = pickMime()
  const chunks: Blob[] = []
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond, audioBitsPerSecond: 160_000 })
  rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data) }
  const stopped = new Promise<void>(res => { rec.onstop = () => res() })

  // ── 5. Real-time playback + draw loop ───────────────────────────────────────
  let raf = 0
  let lastClipId: string | null = null
  let activeEl: HTMLVideoElement | null = null

  function syncPlayback(t: number) {
    const clip = pickViewerClip(state.items, state.tracks, t)
    const id = clip?.id ?? null
    if (id === lastClipId) return
    lastClipId = id
    if (activeEl) { activeEl.pause(); activeEl = null }
    if (clip && (clip.contentType === 'video' || clip.contentType == null) && clip.url) {
      const el = elByUrl.get(clip.url)
      if (el) {
        try { el.currentTime = Math.max(0, clip.inPoint + (t - clip.startTime)) } catch { /* seek race */ }
        el.playbackRate = clip.speed ?? 1
        el.play().catch(() => {})
        activeEl = el
      }
    }
  }

  await audioCtx.resume().catch(() => {})

  return await new Promise<Blob>((resolve, reject) => {
    const cleanup = () => {
      cancelAnimationFrame(raf)
      for (const v of elByUrl.values()) { try { v.pause() } catch { /* noop */ } }
      revokers.forEach(URL.revokeObjectURL)
      audioCtx.close?.().catch(() => {})
    }

    const onAbort = () => {
      cleanup()
      try { rec.stop() } catch { /* noop */ }
      reject(new DOMException('Cancelled', 'AbortError'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })

    const startWall = performance.now()
    if (bufSrc) bufSrc.start(0, startOffset, totalDur)
    rec.start()

    const loop = () => {
      if (signal?.aborted) return
      const elapsed = (performance.now() - startWall) / 1000
      const t = startOffset + elapsed
      if (elapsed >= totalDur) {
        signal?.removeEventListener('abort', onAbort)
        cleanup()
        rec.stop()
        stopped.then(() => resolve(new Blob(chunks, { type })))
        return
      }
      syncPlayback(t)
      drawFrame(ctx, state, media, t)
      if ((Math.floor(t * 4) & 3) === 0) onProgress?.(Math.min(0.99, t / totalDur), `Recording… ${Math.round((t / totalDur) * 100)}%`)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
  })
}
