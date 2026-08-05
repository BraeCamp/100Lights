/**
 * Fast (offline) timeline export via WebCodecs.
 *
 * Instead of playing the timeline in real time and recording the canvas
 * (capture.ts), this seeks every clip element to the exact source time for
 * each output frame, draws it with the same compositor, and pushes frames
 * straight into a hardware VideoEncoder muxed to MP4 (mp4-muxer). Runs as
 * fast as seek+encode allows — typically several times faster than real time
 * — and keeps rendering when the tab is backgrounded (no rAF, no wall clock).
 *
 * Audio is the same pre-mixed OfflineAudioContext buffer the capture path
 * uses, encoded to Opus (universally supported by AudioEncoder; MP4 carries
 * Opus fine in every player that matters for social uploads).
 *
 * Callers should try this and fall back to captureTimeline on any error —
 * WebCodecs support and codec availability vary.
 */

import { ArrayBufferTarget, Muxer } from 'mp4-muxer'
import { drawFrame, pickVisibleClips, transitionAt, type CompositorState, type MediaResolver } from './compositor'
import { sourceOffsetAt } from './speed'
import type { TimelineItem } from '@/lib/editor-types'

export interface FastExportOptions {
  state:              CompositorState
  totalDur:           number
  startOffset?:       number
  fps:                number
  videoBitsPerSecond: number
  audioBuffer:        AudioBuffer | null
  onProgress?:        (frac: number, msg: string) => void
  signal?:            AbortSignal
}

export function fastExportSupported(): boolean {
  return typeof VideoEncoder !== 'undefined' && typeof AudioEncoder !== 'undefined' && typeof VideoFrame !== 'undefined'
}

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
    const timer = setTimeout(done, 15000)
    v.addEventListener('loadeddata', done)
    v.addEventListener('error', done)
  })
}

/** Seek an element and resolve when the frame is actually decoded. */
function seekTo(v: HTMLVideoElement, t: number): Promise<void> {
  return new Promise(resolve => {
    if (Math.abs(v.currentTime - t) < 0.001) return resolve()
    const done = () => { clearTimeout(timer); v.removeEventListener('seeked', done); resolve() }
    const timer = setTimeout(done, 600)   // a stuck seek must not hang the export
    v.addEventListener('seeked', done, { once: true })
    try { v.currentTime = Math.max(0, t) } catch { done() }
  })
}

/** Source time a clip's element should show at timeline time `t` (loop-aware). */
function sourceTimeFor(clip: TimelineItem, t: number, el: HTMLVideoElement, rampCache: Map<string, Float64Array>): number {
  const local = Math.max(0, t - clip.startTime)
  let expected = Math.max(0, clip.inPoint + sourceOffsetAt(clip, local, rampCache, clip.id))
  const srcDur = el.duration
  if (isFinite(srcDur) && srcDur > 0 && expected > srcDur - 0.01) {
    const cycle = srcDur - clip.inPoint
    expected = cycle > 0.05 ? clip.inPoint + ((expected - clip.inPoint) % cycle) : srcDur - 0.01
  }
  return expected
}

const pickCodec = async (width: number, height: number, bitrate: number): Promise<VideoEncoderConfig> => {
  const candidates = ['avc1.640034', 'avc1.640028', 'avc1.64001f', 'avc1.42E01F']
  for (const codec of candidates) {
    const config: VideoEncoderConfig = { codec, width, height, bitrate, framerate: 30 }
    try {
      const support = await VideoEncoder.isConfigSupported(config)
      if (support.supported) return config
    } catch { /* try next */ }
  }
  throw new Error('No supported H.264 encoder configuration')
}

