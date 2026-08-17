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

import { drawFrame, pickVisibleClips, type CompositorState, type MediaResolver } from './compositor'
import { instantSpeed, sourceOffsetAt } from './speed'

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
  // One element PER CLIP (not per source) so two clips can show two different
  // frames of the same file simultaneously — overlapping tracks, transitions.
  // The downloaded blob is still shared per source URL.
  const elByClip = new Map<string, HTMLVideoElement | HTMLImageElement>()

  // ── 1. Build hidden <video> elements for each video clip ──────────────────
  const videoClips = state.items.filter(i => (i.contentType === 'video' || i.contentType == null) && i.url)
  const imageClips = state.items.filter(i => i.contentType === 'image' && i.url)

  onProgress?.(0.02, 'Preparing media…')
  const localBySrc = new Map<string, string>()
  for (const clip of videoClips) {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError')
    let local = localBySrc.get(clip.url!)
    if (!local) {
      local = await toLocalURL(clip.url!, revokers)
      localBySrc.set(clip.url!, local)
    }
    const v = document.createElement('video')
    v.src = local
    v.muted = true            // audio comes from the pre-mixed buffer, not the elements
    v.playsInline = true
    v.preload = 'auto'
    elByClip.set(clip.id, v)
  }
  await Promise.all([...elByClip.values()].map(el => waitReady(el as HTMLVideoElement)))
  // Still-image clips (lifted-subject cutouts) — decode once and draw as a frozen frame.
  for (const clip of imageClips) {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError')
    let local = localBySrc.get(clip.url!)
    if (!local) { local = await toLocalURL(clip.url!, revokers); localBySrc.set(clip.url!, local) }
    const im = new Image(); im.src = local
    try { await im.decode() } catch { /* broken image draws nothing */ }
    elByClip.set(clip.id, im)
  }

  // ── 2. Canvas + compositor ─────────────────────────────────────────────────
  const canvas = document.createElement('canvas')
  canvas.width = state.width
  canvas.height = state.height
  const ctx = canvas.getContext('2d', { alpha: false })
  if (!ctx) { revokers.forEach(URL.revokeObjectURL); throw new Error('Could not create canvas context') }
  const media: MediaResolver = { get: (clip) => elByClip.get(clip.id) }

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
  const playing = new Set<string>()                   // clip ids currently rolling
  const rampCache = new Map<string, Float64Array>()   // cumulative speed integrals per clip

  // Keep every VISIBLE layer's element rolling at its clip's position; pause
  // the rest without reseeking (their frozen last frame is what transition-in
  // effects blend from). Each element follows its clip's speed curve with
  // drift correction, and loops when the clip extends past the source end —
  // matching the preview's looping behaviour.
  function syncPlayback(t: number) {
    const stack = pickVisibleClips(state.items, state.tracks, t)
    const want = new Set<string>()
    for (const clip of stack) {
      if (!(clip.contentType === 'video' || clip.contentType == null) || !clip.url) continue
      const el = elByClip.get(clip.id) as HTMLVideoElement | undefined
      if (!el) continue
      want.add(clip.id)

      const local = Math.max(0, t - clip.startTime)
      const rate = clampRate(instantSpeed(clip, local))
      if (Math.abs(el.playbackRate - rate) > 0.01) el.playbackRate = rate

      let expected = Math.max(0, clip.inPoint + sourceOffsetAt(clip, local, rampCache, clip.id))
      const srcDur = el.duration
      if (isFinite(srcDur) && srcDur > 0 && expected > srcDur - 0.01) {
        const cycle = srcDur - clip.inPoint
        expected = cycle > 0.05 ? clip.inPoint + ((expected - clip.inPoint) % cycle) : srcDur - 0.01
      }

      if (!playing.has(clip.id)) {
        try { el.currentTime = expected } catch { /* seek race */ }
        playing.add(clip.id)
      } else if (Math.abs(el.currentTime - expected) > 0.3) {
        try { el.currentTime = expected } catch { /* seek race */ }
      }
      if (el.paused) el.play().catch(() => {})   // also restarts after a loop's 'ended'
    }
    for (const id of [...playing]) {
      if (!want.has(id)) {
        ;(elByClip.get(id) as HTMLVideoElement | undefined)?.pause()
        playing.delete(id)
      }
    }
  }

  function clampRate(r: number): number {
    return Math.max(0.0625, Math.min(16, r))
  }

  await audioCtx.resume().catch(() => {})

  return await new Promise<Blob>((resolve, reject) => {
    const cleanup = () => {
      cancelAnimationFrame(raf)
      for (const v of elByClip.values()) { try { if (v instanceof HTMLVideoElement) v.pause() } catch { /* noop */ } }
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
