'use client'

import { useEffect, useLayoutEffect, useRef, useMemo, useState, useCallback } from 'react'
import { Play, Pause, SkipBack, Mic, Film, ZoomIn, ZoomOut } from 'lucide-react'
import type { Caption, ContentType } from '@/lib/types'
import type { VideoAdjustments } from '@/lib/editor-types'

const PREPLAY_LEAD = 0.5
const WAVEFORM = [30, 55, 80, 45, 70, 90, 60, 40, 75, 85, 50, 65, 95, 70, 45, 80, 60, 35, 70, 90, 55, 80, 65, 40, 75, 95, 50, 65, 80, 55, 70, 40]

export interface ClipTransform {
  opacity: number       // 0–100
  flipH: boolean
  flipV: boolean
  cropZoom: number      // 100–400
  cropX: number         // -50 to 50
  cropY: number         // -50 to 50
  fadeOpacity: number   // 0–1, computed from fade in/out
}

export const DEFAULT_CLIP_TRANSFORM: ClipTransform = {
  opacity: 100, flipH: false, flipV: false,
  cropZoom: 100, cropX: 0, cropY: 0, fadeOpacity: 1,
}

export type AspectGuide = 'none' | '9:16' | '1:1' | '4:5' | '2.35:1'

interface ClipHint {
  inPoint: number
  startTime: number
}

interface Props {
  src: string | null
  contentType: ContentType | null
  captions: Caption[]
  currentTime: number
  timeOffset: number
  isPlaying: boolean
  adjustments?: VideoAdjustments
  onTimeUpdate: (timelineTime: number) => void
  onPlay: () => void
  onPause: () => void
  videoRef: React.RefObject<HTMLVideoElement | null>
  clipLabel?: string
  onMediaError?: () => void
  preloadSrcs?: string[]
  seekHints?: Record<string, ClipHint>
  showOriginal?: boolean
  // New props
  clipTransform?: ClipTransform
  viewerZoom?: number
  showSafeAreas?: boolean
  aspectGuide?: AspectGuide
  showVUMeter?: boolean
  onSeekRequest?: (t: number) => void   // called when user types a timecode
  frameBlendEnabled?: boolean
  clipSpeed?: number                    // 0–1 for slow-mo; blending only activates < 1
  motionBlurEnabled?: boolean
  currentClipSpeed?: number             // real-time speed (may differ from clipSpeed via ramp)
  opticalFlowEnabled?: boolean
  blendMode?: string         // CSS mix-blend-mode
  loopDuration?: number      // when set, clip loops; each cycle plays clipInPoint→(clipInPoint+loopDuration)
  clipInPoint?: number       // inPoint of the active clip (used for loop reset position)
  titleClip?: {              // populated when contentType === 'title'
    text: string
    fontSize: number
    color: string
    bg: string
    position: 'upper' | 'center' | 'lower-third'
    animation: 'none' | 'fade' | 'slide-up'
    localProgress: number    // 0–1 through clip duration (for animations)
  }
  lutCanvas?: OffscreenCanvas | null  // pre-rendered LUT canvas frame (set externally)
  playbackRate?: number
  onPlaybackRateChange?: (rate: number) => void
  activeFocusClip?: { x: number; y: number }
  onSetFocusPoint?: (x: number, y: number) => void
  onFocusRecordStart?: () => void
  onFocusRecordEnd?: () => void
  isRecordingFocus?: boolean
  onViewerZoomChange?: (z: number) => void
}

function buildFilter(adj?: VideoAdjustments): string {
  if (!adj) return 'none'
  const parts: string[] = []
  if (adj.brightness !== 100)           parts.push(`brightness(${adj.brightness / 100})`)
  if (adj.contrast !== 100)             parts.push(`contrast(${adj.contrast / 100})`)
  if (adj.saturation !== 100)           parts.push(`saturate(${adj.saturation / 100})`)
  // Tone curve: shadows (black point lift/crush)
  const shadows = adj.shadows ?? 0
  if (shadows !== 0)                    parts.push(`brightness(${1 + shadows / 400})`)
  // Tone curve: midtones (gamma via contrast)
  const midtones = adj.midtones ?? 0
  if (midtones !== 0)                   parts.push(`contrast(${1 + midtones / 200})`)
  // Tone curve: highlights
  if (adj.highlights !== 0)             parts.push(`brightness(${1 + adj.highlights / 300})`)
  // Color wheels (master channel approximation)
  const lift = adj.lift ?? 0
  const gamma = adj.gamma ?? 100
  const gain = adj.gain ?? 100
  if (lift !== 0)                       parts.push(`brightness(${1 + lift / 400})`)
  if (gamma !== 100)                    parts.push(`brightness(${0.5 + gamma / 200})`)
  if (gain !== 100)                     parts.push(`brightness(${gain / 100})`)
  return parts.length ? parts.join(' ') : 'none'
}

function buildClipStyle(t: ClipTransform): React.CSSProperties {
  const parts: string[] = []
  if (t.cropZoom !== 100) parts.push(`scale(${t.cropZoom / 100})`)
  if (t.cropX !== 0 || t.cropY !== 0) parts.push(`translate(${t.cropX}%, ${t.cropY}%)`)
  if (t.flipH) parts.push('scaleX(-1)')
  if (t.flipV) parts.push('scaleY(-1)')
  return {
    transform: parts.length ? parts.join(' ') : 'none',
    transformOrigin: 'center',
    opacity: (t.opacity / 100) * t.fadeOpacity,
  }
}