export async function exportTimelineFast(opts: FastExportOptions): Promise<Blob> {
  const { state, totalDur, fps, videoBitsPerSecond, audioBuffer, onProgress, signal } = opts
  const startOffset = opts.startOffset ?? 0
  const throwIfAborted = () => { if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError') }
  throwIfAborted()

  // ── Elements per video clip (shared blob per source) ───────────────────────
  const revokers: string[] = []
  const elByClip = new Map<string, HTMLVideoElement>()
  const videoClips = state.items.filter(i => (i.contentType === 'video' || i.contentType == null) && i.url)
  onProgress?.(0.02, 'Preparing media…')
  const localBySrc = new Map<string, string>()
  for (const clip of videoClips) {
    throwIfAborted()
    let local = localBySrc.get(clip.url!)
    if (!local) {
      local = await toLocalURL(clip.url!, revokers)
      localBySrc.set(clip.url!, local)
    }
    const v = document.createElement('video')
    v.src = local
    v.muted = true
    v.playsInline = true
    v.preload = 'auto'
    elByClip.set(clip.id, v)
  }
  await Promise.all([...elByClip.values()].map(waitReady))

  const canvas = document.createElement('canvas')
  canvas.width = state.width
  canvas.height = state.height
  const ctx = canvas.getContext('2d', { alpha: false })
  if (!ctx) throw new Error('Could not create canvas context')
  const media: MediaResolver = { get: (clip) => elByClip.get(clip.id) }
  const rampCache = new Map<string, Float64Array>()

  const cleanup = () => {
    for (const v of elByClip.values()) { try { v.src = '' } catch { /* noop */ } }
    revokers.forEach(URL.revokeObjectURL)
  }

  try {
    // ── Muxer + encoders ─────────────────────────────────────────────────────
    const target = new ArrayBufferTarget()
    const muxer = new Muxer({
      target,
      video: { codec: 'avc', width: state.width, height: state.height },
      audio: audioBuffer ? { codec: 'opus', numberOfChannels: 2, sampleRate: audioBuffer.sampleRate } : undefined,
      fastStart: 'in-memory',
    })

    let encoderError: Error | null = null
    const videoEncoder = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: (e) => { encoderError = e },
    })
    videoEncoder.configure(await pickCodec(state.width, state.height, videoBitsPerSecond))

    let audioEncoder: AudioEncoder | null = null
    if (audioBuffer) {
      audioEncoder = new AudioEncoder({
        output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
        error: (e) => { encoderError = e },
      })
      audioEncoder.configure({
        codec: 'opus',
        sampleRate: audioBuffer.sampleRate,
        numberOfChannels: 2,
        bitrate: 160_000,
      })
    }

    // ── Audio: feed the pre-mixed window as planar AudioData chunks ──────────
    if (audioBuffer && audioEncoder) {
      const sr = audioBuffer.sampleRate
      const startSample = Math.floor(startOffset * sr)
      const endSample = Math.min(audioBuffer.length, startSample + Math.ceil(totalDur * sr))
      const ch0 = audioBuffer.getChannelData(0)
      const ch1 = audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : ch0
      const CHUNK = 4096
      for (let s = startSample; s < endSample; s += CHUNK) {
        const n = Math.min(CHUNK, endSample - s)
        const data = new Float32Array(n * 2)
        data.set(ch0.subarray(s, s + n), 0)
        data.set(ch1.subarray(s, s + n), n)
        audioEncoder.encode(new AudioData({
          format: 'f32-planar',
          sampleRate: sr,
          numberOfFrames: n,
          numberOfChannels: 2,
          timestamp: Math.round(((s - startSample) / sr) * 1e6),
          data,
        }))
      }
    }

    // ── Video: seek every layer per output frame, draw, encode ───────────────
    const nFrames = Math.max(1, Math.round(totalDur * fps))
    const frameUs = 1e6 / fps
    for (let i = 0; i < nFrames; i++) {
      throwIfAborted()
      if (encoderError) throw encoderError
      const t = startOffset + i / fps

      // Every element the compositor will read this frame: the visible stack
      // plus each in-transition clip's frozen predecessor.
      const seeks: Promise<void>[] = []
      const stack = pickVisibleClips(state.items, state.tracks, t)
      for (const clip of stack) {
        if (!(clip.contentType === 'video' || clip.contentType == null) || !clip.url) continue
        const el = elByClip.get(clip.id)
        if (el) seeks.push(seekTo(el, sourceTimeFor(clip, t, el, rampCache)))
        const trans = transitionAt(state.items, state.tracks, clip, t)
        if (trans?.prev) {
          const prevEl = elByClip.get(trans.prev.id)
          if (prevEl) {
            const prevEnd = clip.startTime - 0.001
            seeks.push(seekTo(prevEl, sourceTimeFor(trans.prev, prevEnd, prevEl, rampCache)))
          }
        }
      }
      await Promise.all(seeks)

      drawFrame(ctx, state, media, t)
      const frame = new VideoFrame(canvas, { timestamp: Math.round(i * frameUs), duration: Math.round(frameUs) })
      videoEncoder.encode(frame, { keyFrame: i % (fps * 2) === 0 })
      frame.close()

      // Backpressure — don't let the encode queue balloon.
      while (videoEncoder.encodeQueueSize > 8) {
        await new Promise<void>(res => {
          const onDequeue = () => { videoEncoder.removeEventListener('dequeue', onDequeue); res() }
          videoEncoder.addEventListener('dequeue', onDequeue)
        })
      }

      if ((i & 7) === 0) onProgress?.(i / nFrames, `Rendering… ${Math.round((i / nFrames) * 100)}%`)
    }

    onProgress?.(0.99, 'Finalizing…')
    await videoEncoder.flush()
    videoEncoder.close()
    if (audioEncoder) { await audioEncoder.flush(); audioEncoder.close() }
    if (encoderError) throw encoderError
    muxer.finalize()
    return new Blob([target.buffer], { type: 'video/mp4' })
  } finally {
    cleanup()
  }
}