// Aspect ratio guide overlay dimensions (width%, height% of the container to SHOW)
function aspectGuideStyle(guide: AspectGuide, containerW: number, containerH: number): React.CSSProperties {
  if (guide === 'none') return { display: 'none' }
  const containerAR = containerW / containerH
  let targetAR: number
  switch (guide) {
    case '9:16':   targetAR = 9 / 16; break
    case '1:1':    targetAR = 1; break
    case '4:5':    targetAR = 4 / 5; break
    case '2.35:1': targetAR = 2.35; break
    default:       targetAR = containerAR
  }
  if (targetAR < containerAR) {
    // Letterbox: bars on left/right
    const w = (targetAR / containerAR) * 100
    return { left: `${(100 - w) / 2}%`, right: `${(100 - w) / 2}%`, top: 0, bottom: 0 }
  } else {
    // Pillarbox: bars on top/bottom
    const h = (containerAR / targetAR) * 100
    return { top: `${(100 - h) / 2}%`, bottom: `${(100 - h) / 2}%`, left: 0, right: 0 }
  }
}

function parseTimecode(s: string, fps = 24): number {
  const clean = s.trim()
  const parts = clean.split(':').map(Number)
  if (parts.some(isNaN)) return NaN
  if (parts.length === 4) return parts[0] * 3600 + parts[1] * 60 + parts[2] + parts[3] / fps
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  return Number(clean)
}

function formatTimecode(s: number, fps = 24): string {
  const t = Math.max(0, s)
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const sec = Math.floor(t % 60)
  const f = Math.floor((t % 1) * fps)
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${p(h)}:${p(m)}:${p(sec)}:${p(f)}`
}

export default function VideoPlayer({
  src, contentType, captions, currentTime, timeOffset, isPlaying,
  adjustments, onTimeUpdate, onPlay, onPause, onMediaError, videoRef, clipLabel,
  preloadSrcs = [], seekHints = {}, showOriginal = false,
  clipTransform = DEFAULT_CLIP_TRANSFORM,
  viewerZoom = 1,
  showSafeAreas = false,
  aspectGuide = 'none',
  showVUMeter = false,
  onSeekRequest,
  frameBlendEnabled = false,
  clipSpeed = 1,
  motionBlurEnabled = false,
  currentClipSpeed = 1,
  opticalFlowEnabled = false,
  blendMode,
  loopDuration,
  clipInPoint = 0,
  titleClip,
  playbackRate = 1,
  onPlaybackRateChange,
  activeFocusClip,
  onSetFocusPoint,
  onFocusRecordStart,
  onFocusRecordEnd,
  isRecordingFocus = false,
  onViewerZoomChange,
}: Props) {
  // Tracks cumulative full-loop offsets so onTimeUpdate reports monotonically
  // increasing timeline time even as video.currentTime wraps back to 0.
  const loopBaseRef = useRef(0)
  const poolRef = useRef<Map<string, HTMLVideoElement>>(new Map())
  const [visibleSrc, setVisibleSrc] = useState<string | null>(null)
  // Focus recording: local pointer-down state + live display position
  const focusPointerDownRef = useRef(false)
  const [focusLivePos, setFocusLivePos] = useState<{ x: number; y: number } | null>(null)

  // Timecode editing
  const [editingTC, setEditingTC] = useState(false)
  const [tcInput, setTcInput] = useState('')

  // VU meter
  const audioCtxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const audioSourcesRef = useRef<Map<string, MediaElementAudioSourceNode>>(new Map())
  const [vuLevels, setVuLevels] = useState<[number, number]>([0, 0])  // L and R (mono = same)
  const vuRafRef = useRef<number | null>(null)

  // Frame blending
  const blendCanvasRef  = useRef<HTMLCanvasElement>(null)
  const blendPrevBufRef = useRef<Uint8ClampedArray | null>(null)
  const blendTmpBufRef  = useRef<Uint8ClampedArray | null>(null)
  const blendRvfcRef    = useRef<number | null>(null)
  const blendRafRef     = useRef<number | null>(null)

  const blendActive = frameBlendEnabled && clipSpeed < 1 && !!src && contentType === 'video'

  useEffect(() => {
    const canvas = blendCanvasRef.current
    if (!blendActive || !canvas || !src) {
      // Cancel any in-flight callbacks and reset buffers
      const v = src ? poolRef.current.get(src) : null
      if (blendRvfcRef.current !== null && v) {
        (v as any).cancelVideoFrameCallback?.(blendRvfcRef.current)
        blendRvfcRef.current = null
      }
      if (blendRafRef.current !== null) {
        cancelAnimationFrame(blendRafRef.current)
        blendRafRef.current = null
      }
      blendPrevBufRef.current = null
      blendTmpBufRef.current  = null
      // Clear the canvas so it doesn't linger when toggled off
      if (canvas) {
        const ctx = canvas.getContext('2d')
        if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height)
      }
      return
    }

    const video = poolRef.current.get(src)
    if (!video) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Blend weight: current frame contribution.
    // At speed 0.5 → 50/50 blend; at 0.25 → 25/75 etc.
    // Clamp to a minimum of 0.15 so even 0.25× still shows some new content.
    const alpha = Math.max(0.15, clipSpeed)
    const wa = Math.round(alpha * 256)
    const wb = 256 - wa

    function processFrame() {
      if (!video || !canvas || !ctx) return
      const vw = video.videoWidth, vh = video.videoHeight
      if (vw === 0 || vh === 0) { scheduleNext(); return }

      // Sync canvas intrinsic size to video resolution
      if (canvas.width !== vw || canvas.height !== vh) {
        canvas.width  = vw
        canvas.height = vh
        blendPrevBufRef.current = null
        blendTmpBufRef.current  = null
      }

      // Grab current frame pixels
      ctx.drawImage(video, 0, 0, vw, vh)
      const imgData = ctx.getImageData(0, 0, vw, vh)
      const curr = imgData.data
      const n = curr.length

      // Lazy-allocate reusable scratch buffers (zero GC after first frame)
      if (!blendPrevBufRef.current || blendPrevBufRef.current.length !== n) {
        blendPrevBufRef.current = new Uint8ClampedArray(curr)  // copy current as first prev
        blendTmpBufRef.current  = new Uint8ClampedArray(n)
        ctx.putImageData(imgData, 0, 0)
        scheduleNext(); return
      }

      const prev = blendPrevBufRef.current
      const tmp  = blendTmpBufRef.current!

      // Save unblended current into tmp BEFORE mutating curr
      tmp.set(curr)

      // Blend in-place: curr = curr*wa/256 + prev*wb/256 (integer math, no floats)
      for (let i = 0; i < n; i += 4) {
        curr[i]   = (curr[i]   * wa + prev[i]   * wb) >> 8
        curr[i+1] = (curr[i+1] * wa + prev[i+1] * wb) >> 8
        curr[i+2] = (curr[i+2] * wa + prev[i+2] * wb) >> 8
        curr[i+3] = 255
      }
      ctx.putImageData(imgData, 0, 0)

      // Swap tmp (original curr) into prev slot for next frame
      blendPrevBufRef.current = tmp
      blendTmpBufRef.current  = prev

      scheduleNext()
    }

    function scheduleNext() {
      if ((video as any).requestVideoFrameCallback) {
        blendRvfcRef.current = (video as any).requestVideoFrameCallback(processFrame)
      } else {
        // RAF fallback for Firefox/Safari (fires at display rate, not video frame rate)
        blendRafRef.current = requestAnimationFrame(processFrame)
      }
    }

    scheduleNext()

    return () => {
      if (blendRvfcRef.current !== null) {
        (video as any).cancelVideoFrameCallback?.(blendRvfcRef.current)
        blendRvfcRef.current = null
      }
      if (blendRafRef.current !== null) {
        cancelAnimationFrame(blendRafRef.current)
        blendRafRef.current = null
      }
    }
  }, [blendActive, src]) // eslint-disable-line

  // Optical flow — multi-frame ring-buffer temporal blend
  // Keeps 4 consecutive frames; blends with Gaussian weights for smoother slow-mo
  const optFlowCanvasRef  = useRef<HTMLCanvasElement>(null)
  const optFlowRingRef    = useRef<Uint8ClampedArray[]>([])
  const optFlowRvfcRef    = useRef<number | null>(null)
  const optFlowRafRef     = useRef<number | null>(null)

  const optFlowActive = opticalFlowEnabled && clipSpeed < 1 && !!src && contentType === 'video' && !blendActive

  useEffect(() => {
    const canvas = optFlowCanvasRef.current
    if (!optFlowActive || !canvas || !src) {
      const v = src ? poolRef.current.get(src) : null
      if (optFlowRvfcRef.current !== null && v) {
        (v as any).cancelVideoFrameCallback?.(optFlowRvfcRef.current)
        optFlowRvfcRef.current = null
      }
      if (optFlowRafRef.current !== null) {
        cancelAnimationFrame(optFlowRafRef.current)
        optFlowRafRef.current = null
      }
      optFlowRingRef.current = []
      if (canvas) { const c = canvas.getContext('2d'); if (c) c.clearRect(0, 0, canvas.width, canvas.height) }
      return
    }

    const video = poolRef.current.get(src)
    if (!video) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Gaussian-ish weights across the ring buffer [newest … oldest]
    const RING_SIZE = 4
    const WEIGHTS = [0.55, 0.25, 0.13, 0.07] // must sum to 1

    function processFrame() {
      if (!video || !canvas || !ctx) return
      const vw = video.videoWidth, vh = video.videoHeight
      if (vw === 0 || vh === 0) { schedule(); return }

      if (canvas.width !== vw || canvas.height !== vh) {
        canvas.width = vw; canvas.height = vh
        optFlowRingRef.current = []
      }

      // Capture current frame
      ctx.drawImage(video, 0, 0, vw, vh)
      const frame = ctx.getImageData(0, 0, vw, vh)
      const n = frame.data.length

      // Push to ring buffer (newest first)
      const ring = optFlowRingRef.current
      if (!ring.length || ring[0].length !== n) {
        optFlowRingRef.current = [new Uint8ClampedArray(frame.data)]
        ctx.putImageData(frame, 0, 0)
        schedule(); return
      }

      ring.unshift(new Uint8ClampedArray(frame.data))
      if (ring.length > RING_SIZE) ring.pop()

      // Blend ring frames with weights into output
      const out = new Uint8ClampedArray(n)
      for (let i = 0; i < n; i += 4) {
        let r = 0, g = 0, b = 0
        for (let k = 0; k < ring.length; k++) {
          const w = WEIGHTS[k] ?? 0
          r += ring[k][i]   * w
          g += ring[k][i+1] * w
          b += ring[k][i+2] * w
        }
        out[i] = r; out[i+1] = g; out[i+2] = b; out[i+3] = 255
      }
      ctx.putImageData(new ImageData(out, vw, vh), 0, 0)
      schedule()
    }

    function schedule() {
      if ((video as any).requestVideoFrameCallback) {
        optFlowRvfcRef.current = (video as any).requestVideoFrameCallback(processFrame)
      } else {
        optFlowRafRef.current = requestAnimationFrame(processFrame)
      }
    }
    schedule()

    return () => {
      if (optFlowRvfcRef.current !== null) {
        (video as any).cancelVideoFrameCallback?.(optFlowRvfcRef.current)
        optFlowRvfcRef.current = null
      }
      if (optFlowRafRef.current !== null) {
        cancelAnimationFrame(optFlowRafRef.current)
        optFlowRafRef.current = null
      }
    }
  }, [optFlowActive, src]) // eslint-disable-line

  // Monitor container ref for aspect guide sizing
  const monitorRef = useRef<HTMLDivElement>(null)
  const [monitorSize, setMonitorSize] = useState({ w: 640, h: 360 })
  useEffect(() => {
    const el = monitorRef.current
    if (!el) return
    const obs = new ResizeObserver(entries => {
      const r = entries[0].contentRect
      setMonitorSize({ w: r.width, h: r.height })
    })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  const allSrcs = useMemo(() => {
    const s = new Set(preloadSrcs)
    if (src) s.add(src)
    return Array.from(s)
  }, [src, preloadSrcs])

  useLayoutEffect(() => {
    const el = src ? (poolRef.current.get(src) ?? null) : null
    ;(videoRef as React.MutableRefObject<HTMLVideoElement | null>).current = el
  })

  const timeOffsetRef  = useRef(timeOffset)
  const currentTimeRef = useRef(currentTime)
  const isPlayingRef   = useRef(isPlaying)
  useEffect(() => { timeOffsetRef.current  = timeOffset  }, [timeOffset])
  useEffect(() => { currentTimeRef.current = currentTime }, [currentTime])
  useEffect(() => { isPlayingRef.current   = isPlaying   }, [isPlaying])

  const prevSrcRef = useRef<string | null>(null)
  useEffect(() => {
    if (src === prevSrcRef.current) return
    prevSrcRef.current = src
    loopBaseRef.current = 0   // reset loop offset whenever the active clip changes
    if (!src) { setVisibleSrc(null); return }
    const video = poolRef.current.get(src)
    if (!video) { setVisibleSrc(src); return }
    const elapsed  = Math.max(0, currentTimeRef.current - timeOffsetRef.current - clipInPoint)
    const srcTime  = loopDuration ? clipInPoint + (elapsed % loopDuration) : Math.max(0, currentTimeRef.current - timeOffsetRef.current)
    loopBaseRef.current = loopDuration ? Math.floor(elapsed / loopDuration) * loopDuration : 0
    if (Math.abs(video.currentTime - srcTime) <= 0.12) { setVisibleSrc(src); return }
    setVisibleSrc(null)
    video.currentTime = srcTime
    const reveal = () => setVisibleSrc(src)
    if (typeof (video as any).requestVideoFrameCallback === 'function') {
      const id = (video as any).requestVideoFrameCallback(reveal)
      const fallback = setTimeout(reveal, 200)
      return () => { (video as any).cancelVideoFrameCallback?.(id); clearTimeout(fallback) }
    }
    video.addEventListener('seeked', reveal, { once: true })
    const fallback = setTimeout(reveal, 200)
    return () => { video.removeEventListener('seeked', reveal); clearTimeout(fallback) }
  }, [src]) // eslint-disable-line

  useEffect(() => {
    const video = src ? poolRef.current.get(src) : null
    if (!video) return
    const elapsed  = Math.max(0, currentTime - timeOffset - clipInPoint)
    const srcTime  = loopDuration ? clipInPoint + (elapsed % loopDuration) : Math.max(0, currentTime - timeOffset)
    loopBaseRef.current = loopDuration ? Math.floor(elapsed / loopDuration) * loopDuration : 0
    if (Math.abs(video.currentTime - srcTime) > 0.5) video.currentTime = srcTime
  }, [currentTime, timeOffset, src]) // eslint-disable-line

  useEffect(() => {
    for (const [s, el] of poolRef.current) {
      if (s === src) {
        if (isPlaying) el.play().catch(() => {})
        else           el.pause()
      } else {
        el.pause()
      }
    }
  }, [src, isPlaying]) // eslint-disable-line

  useEffect(() => {
    if (!isPlaying) return
    for (const [url, hint] of Object.entries(seekHints)) {
      if (url === src) continue
      const video = poolRef.current.get(url)
      if (!video) continue
      const timeUntilTransition = hint.startTime - currentTime
      if (timeUntilTransition <= PREPLAY_LEAD && timeUntilTransition > -0.1) {
        if (hint.inPoint >= PREPLAY_LEAD) {
          const targetPos = hint.inPoint - timeUntilTransition
          if (video.paused || Math.abs(video.currentTime - targetPos) > 0.15) {
            video.currentTime = Math.max(0, targetPos)
            video.play().catch(() => {})
          }
        } else {
          if (Math.abs(video.currentTime - hint.inPoint) > 0.08) video.currentTime = hint.inPoint
          if (video.paused) video.play().catch(() => {})
        }
      } else if (timeUntilTransition > PREPLAY_LEAD) {
        if (video.readyState >= 1 && Math.abs(video.currentTime - hint.inPoint) > 0.08) video.currentTime = hint.inPoint
        if (!video.paused) video.pause()
      }
    }
  }, [seekHints, currentTime, isPlaying, src]) // eslint-disable-line

  // VU meter — connect Web Audio API and read levels via RAF
  useEffect(() => {
    if (!showVUMeter || !src) {
      if (vuRafRef.current) { cancelAnimationFrame(vuRafRef.current); vuRafRef.current = null }
      setVuLevels([0, 0])
      return
    }
    const video = poolRef.current.get(src)
    if (!video) return

    // Create AudioContext lazily
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)()
    }
    const ctx = audioCtxRef.current

    // Connect video → analyser only once per URL
    let analyser = analyserRef.current
    if (!audioSourcesRef.current.has(src)) {
      try {
        const srcNode = ctx.createMediaElementSource(video)
        analyser = ctx.createAnalyser()
        analyser.fftSize = 256
        srcNode.connect(analyser)
        analyser.connect(ctx.destination)
        audioSourcesRef.current.set(src, srcNode)
        analyserRef.current = analyser
      } catch { /* CORS or already connected */ }
    }
    if (!analyserRef.current) return

    const data = new Uint8Array(analyserRef.current.frequencyBinCount)
    function tick() {
      analyserRef.current?.getByteTimeDomainData(data)
      let rms = 0
      for (const v of data) { const s = (v - 128) / 128; rms += s * s }
      const level = Math.min(1, Math.sqrt(rms / data.length) * 6)
      setVuLevels([level, level])
      vuRafRef.current = requestAnimationFrame(tick)
    }
    vuRafRef.current = requestAnimationFrame(tick)
    return () => { if (vuRafRef.current) { cancelAnimationFrame(vuRafRef.current); vuRafRef.current = null } }
  }, [showVUMeter, src])

  const activeCaption = captions.find(c => currentTime >= c.start && currentTime <= c.end) ?? null

  function setPoolRef(s: string, el: HTMLVideoElement | null) {
    if (el) poolRef.current.set(s, el)
  }

  const activeEl = src ? poolRef.current.get(src) : null
  const baseFilter = buildFilter(showOriginal ? undefined : adjustments)
  const motionBlurPx = motionBlurEnabled
    ? Math.min(6, Math.max(0, (Math.abs(currentClipSpeed - 1)) * 2.5))
    : 0
  const effectiveFilter = motionBlurPx > 0.1
    ? (baseFilter === 'none' ? `blur(${motionBlurPx.toFixed(1)}px)` : `${baseFilter} blur(${motionBlurPx.toFixed(1)}px)`)
    : baseFilter
  const cs = clipTransform
  const clipStyle = buildClipStyle(cs)
  const guideDims = aspectGuideStyle(aspectGuide, monitorSize.w, monitorSize.h)
  const vignette = adjustments?.vignette ?? 0

  function handleTimecodeClick() {
    setTcInput(formatTimecode(currentTime))
    setEditingTC(true)
  }
  function commitTimecode() {
    const t = parseTimecode(tcInput)
    if (!isNaN(t) && t >= 0) onSeekRequest?.(t)
    setEditingTC(false)
  }

  return (
    <div className="flex flex-col h-full" style={{ background: '#0a0a0a' }}>

      {/* ── Monitor ──────────────────────────────────────────────── */}
      <div
        ref={monitorRef}
        className="relative flex-1 flex items-center justify-center overflow-hidden"
        style={{ background: '#000' }}
      >
        {/* Viewer zoom wrapper */}
        <div
          style={{
            position: 'absolute', inset: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transform: viewerZoom !== 1 ? `scale(${viewerZoom})` : 'none',
            transformOrigin: 'center',
          }}
        >
          {/* Empty placeholder */}
          {!src && (
            <div className="flex flex-col items-center gap-3 select-none pointer-events-none">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.04)' }}>
                <Film size={26} color="rgba(255,255,255,0.12)" />
              </div>
              <p className="text-xs text-center leading-relaxed" style={{ color: 'rgba(255,255,255,0.2)', maxWidth: 180 }}>
                Drag a clip from the Media Pool onto a track to begin editing
              </p>
            </div>
          )}

          {/* Optical flow canvas */}
          {optFlowActive && (
            <canvas
              ref={optFlowCanvasRef}
              style={{
                position: 'absolute',
                top: '50%', left: '50%',
                transform: 'translate(-50%, -50%)',
                maxWidth: '100%', maxHeight: '100%',
                filter: effectiveFilter,
                ...(clipStyle as React.CSSProperties),
                zIndex: 3,
                pointerEvents: 'none',
              }}
            />
          )}

          {/* Frame blend canvas — sits above videos, only visible when blending */}
          {blendActive && (
            <canvas
              ref={blendCanvasRef}
              style={{
                position: 'absolute',
                top: '50%', left: '50%',
                transform: 'translate(-50%, -50%)',
                maxWidth: '100%', maxHeight: '100%',
                filter: effectiveFilter,
                ...(clipStyle as React.CSSProperties),
                zIndex: 2,
                pointerEvents: 'none',
              }}
            />
          )}

          {/* Video pool */}
          {allSrcs.map(s => (
            <video
              key={s}
              ref={el => setPoolRef(s, el)}
              src={s}
              preload="auto"
              playsInline
              style={{
                position: 'absolute', inset: 0,
                width: '100%', height: '100%',
                objectFit: 'contain',
                filter: s === src ? effectiveFilter : 'none',
                opacity: s === visibleSrc && contentType === 'video' && !blendActive && !optFlowActive ? 1 : 0,
                pointerEvents: 'none',
                zIndex: s === visibleSrc ? 1 : 0,
                mixBlendMode: (s === src && blendMode) ? blendMode as React.CSSProperties['mixBlendMode'] : undefined,
                ...(s === src ? clipStyle : {}),
              }}
              onTimeUpdate={e => {
                if (s !== src) return
                onTimeUpdate(loopBaseRef.current + e.currentTarget.currentTime + timeOffset)
              }}
              onPlay={() => { if (s === src) onPlay() }}
              onPause={() => { if (s === src) onPause() }}
              onEnded={e => {
                if (s !== src) return
                if (loopDuration) {
                  loopBaseRef.current += loopDuration
                  e.currentTarget.currentTime = clipInPoint
                  // Report the new loop-start time immediately so React state is
                  // up to date before the seek effect can fire with stale currentTime
                  onTimeUpdate(loopBaseRef.current + clipInPoint + timeOffset)
                  e.currentTarget.play().catch(() => {})
                } else {
                  onPause()
                }
              }}
              onError={() => { if (s === src) onMediaError?.() }}
            />
          ))}
        </div>

        {/* Title clip overlay */}
        {titleClip && contentType === 'title' && (() => {
          const tc = titleClip
          const posStyle: React.CSSProperties =
            tc.position === 'upper'       ? { top: '10%',   left: 0, right: 0 } :
            tc.position === 'lower-third' ? { bottom: '12%', left: 0, right: 0 } :
                                            { top: '50%',   left: 0, right: 0, transform: 'translateY(-50%)' }
          const opacity =
            tc.animation === 'fade'     ? Math.min(1, tc.localProgress * 4) * Math.min(1, (1 - tc.localProgress) * 4) :
            tc.animation === 'slide-up' ? Math.min(1, tc.localProgress * 6) : 1
          const translateY =
            tc.animation === 'slide-up' ? `${Math.max(0, (1 - tc.localProgress * 4) * 24)}px` : '0px'
          return (
            <div style={{
              position: 'absolute', zIndex: 10, textAlign: 'center', padding: '0 5%',
              pointerEvents: 'none', opacity,
              transform: `${posStyle.transform ?? ''} translateY(${translateY})`,
              ...posStyle,
            }}>
              <span style={{
                display: 'inline-block',
                fontSize: tc.fontSize,
                color: tc.color,
                background: tc.bg !== 'transparent' ? tc.bg : undefined,
                padding: tc.bg !== 'transparent' ? '4px 12px' : undefined,
                borderRadius: tc.bg !== 'transparent' ? 4 : undefined,
                fontWeight: 700,
                letterSpacing: '-0.01em',
                lineHeight: 1.2,
                textShadow: tc.bg === 'transparent' ? '0 1px 4px rgba(0,0,0,0.8)' : undefined,
              }}>{tc.text}</span>
            </div>
          )
        })()}

        {/* Audio mode overlay */}
        {src && contentType === 'audio' && (
          <div className="relative z-10 flex flex-col items-center gap-6 select-none px-8 w-full max-w-sm">
            <div className="w-24 h-24 rounded-3xl flex items-center justify-center" style={{ background: 'rgba(61,143,239,0.08)', border: '1px solid rgba(61,143,239,0.15)' }}>
              <Mic size={40} color="rgba(61,143,239,0.6)" />
            </div>
            <div className="flex items-end gap-0.5 h-14 w-full">
              {WAVEFORM.map((h, i) => {
                const progress = (currentTime - timeOffset) / Math.max(activeEl?.duration ?? 1, 1)
                const isPast = i / WAVEFORM.length < progress
                return (
                  <div key={i} className="flex-1 rounded-full" style={{ height: `${h}%`, background: isPast ? 'var(--accent)' : '#2a2a2a', transition: 'background 0.1s' }} />
                )
              })}
            </div>
            {activeCaption && (
              <div className="w-full text-center px-4 py-3 rounded-xl" style={{ background: 'rgba(61,143,239,0.06)', border: '1px solid rgba(61,143,239,0.15)' }}>
                {activeCaption.speaker && <span className="text-xs font-semibold mr-1.5" style={{ color: 'var(--accent-light)' }}>{activeCaption.speaker}:</span>}
                <span className="text-sm" style={{ color: '#ccc' }}>{activeCaption.text}</span>
              </div>
            )}
          </div>
        )}

        {/* ── Overlays (always above video) ── */}

        {/* Vignette */}
        {vignette > 0 && (
          <div style={{
            position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 3,
            background: `radial-gradient(ellipse at center, transparent ${Math.max(20, 80 - vignette)}%, rgba(0,0,0,${Math.min(0.95, vignette / 80)}) 100%)`,
          }} />
        )}

        {/* Aspect ratio guide */}
        {aspectGuide !== 'none' && (
          <>
            <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 4, ...guideDims }}>
              <div style={{ position: 'absolute', inset: 0, border: '1px solid rgba(255,255,255,0.35)' }} />
            </div>
            {/* Mask outside guide (semi-opaque bars) */}
            {guideDims.left && (
              <>
                <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: guideDims.left, background: 'rgba(0,0,0,0.55)', pointerEvents: 'none', zIndex: 4 }} />
                <div style={{ position: 'absolute', top: 0, bottom: 0, right: 0, width: guideDims.right as string, background: 'rgba(0,0,0,0.55)', pointerEvents: 'none', zIndex: 4 }} />
              </>
            )}
            {guideDims.top && (
              <>
                <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: guideDims.top, background: 'rgba(0,0,0,0.55)', pointerEvents: 'none', zIndex: 4 }} />
                <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: guideDims.bottom as string, background: 'rgba(0,0,0,0.55)', pointerEvents: 'none', zIndex: 4 }} />
              </>
            )}
          </>
        )}

        {/* Safe areas */}
        {showSafeAreas && (
          <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 5 }}>
            {/* Action safe — 10% inset */}
            <div style={{ position: 'absolute', inset: '10%', border: '1px solid rgba(255,255,255,0.2)', boxSizing: 'border-box' }}>
              <span style={{ position: 'absolute', top: 2, left: 3, fontSize: 7, color: 'rgba(255,255,255,0.25)', fontWeight: 700 }}>ACTION</span>
            </div>
            {/* Title safe — 5% inset */}
            <div style={{ position: 'absolute', inset: '5%', border: '1px solid rgba(255,255,255,0.35)', boxSizing: 'border-box' }}>
              <span style={{ position: 'absolute', top: 2, left: 3, fontSize: 7, color: 'rgba(255,255,255,0.35)', fontWeight: 700 }}>TITLE</span>
            </div>
          </div>
        )}

        {/* VU Meter — left side so right-side toolbars stay clear */}
        {showVUMeter && (
          <div style={{ position: 'absolute', left: 8, top: 8, bottom: 8, zIndex: 6, display: 'flex', gap: 3, alignItems: 'flex-end', pointerEvents: 'none' }}>
            {vuLevels.map((lvl, i) => (
              <div key={i} style={{ width: 8, height: '100%', background: 'rgba(0,0,0,0.5)', borderRadius: 3, overflow: 'hidden', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
                <div style={{
                  width: '100%',
                  height: `${lvl * 100}%`,
                  background: lvl > 0.85 ? '#ef4444' : lvl > 0.65 ? '#f97316' : '#22c55e',
                  borderRadius: '0 0 3px 3px',
                  transition: 'height 0.05s',
                  minHeight: isPlaying ? 2 : 0,
                }} />
              </div>
            ))}
          </div>
        )}

        {/* Draw Focus point marker — single crosshair dot tracking the recorded path */}
        {(activeFocusClip || focusLivePos) && (() => {
          const fx = focusLivePos?.x ?? activeFocusClip!.x
          const fy = focusLivePos?.y ?? activeFocusClip!.y
          return (
            <div style={{
              position: 'absolute', zIndex: 7, pointerEvents: 'none',
              left: `${fx * 100}%`, top: `${fy * 100}%`,
              transform: 'translate(-50%, -50%)',
            }}>
              {/* Outer ring */}
              <div style={{
                position: 'absolute',
                width: 28, height: 28,
                borderRadius: '50%',
                border: '1.5px solid rgba(167,139,250,0.9)',
                top: '50%', left: '50%',
                transform: 'translate(-50%, -50%)',
                boxShadow: '0 0 6px rgba(0,0,0,0.6)',
              }} />
              {/* Center dot */}
              <div style={{
                position: 'absolute',
                width: 5, height: 5,
                borderRadius: '50%',
                background: 'rgba(167,139,250,1)',
                top: '50%', left: '50%',
                transform: 'translate(-50%, -50%)',
              }} />
              {/* Crosshair lines */}
              <div style={{ position: 'absolute', width: 1, height: 16, background: 'rgba(167,139,250,0.9)', top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }} />
              <div style={{ position: 'absolute', width: 16, height: 1, background: 'rgba(167,139,250,0.9)', top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }} />
            </div>
          )
        })()}
        {/* Focus pointer capture — active whenever a focus clip is selected */}
        {onSetFocusPoint && (
          <div
            style={{
              position: 'absolute', inset: 0, zIndex: 8,
              cursor: isRecordingFocus ? 'crosshair' : 'default',
            }}
            onPointerDown={e => {
              e.currentTarget.setPointerCapture(e.pointerId)
              focusPointerDownRef.current = true
              const rect = e.currentTarget.getBoundingClientRect()
              const x = (e.clientX - rect.left) / rect.width
              const y = (e.clientY - rect.top) / rect.height
              setFocusLivePos({ x, y })
              onFocusRecordStart?.()
              onSetFocusPoint(x, y)
            }}
            onPointerMove={e => {
              if (!focusPointerDownRef.current) return
              const rect = e.currentTarget.getBoundingClientRect()
              const x = (e.clientX - rect.left) / rect.width
              const y = (e.clientY - rect.top) / rect.height
              setFocusLivePos({ x, y })
              onSetFocusPoint(x, y)
            }}
            onPointerUp={() => {
              focusPointerDownRef.current = false
              setFocusLivePos(null)
              onFocusRecordEnd?.()
            }}
          />
        )}

        {/* Video overlays (labels, captions) */}
        {src && contentType === 'video' && (
          <div className="absolute inset-0 z-10 pointer-events-none">
            {clipLabel && (
              <div className="absolute top-2 left-2 px-2 py-0.5 rounded text-xs font-medium" style={{ background: 'rgba(0,0,0,0.6)', color: 'rgba(255,255,255,0.55)', backdropFilter: 'blur(4px)' }}>
                {clipLabel}
              </div>
            )}
            {activeCaption && (
              <div className="absolute bottom-8 left-1/2 -translate-x-1/2 px-4 py-2 rounded text-sm font-medium text-center max-w-[80%]" style={{ background: 'rgba(0,0,0,0.75)', color: '#fff', textShadow: '0 1px 2px rgba(0,0,0,0.8)', backdropFilter: 'blur(4px)' }}>
                {activeCaption.speaker && <span className="text-xs font-semibold mr-1.5" style={{ color: 'var(--accent-light)' }}>{activeCaption.speaker}</span>}
                {activeCaption.text}
              </div>
            )}
          </div>
        )}

        {/* ── Right-side vertical toolbars ─────────────────────────── */}
        {/* Zoom bar */}
        {onViewerZoomChange && (
          <div style={{
            position: 'absolute', right: 52, top: '50%', transform: 'translateY(-50%)',
            zIndex: 20, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
            background: 'rgba(10,10,10,0.75)', backdropFilter: 'blur(10px)',
            borderRadius: 10, padding: '8px 5px',
            border: '1px solid rgba(255,255,255,0.07)',
          }}>
            <button
              tabIndex={-1}
              onClick={() => onViewerZoomChange(Math.min(2, Math.round((viewerZoom + 0.25) * 100) / 100))}
              style={{ color: '#888', padding: 4, borderRadius: 6, display: 'flex', cursor: 'pointer', background: 'none', border: 'none' }}
              title="Zoom in"
            >
              <ZoomIn size={13} />
            </button>
            <span style={{ fontSize: 9, color: '#555', fontFamily: 'monospace', lineHeight: 1 }}>{viewerZoom}×</span>
            <button
              tabIndex={-1}
              onClick={() => onViewerZoomChange(Math.max(0.25, Math.round((viewerZoom - 0.25) * 100) / 100))}
              style={{ color: '#888', padding: 4, borderRadius: 6, display: 'flex', cursor: 'pointer', background: 'none', border: 'none' }}
              title="Zoom out"
            >
              <ZoomOut size={13} />
            </button>
          </div>
        )}

        {/* Playback bar */}
        <div style={{
          position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
          zIndex: 20, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
          background: 'rgba(10,10,10,0.75)', backdropFilter: 'blur(10px)',
          borderRadius: 10, padding: '8px 5px',
          border: '1px solid rgba(255,255,255,0.07)',
        }}>
          <button
            tabIndex={-1}
            onClick={() => { if (activeEl) activeEl.currentTime = 0; onTimeUpdate(timeOffset) }}
            style={{ color: '#666', padding: 4, borderRadius: 6, display: 'flex', cursor: 'pointer', background: 'none', border: 'none' }}
            title="Return to start (Home)"
          >
            <SkipBack size={13} />
          </button>
          <button
            tabIndex={-1}
            onClick={() => isPlaying ? onPause() : onPlay()}
            style={{
              width: 30, height: 30, borderRadius: 8,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'var(--accent)', border: 'none', cursor: 'pointer',
            }}
            title={isPlaying ? 'Pause (K / Space)' : 'Play (L / Space)'}
          >
            {isPlaying ? <Pause size={13} color="#fff" /> : <Play size={13} color="#fff" />}
          </button>
          <div style={{ width: 20, height: 1, background: 'rgba(255,255,255,0.08)', margin: '1px 0' }} />
          {([0.5, 1, 1.5, 2] as const).map(rate => (
            <button
              key={rate}
              tabIndex={-1}
              onClick={() => onPlaybackRateChange?.(rate)}
              style={{
                fontSize: 9, fontFamily: 'monospace', cursor: 'pointer',
                color: playbackRate === rate ? 'var(--accent-light)' : '#444',
                background: playbackRate === rate ? 'rgba(139,92,246,0.2)' : 'none',
                border: `1px solid ${playbackRate === rate ? 'rgba(139,92,246,0.35)' : 'transparent'}`,
                borderRadius: 4, padding: '2px 4px', width: 28, textAlign: 'center',
              }}
            >{rate}×</button>
          ))}
        </div>
      </div>

      {/* ── Timecode strip ───────────────────────────────────────── */}
      <div
        className="flex items-center justify-between px-4 shrink-0"
        style={{ height: 28, background: '#0d0d0d', borderTop: '1px solid #1a1a1a' }}
      >
        {editingTC ? (
          <input
            autoFocus
            value={tcInput}
            onChange={e => setTcInput(e.target.value)}
            onBlur={commitTimecode}
            onKeyDown={e => {
              if (e.key === 'Enter') commitTimecode()
              if (e.key === 'Escape') setEditingTC(false)
            }}
            className="font-mono tracking-widest bg-transparent outline-none border-b border-accent"
            style={{ fontSize: 13, color: '#d0d0d0', letterSpacing: '0.12em', width: 120 }}
          />
        ) : (
          <span
            className="font-mono tracking-widest select-none cursor-text"
            style={{ fontSize: 13, color: '#d0d0d0', letterSpacing: '0.12em' }}
            title="Click to jump to timecode"
            onClick={handleTimecodeClick}
          >
            {formatTimecode(currentTime)}
          </span>
        )}
        <span className="font-mono" style={{ fontSize: 10, color: '#3a3a3a', letterSpacing: '0.08em' }}>
          {activeEl?.duration ? `/ ${formatTimecode(activeEl.duration + timeOffset)}` : ''}
        </span>
      </div>

    </div>
  )
}
