'use client'

import { useEffect, useLayoutEffect, useRef, useMemo, useState, useCallback } from 'react'
import { Play, Pause, SkipBack, Mic, Film, ZoomIn, ZoomOut } from 'lucide-react'
import type { Caption, ContentType } from '@/lib/types'
import type { CaptionStyle, ProjectAspect, TransitionType, VideoAdjustments } from '@/lib/editor-types'
import { aspectRatioOf, DEFAULT_CAPTION_STYLE } from '@/lib/editor-types'
import MusicVizOverlay from './MusicVizOverlay'
import { interpolateFocusKF, buildFocusSVGPath, type FocusKeyframe } from '@/lib/focus-utils'
import { fontStack, textShadowCss, titleAnim, titleFontPx, revealLines } from '@/lib/text-styles'
import { captionWords } from '@/lib/captions'
import { r2CorsEligible } from '@/lib/media-cors'
import { instantSpeed, sourceOffsetAt, sourceTimeAt } from '@/lib/video-export/speed'
import { getLutGL } from '@/lib/video-export/lut-gl'
import type { LutData } from '@/lib/lut-parser'

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
  fitMode?: 'contain' | 'cover'   // how the clip fills the project frame
  crop?: { l: number; t: number; r: number; b: number }  // inset crop (fractions of the element box)
}

export const DEFAULT_CLIP_TRANSFORM: ClipTransform = {
  opacity: 100, flipH: false, flipV: false,
  cropZoom: 100, cropX: 0, cropY: 0, fadeOpacity: 1,
}

/** Transition-in of the ACTIVE clip, passed while its window could be on screen. */
export interface ActiveClipTransition {
  type: TransitionType
  duration: number       // seconds, already clamped to the clip length
  prevSrc: string | null // pool src of the outgoing clip (null = from black)
  prevTime: number       // source time of the outgoing clip's frozen last frame
  prevFitMode?: 'contain' | 'cover'
}

/** A separate audio-track clip played alongside the visuals (kept in coarse sync with the playhead). */
export type AudioLayer = {
  id: string
  src: string
  startTime: number
  inPoint: number
  outPoint: number
  speed?: number
  gain?: number
}

/** A layer stacked UNDER the active clip (multi-track compositing). Bottom → top. */
export type UnderLayer =
  | {
      kind: 'video'
      id: string
      src: string
      startTime: number
      inPoint: number
      outPoint: number
      speed?: number
      speedPoints?: Array<{ t: number; speed: number }>
      transform: ClipTransform
      blendMode?: string
      /** Global grade + this clip's own grade, as a ready CSS filter chain. */
      filter: string
    }
  | {
      kind: 'title'
      id: string
      text: string
      fontSize: number
      color: string
      bg: string
      position: 'upper' | 'center' | 'lower-third'
      animation: import('@/lib/text-styles').TitleAnimation
      localProgress: number
      durSec: number
      animAmount?: number
      textOpacity?: number
      // Rich styling (lib/text-styles) — so a title on a lower track looks as good as the top one.
      font?: string
      weight?: number
      letterSpacing?: number
      uppercase?: boolean
      shadow?: boolean
      glow?: string
      outline?: number
      outlineColor?: string
    }
  | {
      kind: 'image'
      id: string
      src: string
      transform: ClipTransform
      blendMode?: string
      filter: string
    }

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
  /** Music-visual overlays active at the playhead — canvas visuals rendered over
   *  the video, reacting to the media analyser. */
  musicViz?: Array<{ id: string; format: string; accent: string; bg: [string, string] | null; resolution?: number; opacity?: number; blendMode?: string }>
  clipTransform?: ClipTransform
  viewerZoom?: number
  showSafeAreas?: boolean
  projectAspect?: ProjectAspect
  transition?: ActiveClipTransition
  underLayers?: UnderLayer[]
  /** Separate audio-track clips to play (mixed with the active clip's own audio). Lets a video project
   *  keep its music as an EDITABLE audio clip instead of baked into the video. Synced to the playhead. */
  audioLayers?: AudioLayer[]
  captionStyle?: CaptionStyle
  /** Per-clip grade of the active clip, as a CSS filter chain appended after the global grade. */
  clipGradeFilter?: string
  /** Effect overlays active at the playhead (grain/vignette/scanlines) — drawn over the frame. */
  overlays?: import('@/lib/video-effects').OverlayId[]
  /** Parsed LUT of the active clip — rendered via a WebGL overlay canvas. */
  lutData?: LutData | null
  showVUMeter?: boolean
  onSeekRequest?: (t: number) => void   // called when user types a timecode
  frameBlendEnabled?: boolean
  clipSpeed?: number                    // 0–1 for slow-mo; blending only activates < 1
  motionBlurEnabled?: boolean
  currentClipSpeed?: number             // real-time speed (may differ from clipSpeed via ramp)
  opticalFlowEnabled?: boolean
  /** Performance mode — when true, suppress the expensive optional visualizers
   *  (frame blend, optical flow, motion blur, VU meter, live music-viz
   *  animation). Preview-only; never affects export. */
  perfMode?: boolean
  blendMode?: string         // CSS mix-blend-mode
  loopDuration?: number      // when set, clip loops; each cycle plays clipInPoint→(clipInPoint+loopDuration)
  clipInPoint?: number       // inPoint of the active clip (used for loop reset position)
  // Set only when the ACTIVE clip has freeze/reverse — the element is then scrubbed to sourceTimeAt each
  // frame instead of played, and the RAF clock (not the element) drives the playhead. Null = normal.
  activeRemap?: { reverse?: boolean; freeze?: boolean; inPoint: number; outPoint: number; startTime: number; speed?: number; speedPoints?: Array<{ t: number; speed: number }> } | null
  titleClip?: {              // populated when contentType === 'title'
    text: string
    fontSize: number
    color: string
    bg: string
    position: 'upper' | 'center' | 'lower-third'
    animation: import('@/lib/text-styles').TitleAnimation
    localProgress: number    // 0–1 through clip duration (for animations)
    durSec: number           // clip duration in seconds (animation in/out windows)
    animAmount?: number      // effect intensity (0–2, default 1)
    textOpacity?: number     // overall text opacity 0–100 (default 100)
    font?: string            // rich styling (lib/text-styles)
    weight?: number
    letterSpacing?: number
    uppercase?: boolean
    shadow?: boolean
    glow?: string
    outline?: number
    outlineColor?: string
  }
  lutCanvas?: OffscreenCanvas | null  // pre-rendered LUT canvas frame (set externally)
  playbackRate?: number
  onPlaybackRateChange?: (rate: number) => void
  activeFocusClip?: { x: number; y: number }
  onSetFocusPoint?: (x: number, y: number) => void
  onFocusRecordStart?: () => void
  onFocusRecordEnd?: () => void
  isRecordingFocus?: boolean
  focusKeyframes?: FocusKeyframe[]
  focusClipStartTime?: number
  onFocusKeyframeMove?: (index: number, x: number, y: number) => void
  onViewerZoomChange?: (z: number) => void
  /** On-canvas move/resize gizmo for the selected media clip — drives the
   *  clip's cropX/cropY/cropZoom fields. Null when no gizmo should show. */
  gizmo?: { cropZoom: number; cropX: number; cropY: number; crop?: { l: number; t: number; r: number; b: number } } | null
  onGizmoChange?: (patch: { cropZoom?: number; cropX?: number; cropY?: number; crop?: { l: number; t: number; r: number; b: number } }) => void
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
  const style: React.CSSProperties = {
    transform: parts.length ? parts.join(' ') : 'none',
    transformOrigin: 'center',
    opacity: (t.opacity / 100) * t.fadeOpacity,
  }
  // Inset crop — applied in the element's LOCAL box (before the transform above,
  // which then carries it), so it matches the export's ctx.clip in the same
  // transformed W×H space. CSS inset order is top right bottom left.
  const c = t.crop
  if (c && (c.l || c.t || c.r || c.b)) {
    style.clipPath = `inset(${(c.t * 100).toFixed(3)}% ${(c.r * 100).toFixed(3)}% ${(c.b * 100).toFixed(3)}% ${(c.l * 100).toFixed(3)}%)`
  }
  return style
}

// The stage is the project frame: an aspect-locked box centered in the monitor.
// Everything frame-relative (video, vignette, titles, captions, safe areas,
// focus) lives inside it, matching the export compositor's canvas exactly.
function stageDims(aspect: ProjectAspect, containerW: number, containerH: number): { width: number; height: number } {
  const ar = aspectRatioOf(aspect)
  if (!containerW || !containerH) return { width: 640, height: 640 / ar }
  const containerAR = containerW / containerH
  return containerAR > ar
    ? { width: containerH * ar, height: containerH }
    : { width: containerW, height: containerW / ar }
}

function parseTimecode(s: string, fps = 30): number {
  const clean = s.trim()
  const parts = clean.split(':').map(Number)
  if (parts.some(isNaN)) return NaN
  if (parts.length === 4) return parts[0] * 3600 + parts[1] * 60 + parts[2] + parts[3] / fps
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  return Number(clean)
}

function formatTimecode(s: number, fps = 30): string {
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
  adjustments, onTimeUpdate, onPlay, onPause, onMediaError, videoRef, clipLabel, activeRemap = null,
  preloadSrcs = [], seekHints = {}, showOriginal = false,
  clipTransform = DEFAULT_CLIP_TRANSFORM,
  viewerZoom = 1,
  showSafeAreas = false,
  projectAspect = '16:9',
  transition,
  underLayers = [],
  audioLayers = [],
  musicViz = [],
  captionStyle = DEFAULT_CAPTION_STYLE,
  clipGradeFilter = '',
  overlays = [],
  lutData = null,
  showVUMeter = false,
  onSeekRequest,
  frameBlendEnabled = false,
  clipSpeed = 1,
  motionBlurEnabled = false,
  currentClipSpeed = 1,
  opticalFlowEnabled = false,
  perfMode = false,
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
  focusKeyframes,
  focusClipStartTime = 0,
  onFocusKeyframeMove,
  onViewerZoomChange,
  gizmo = null,
  onGizmoChange,
}: Props) {
  // Tracks cumulative full-loop offsets so onTimeUpdate reports monotonically
  // increasing timeline time even as video.currentTime wraps back to 0.
  const loopBaseRef = useRef(0)
  const poolRef = useRef<Map<string, HTMLVideoElement>>(new Map())
  const [visibleSrc, setVisibleSrc] = useState<string | null>(null)
  // Focus recording: local pointer-down state + live display position
  const focusPointerDownRef = useRef(false)
  const [focusLivePos, setFocusLivePos] = useState<{ x: number; y: number } | null>(null)
  const focusLivePosRef = useRef<{ x: number; y: number } | null>(null)
  // RAF-driven focus marker (bypasses React's 4Hz currentTime update cycle)
  const focusMarkerRef = useRef<HTMLDivElement>(null)
  const focusKeyframesRef = useRef(focusKeyframes)
  const focusClipStartTimeRef = useRef(focusClipStartTime)
  const activeFocusClipRef = useRef(activeFocusClip)
  useEffect(() => { focusKeyframesRef.current = focusKeyframes }, [focusKeyframes])
  useEffect(() => { focusClipStartTimeRef.current = focusClipStartTime }, [focusClipStartTime])
  useEffect(() => { activeFocusClipRef.current = activeFocusClip }, [activeFocusClip])

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

  const blendActive = frameBlendEnabled && !perfMode && clipSpeed < 1 && !!src && contentType === 'video'

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
        // RVFC only fires when the video paints a new frame, so it's already
        // idle while paused — no play-gate needed here.
        blendRvfcRef.current = (video as any).requestVideoFrameCallback(processFrame)
      } else if (isPlayingRef.current) {
        // RAF fallback for Firefox/Safari (fires at display rate, not video frame
        // rate). A paused frame doesn't change, so stop scheduling when stopped;
        // the effect re-runs (isPlaying dep) to redraw + resume on play.
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
  }, [blendActive, src, isPlaying]) // eslint-disable-line

  // Optical flow — multi-frame ring-buffer temporal blend
  // Keeps 4 consecutive frames; blends with Gaussian weights for smoother slow-mo
  const optFlowCanvasRef  = useRef<HTMLCanvasElement>(null)
  const optFlowRingRef    = useRef<Uint8ClampedArray[]>([])
  const optFlowRvfcRef    = useRef<number | null>(null)
  const optFlowRafRef     = useRef<number | null>(null)
  const optFlowOutRef     = useRef<ImageData | null>(null)

  const optFlowActive = opticalFlowEnabled && !perfMode && clipSpeed < 1 && !!src && contentType === 'video' && !blendActive

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

      // Blend ring frames with weights into a reused output buffer (no per-frame
      // Uint8ClampedArray/ImageData allocation → zero GC churn in the loop).
      if (!optFlowOutRef.current || optFlowOutRef.current.width !== vw || optFlowOutRef.current.height !== vh) {
        optFlowOutRef.current = new ImageData(vw, vh)
      }
      const outImg = optFlowOutRef.current
      const out = outImg.data
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
      ctx.putImageData(outImg, 0, 0)
      schedule()
    }

    function schedule() {
      if ((video as any).requestVideoFrameCallback) {
        // RVFC is naturally idle when paused (no new video frames).
        optFlowRvfcRef.current = (video as any).requestVideoFrameCallback(processFrame)
      } else if (isPlayingRef.current) {
        // RAF fallback: a paused frame doesn't change, so stop scheduling when
        // stopped; the effect re-runs (isPlaying dep) to resume on play.
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
  }, [optFlowActive, src, isPlaying]) // eslint-disable-line

  // Monitor container ref for stage sizing; stage = the aspect-locked frame box
  const monitorRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  // Gizmo drag state (move + uniform resize of the selected clip's transform)
  const gizmoDragRef = useRef<
    | { mode: 'move'; startX: number; startY: number; baseX: number; baseY: number; zoom: number; rect: DOMRect }
    | { mode: 'resize'; cx: number; cy: number; startDist: number; baseZoom: number }
    | { mode: 'crop'; edge: 'l' | 't' | 'r' | 'b'; startX: number; startY: number; base: { l: number; t: number; r: number; b: number }; zoom: number; rect: DOMRect }
    | null
  >(null)
  // Active viewport snap guide lines, as frame fractions (0..1) on each axis,
  // shown while the gizmo snaps an element edge/center to a frame edge/center/quarter.
  const [snapGuides, setSnapGuides] = useState<{ x: number[]; y: number[] }>({ x: [], y: [] })
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

  // ── Transition-in progress ────────────────────────────────────────────────
  // p = 0–1 through the active clip's transition window, driven by an RAF that
  // reads the video element's clock directly (React's currentTime updates at
  // ~4 Hz — far too coarse for a 0.5 s dissolve). p stays correct when paused
  // or scrubbing, so a half-finished wipe parks half-finished, like the export.
  const [transP, setTransP] = useState(1)
  const transPRef = useRef(1)
  const transPrevElRef = useRef<HTMLVideoElement | null>(null)
  useEffect(() => {
    if (!transition || !src) { transPRef.current = 1; setTransP(1); return }
    // Park the DEDICATED outgoing element on its frozen last frame (its own
    // element, so even a same-source cut shows two different frames).
    const prevEl = transPrevElRef.current
    if (prevEl && Math.abs(prevEl.currentTime - transition.prevTime) > 0.1) {
      try { prevEl.currentTime = transition.prevTime } catch { /* not seekable yet */ }
    }
    let rafId: number
    const tick = () => {
      // Playing: the element clock is smooth and authoritative. Paused or
      // scrubbing: the element may sit within the seek tolerance of the true
      // position, so use the timeline clock instead (exact while paused).
      const el = poolRef.current.get(src)
      const local = isPlayingRef.current && el
        ? el.currentTime - clipInPoint
        : currentTimeRef.current - timeOffsetRef.current - clipInPoint
      const p = Math.max(0, Math.min(1, transition.duration > 0 ? local / transition.duration : 1))
      if (Math.abs(p - transPRef.current) > 0.005 || (p === 1) !== (transPRef.current === 1)) {
        transPRef.current = p; setTransP(p)
      }
      // Keep polling while the prop is set — scrubbing can re-enter the window.
      rafId = requestAnimationFrame(tick)
    }
    transPRef.current = -1   // force an initial state write
    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [transition, src, clipInPoint])

  const transitionActive = !!transition && transP < 1

  // ── Under-layers (multi-track compositing) ────────────────────────────────
  // Each lower-track clip gets its OWN muted element (separate from the shared
  // src pool, so the same source can appear on two tracks at once), kept in
  // coarse sync with the timeline clock.
  const layerPoolRef = useRef<Map<string, HTMLVideoElement>>(new Map())
  useEffect(() => {
    for (const layer of underLayers) {
      if (layer.kind !== 'video') continue
      const el = layerPoolRef.current.get(layer.id)
      if (!el) continue
      const local = Math.max(0, currentTime - layer.startTime)
      let target = Math.max(0, layer.inPoint + sourceOffsetAt(layer, local))
      const dur = el.duration
      if (isFinite(dur) && dur > 0 && target > dur - 0.01) {
        const cycle = dur - layer.inPoint
        target = cycle > 0.05 ? layer.inPoint + ((target - layer.inPoint) % cycle) : dur - 0.01
      }
      const rate = Math.max(0.0625, Math.min(16, instantSpeed(layer, local) * playbackRate))
      if (Math.abs(el.playbackRate - rate) > 0.01) el.playbackRate = rate
      if (Math.abs(el.currentTime - target) > 0.35) {
        try { el.currentTime = target } catch { /* not seekable yet */ }
      }
      if (isPlaying && el.paused) el.play().catch(() => {})
      if (!isPlaying && !el.paused) el.pause()
    }
  }, [underLayers, currentTime, isPlaying, playbackRate])

  // ── Audio-track layers ────────────────────────────────────────────────────
  // Play separate audio clips (a project's music kept EDITABLE, not baked into the video), each on its
  // own <audio> element kept in coarse sync with the timeline clock — same approach as the video layers.
  const audioPoolRef = useRef<Map<string, HTMLAudioElement>>(new Map())
  useEffect(() => {
    for (const a of audioLayers) {
      const el = audioPoolRef.current.get(a.id)
      if (!el) continue
      const speed = a.speed && a.speed > 0 ? a.speed : 1
      const end = a.startTime + (a.outPoint - a.inPoint) / speed
      const inRange = currentTime >= a.startTime - 0.02 && currentTime < end
      el.volume = Math.max(0, Math.min(1, a.gain ?? 1))
      const rate = Math.max(0.0625, Math.min(16, speed * playbackRate))
      if (Math.abs(el.playbackRate - rate) > 0.01) el.playbackRate = rate
      if (inRange) {
        const target = a.inPoint + (currentTime - a.startTime) * speed
        if (Math.abs(el.currentTime - target) > 0.35) { try { el.currentTime = target } catch { /* not seekable yet */ } }
        if (isPlaying && el.paused) el.play().catch(() => {})
        if (!isPlaying && !el.paused) el.pause()
      } else if (!el.paused) el.pause()
    }
  }, [audioLayers, currentTime, isPlaying, playbackRate])

  // Pause every audio-layer element on unmount.
  useEffect(() => () => { for (const el of audioPoolRef.current.values()) { try { el.pause() } catch { /* gone */ } } }, [])

  // ── Karaoke clock ─────────────────────────────────────────────────────────
  // Word highlighting needs finer time than React's ~4 Hz currentTime updates;
  // an RAF reads the element clock and re-renders at 20 Hz only while karaoke
  // captions are on screen.
  const [karaokeT, setKaraokeT] = useState(0)
  useEffect(() => {
    if (!captionStyle.karaoke) return
    let raf = 0
    const tick = () => {
      const el = src ? poolRef.current.get(src) : null
      const t = el ? loopBaseRef.current + el.currentTime + timeOffsetRef.current : currentTimeRef.current
      setKaraokeT(prev => Math.abs(prev - t) >= 0.05 ? Math.round(t * 20) / 20 : prev)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [captionStyle.karaoke, src])

  // ── LUT overlay (WebGL) ───────────────────────────────────────────────────
  // Draws the active clip's frames through the GPU LUT into a visible canvas
  // covering the raw element. Skipped while frame-blend / optical-flow own the
  // display (they already replace the video with their own canvases).
  const lutCanvasVisRef = useRef<HTMLCanvasElement>(null)
  const lutActive = !!lutData && !!src && contentType === 'video' && !blendActive && !optFlowActive
  useEffect(() => {
    const canvas = lutCanvasVisRef.current
    if (!lutActive || !canvas || !src || !lutData) return
    const video = poolRef.current.get(src)
    const ctx2d = canvas.getContext('2d')
    const gl = getLutGL()
    if (!video || !ctx2d || !gl) return
    let rvfc: number | null = null
    let raf: number | null = null
    const render = () => {
      const vw = video.videoWidth, vh = video.videoHeight
      if (vw > 0 && vh > 0) {
        if (canvas.width !== vw || canvas.height !== vh) { canvas.width = vw; canvas.height = vh }
        const graded = gl.apply(video, lutData, vw, vh)
        if (graded) ctx2d.drawImage(graded, 0, 0)
      }
      schedule()
    }
    const schedule = () => {
      const v = video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number }
      if (v.requestVideoFrameCallback) rvfc = v.requestVideoFrameCallback(render)
      else raf = requestAnimationFrame(render)
    }
    render()
    return () => {
      const v = video as HTMLVideoElement & { cancelVideoFrameCallback?: (id: number) => void }
      if (rvfc !== null) v.cancelVideoFrameCallback?.(rvfc)
      if (raf !== null) cancelAnimationFrame(raf)
    }
  }, [lutActive, src, lutData])

  const allSrcs = useMemo(() => {
    const s = new Set(preloadSrcs)
    if (src && contentType !== 'image') s.add(src)   // image clips render via <img>, not the <video> pool
    return Array.from(s)
  }, [src, preloadSrcs, contentType])

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
    // Freeze/reverse: scrub the element to the exact source time each tick (it never plays forward).
    if (activeRemap) {
      const st = sourceTimeAt(activeRemap, currentTime - activeRemap.startTime)
      if (Math.abs(video.currentTime - st) > 0.05) { try { video.currentTime = st } catch { /* seek race */ } }
      return
    }
    const elapsed  = Math.max(0, currentTime - timeOffset - clipInPoint)
    const srcTime  = loopDuration ? clipInPoint + (elapsed % loopDuration) : Math.max(0, currentTime - timeOffset)
    loopBaseRef.current = loopDuration ? Math.floor(elapsed / loopDuration) * loopDuration : 0
    if (Math.abs(video.currentTime - srcTime) > 0.5) video.currentTime = srcTime
  }, [currentTime, timeOffset, src, activeRemap]) // eslint-disable-line

  useEffect(() => {
    for (const [s, el] of poolRef.current) {
      // A frozen/reversed active clip stays paused — the seek effect scrubs it instead of playing.
      if (s === src && !activeRemap) {
        if (isPlaying) el.play().catch(() => {})
        else           el.pause()
      } else {
        el.pause()
      }
    }
  }, [src, isPlaying, activeRemap]) // eslint-disable-line

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
    // Only read levels while playing — a paused clip produces no audio, so the
    // VU sits at zero (the one final frame) and the loop is parked.
    if (!showVUMeter || perfMode || !src || !isPlaying) {
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
  }, [showVUMeter, perfMode, src, isPlaying])

  // Drive the focus marker by reading video.currentTime directly, bypassing
  // React's throttled currentTime state. Gated: the loop only runs while
  // playing (interpolating keyframes) or while a live focus recording is in
  // progress. When idle we position the marker ONCE for the current time and
  // stop scheduling — a paused marker doesn't move on its own.
  useEffect(() => {
    const position = () => {
      const marker = focusMarkerRef.current
      if (!marker) return
      const livePos = focusLivePosRef.current
      if (livePos) {
        // Recording: show live pointer position
        marker.style.left = `${livePos.x * 100}%`
        marker.style.top  = `${livePos.y * 100}%`
        marker.style.display = 'block'
        return
      }
      const kf = focusKeyframesRef.current
      const video = src ? poolRef.current.get(src) : null
      if (kf && kf.length > 0 && video) {
        // Playback: interpolate at current video time
        const tlTime = loopBaseRef.current + video.currentTime + timeOffset
        const localTime = tlTime - focusClipStartTimeRef.current
        const pos = interpolateFocusKF(kf, localTime)
        marker.style.left = `${pos.x * 100}%`
        marker.style.top  = `${pos.y * 100}%`
        marker.style.display = 'block'
      } else {
        const fallback = activeFocusClipRef.current
        if (fallback) {
          marker.style.left = `${fallback.x * 100}%`
          marker.style.top  = `${fallback.y * 100}%`
          marker.style.display = 'block'
        } else {
          marker.style.display = 'none'
        }
      }
    }

    const hasFocusData = !!activeFocusClip || (focusKeyframes?.length ?? 0) > 0
    const shouldRun = isRecordingFocus || (isPlaying && hasFocusData)

    if (!shouldRun) {
      // One final positioning write for the current (paused) time, then idle.
      position()
      return
    }

    let rafId: number
    const tick = () => { position(); rafId = requestAnimationFrame(tick) }
    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
    // reads live values via refs; the extra dep (currentTime only while paused)
    // re-runs the single static write when the user scrubs a stopped playhead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, timeOffset, isPlaying, isRecordingFocus, activeFocusClip, focusKeyframes, isPlaying ? 0 : currentTime])

  const activeCaption = captions.find(c => currentTime >= c.start && currentTime <= c.end) ?? null

  function setPoolRef(s: string, el: HTMLVideoElement | null) {
    if (el) poolRef.current.set(s, el)
  }

  const activeEl = src ? poolRef.current.get(src) : null
  let baseFilter = buildFilter(showOriginal ? undefined : adjustments)
  if (clipGradeFilter && !showOriginal) {
    baseFilter = baseFilter === 'none' ? clipGradeFilter : `${baseFilter} ${clipGradeFilter}`
  }
  const motionBlurPx = motionBlurEnabled && !perfMode
    ? Math.min(6, Math.max(0, (Math.abs(currentClipSpeed - 1)) * 2.5))
    : 0
  const effectiveFilter = motionBlurPx > 0.1
    ? (baseFilter === 'none' ? `blur(${motionBlurPx.toFixed(1)}px)` : `${baseFilter} blur(${motionBlurPx.toFixed(1)}px)`)
    : baseFilter
  const cs = clipTransform
  const clipStyle = buildClipStyle(cs)
  const stage = stageDims(projectAspect, monitorSize.w, monitorSize.h)
  // On bucket-allowlisted origins, load media with CORS so pixel features
  // (scopes/LUT/blend/flow) read frames without the blob-localize fallback.
  const corsAttr = r2CorsEligible() ? ('anonymous' as const) : undefined
  const vignette = adjustments?.vignette ?? 0

  // Style for each pool <video>, including transition-in compositing. Mirrors
  // the export compositor: incoming clip on top (alpha/clip/translate by type),
  // outgoing clip's frozen frame underneath.
  function poolStyle(s: string): React.CSSProperties {
    const isActive = s === src
    const style: React.CSSProperties = {
      position: 'absolute', inset: 0,
      width: '100%', height: '100%',
      objectFit: isActive ? (cs.fitMode ?? 'contain') : 'contain',
      filter: isActive ? effectiveFilter : 'none',
      opacity: s === visibleSrc && contentType === 'video' && !blendActive && !optFlowActive ? 1 : 0,
      pointerEvents: 'none',
      zIndex: s === visibleSrc ? 2 : 0,
      mixBlendMode: (isActive && blendMode) ? blendMode as React.CSSProperties['mixBlendMode'] : undefined,
      ...(isActive ? clipStyle : {}),
    }
    if (isActive && transitionActive) {
      const ty = transition!.type
      if (ty === 'dissolve' || ty === 'dip_black') {
        style.opacity = Number(style.opacity ?? 1) * transP
      } else if (ty === 'wipe_right') {
        style.clipPath = `inset(0 ${((1 - transP) * 100).toFixed(2)}% 0 0)`
      } else if (ty === 'push') {
        const rest = !clipStyle.transform || clipStyle.transform === 'none' ? '' : ` ${clipStyle.transform}`
        style.transform = `translateX(${((1 - transP) * 100).toFixed(2)}%)${rest}`
      }
    }
    return style
  }

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
    <div className="flex flex-col h-full" style={{ background: 'var(--bg-base)' }}>

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
          {/* Stage — the project frame. Everything frame-relative lives here so
              the preview geometry matches the export canvas 1:1. */}
          <div
            ref={stageRef}
            style={{
              position: 'relative',
              width: stage.width, height: stage.height,
              background: '#000', overflow: 'hidden',
              outline: '1px solid rgba(255,255,255,0.08)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
          {/* Audio-track layers — hidden <audio> elements, synced to the playhead (see effect above). */}
          {audioLayers.map(a => (
            <audio
              key={a.id}
              ref={el => { if (el) audioPoolRef.current.set(a.id, el); else audioPoolRef.current.delete(a.id) }}
              src={a.src}
              preload="auto"
              style={{ display: 'none' }}
            />
          ))}
          {/* Effect overlays (grain / vignette / scanlines) — over the video, matching the export */}
          {overlays.length > 0 && (
            <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 3 }}>
              {overlays.includes('vignette') && <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse at center, transparent 45%, rgba(0,0,0,0.55) 100%)' }} />}
              {overlays.includes('scanlines') && <div style={{ position: 'absolute', inset: 0, background: 'repeating-linear-gradient(0deg, rgba(0,0,0,0.16) 0 1px, transparent 1px 3px)' }} />}
              {(overlays.includes('grain') || overlays.includes('vhs')) && <div style={{ position: 'absolute', inset: 0, opacity: 0.12, mixBlendMode: 'overlay', backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")", backgroundSize: '150px 150px' }} />}
            </div>
          )}
          {/* Under-layers — lower-track clips composited beneath the active clip */}
          {underLayers.map(layer => layer.kind === 'video' ? (
            <video
              key={layer.id}
              ref={el => { if (el) layerPoolRef.current.set(layer.id, el); else layerPoolRef.current.delete(layer.id) }}
              src={layer.src}
              crossOrigin={corsAttr}
              muted playsInline preload="auto"
              style={{
                position: 'absolute', inset: 0,
                width: '100%', height: '100%',
                objectFit: layer.transform.fitMode ?? 'contain',
                filter: showOriginal ? 'none' : layer.filter || 'none',
                pointerEvents: 'none',
                zIndex: 1,
                mixBlendMode: layer.blendMode as React.CSSProperties['mixBlendMode'],
                ...buildClipStyle(layer.transform),
              }}
            />
          ) : layer.kind === 'image' ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={layer.id}
              src={layer.src}
              alt=""
              crossOrigin={corsAttr}
              style={{
                position: 'absolute', inset: 0,
                width: '100%', height: '100%',
                objectFit: layer.transform.fitMode ?? 'contain',
                filter: showOriginal ? 'none' : layer.filter || 'none',
                pointerEvents: 'none',
                zIndex: 1,
                mixBlendMode: layer.blendMode as React.CSSProperties['mixBlendMode'],
                ...buildClipStyle(layer.transform),
              }}
            />
          ) : (() => {
            // Title on a lower track — full rich styling + shared animation, identical to the top title.
            const la = titleAnim(layer.animation, layer.localProgress, layer.durSec, layer.animAmount ?? 1)
            const posStyle: React.CSSProperties =
              layer.position === 'upper'       ? { top: '10%',   left: 0, right: 0 } :
              layer.position === 'lower-third' ? { bottom: '12%', left: 0, right: 0 } :
                                                 { top: '50%',   left: 0, right: 0, transform: 'translateY(-50%)' }
            const fpx = titleFontPx(layer.fontSize, stage.height)   // frame-relative → matches export
            const opx = (layer.outline ?? 0) * stage.height / 1080
            const shownText = la.reveal < 1 ? revealLines((layer.text ?? '').split('\n'), la.reveal).join('\n') : layer.text
            return (
              <div key={layer.id} style={{
                position: 'absolute', zIndex: 1, textAlign: 'center', padding: '0 5%', pointerEvents: 'none',
                opacity: la.opacity * ((layer.textOpacity ?? 100) / 100),
                transform: `${posStyle.transform ?? ''} translateY(${(la.dy * fpx).toFixed(1)}px) scale(${la.scale.toFixed(3)})`,
                filter: la.blur > 0.01 ? `blur(${(la.blur * fpx).toFixed(1)}px)` : undefined,
                ...posStyle,
              }}>
                <span style={{
                  display: 'inline-block', fontSize: fpx, color: layer.color,
                  fontFamily: fontStack(layer.font),
                  background: layer.bg !== 'transparent' ? layer.bg : undefined,
                  padding: layer.bg !== 'transparent' ? `${fpx * 0.14}px ${fpx * 0.28}px` : undefined,
                  borderRadius: layer.bg !== 'transparent' ? fpx * 0.14 : undefined,
                  fontWeight: layer.weight ?? 700,
                  letterSpacing: `${layer.letterSpacing ?? -0.01}em`,
                  textTransform: layer.uppercase ? 'uppercase' : undefined,
                  lineHeight: 1.18, whiteSpace: 'pre-line',
                  WebkitTextStroke: opx ? `${opx}px ${layer.outlineColor || '#000'}` : undefined,
                  textShadow: textShadowCss({ shadow: layer.shadow ?? (layer.bg === 'transparent'), glow: layer.glow, outline: 0 }, fpx) || undefined,
                }}>{shownText}</span>
              </div>
            )
          })())}

          {/* Transition-in: the outgoing clip's frozen last frame in its own
              element (works even when both clips share one source file) */}
          {transition?.prevSrc && (
            <video
              ref={transPrevElRef}
              src={transition.prevSrc}
              crossOrigin={corsAttr}
              muted playsInline preload="auto"
              style={{
                position: 'absolute', inset: 0,
                width: '100%', height: '100%',
                objectFit: transition.prevFitMode ?? 'contain',
                filter: effectiveFilter,
                opacity: transitionActive && transition.type !== 'dip_black' ? 1 : 0,
                transform: transitionActive && transition.type === 'push' ? `translateX(${(-transP * 100).toFixed(2)}%)` : undefined,
                pointerEvents: 'none',
                zIndex: 1,
              }}
            />
          )}

          {/* LUT overlay — GPU-graded frames of the active clip */}
          {lutActive && (
            <canvas
              ref={lutCanvasVisRef}
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

          {/* Empty placeholder */}
          {!src && underLayers.length === 0 && (
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
              crossOrigin={corsAttr}
              preload="auto"
              playsInline
              style={poolStyle(s)}
              onTimeUpdate={e => {
                // A frozen/reversed active clip must NOT drive the clock — RAF does (else the playhead
                // would stall on freeze or run backward on reverse).
                if (s !== src || activeRemap) return
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

          {/* Active still-image clip (e.g. a lifted-subject cutout) — the <video> pool can't play a PNG. */}
          {src && contentType === 'image' && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={src}
              alt=""
              crossOrigin={corsAttr}
              style={{
                position: 'absolute', inset: 0, width: '100%', height: '100%',
                objectFit: cs.fitMode ?? 'contain',
                filter: showOriginal ? 'none' : effectiveFilter,
                opacity: 1, pointerEvents: 'none', zIndex: 2,
                mixBlendMode: blendMode as React.CSSProperties['mixBlendMode'],
                ...clipStyle,
              }}
            />
          )}

        {/* Title clip overlay */}
        {titleClip && contentType === 'title' && (() => {
          const tc = titleClip
          const posStyle: React.CSSProperties =
            tc.position === 'upper'       ? { top: '10%',   left: 0, right: 0 } :
            tc.position === 'lower-third' ? { bottom: '12%', left: 0, right: 0 } :
                                            { top: '50%',   left: 0, right: 0, transform: 'translateY(-50%)' }
          const a = titleAnim(tc.animation, tc.localProgress, tc.durSec, tc.animAmount ?? 1)
          const fpx = titleFontPx(tc.fontSize, stage.height)   // frame-relative → matches export
          const opx = (tc.outline ?? 0) * stage.height / 1080
          const shownText = a.reveal < 1 ? revealLines((tc.text ?? '').split('\n'), a.reveal).join('\n') : tc.text
          return (
            <div style={{
              position: 'absolute', zIndex: 10, textAlign: 'center', padding: '0 5%',
              pointerEvents: 'none', opacity: a.opacity * ((tc.textOpacity ?? 100) / 100),
              transform: `${posStyle.transform ?? ''} translateY(${(a.dy * fpx).toFixed(1)}px) scale(${a.scale.toFixed(3)})`,
              filter: a.blur > 0.01 ? `blur(${(a.blur * fpx).toFixed(1)}px)` : undefined,
              ...posStyle,
            }}>
              <span style={{
                display: 'inline-block',
                fontSize: fpx,
                color: tc.color,
                fontFamily: fontStack(tc.font),
                background: tc.bg !== 'transparent' ? tc.bg : undefined,
                padding: tc.bg !== 'transparent' ? `${fpx * 0.14}px ${fpx * 0.28}px` : undefined,
                borderRadius: tc.bg !== 'transparent' ? fpx * 0.14 : undefined,
                fontWeight: tc.weight ?? 700,
                letterSpacing: `${tc.letterSpacing ?? -0.01}em`,
                textTransform: tc.uppercase ? 'uppercase' : undefined,
                lineHeight: 1.18,
                whiteSpace: 'pre-line',   // render \n as line breaks
                WebkitTextStroke: opx ? `${opx}px ${tc.outlineColor || '#000'}` : undefined,
                textShadow: textShadowCss({ shadow: tc.shadow ?? (tc.bg === 'transparent'), glow: tc.glow, outline: 0 }, fpx) || undefined,
              }}>{shownText}</span>
            </div>
          )
        })()}

        {/* Music-visual overlays — canvas visuals over the video, reacting to the
            media analyser (falls back to an idle animation when it's silent). */}
        {musicViz.map(mv => (
          <div key={mv.id} style={{ position: 'absolute', inset: 0, zIndex: 9, pointerEvents: 'none' }}>
            <MusicVizOverlay
              format={mv.format}
              accent={mv.accent}
              bg={mv.bg}
              resolution={mv.resolution}
              opacity={mv.opacity}
              blendMode={mv.blendMode}
              getAnalyser={() => analyserRef.current}
              isPlaying={isPlaying && !perfMode}
            />
          </div>
        ))}

        {/* ── Overlays (always above video) ── */}

        {/* Vignette */}
        {vignette > 0 && (
          <div style={{
            position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 3,
            background: `radial-gradient(ellipse at center, transparent ${Math.max(20, 80 - vignette)}%, rgba(0,0,0,${Math.min(0.95, vignette / 80)}) 100%)`,
          }} />
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

        {/* ── Draw Focus overlays ─────────────────────────────────── */}
        {(activeFocusClip || (focusKeyframes && focusKeyframes.length > 0)) && (<>

          {/* Smooth SVG path through all keyframes */}
          {focusKeyframes && focusKeyframes.length > 1 && (
            <svg
              viewBox="0 0 1 1"
              preserveAspectRatio="none"
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', zIndex: 6, pointerEvents: 'none', overflow: 'visible' }}
            >
              <path
                d={buildFocusSVGPath(focusKeyframes)}
                fill="none"
                stroke="rgba(167,139,250,0.4)"
                strokeWidth="1.5"
                vectorEffect="non-scaling-stroke"
                strokeDasharray="5 3"
              />
            </svg>
          )}

          {/* Moving marker — positioned by RAF loop at 60fps, not React state */}
          <div
            ref={focusMarkerRef}
            style={{
              position: 'absolute', zIndex: 7, pointerEvents: 'none',
              transform: 'translate(-50%, -50%)',
              display: 'none', // RAF shows/hides
            }}
          >
            <div style={{ position: 'absolute', width: 28, height: 28, borderRadius: '50%', border: '1.5px solid rgba(167,139,250,0.95)', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', boxShadow: '0 0 8px rgba(0,0,0,0.7), 0 0 4px rgba(167,139,250,0.4)' }} />
            <div style={{ position: 'absolute', width: 5, height: 5, borderRadius: '50%', background: 'rgba(167,139,250,1)', top: '50%', left: '50%', transform: 'translate(-50%,-50%)' }} />
            <div style={{ position: 'absolute', width: 1, height: 16, background: 'rgba(167,139,250,0.9)', top: '50%', left: '50%', transform: 'translate(-50%,-50%)' }} />
            <div style={{ position: 'absolute', width: 16, height: 1, background: 'rgba(167,139,250,0.9)', top: '50%', left: '50%', transform: 'translate(-50%,-50%)' }} />
          </div>

          {/* Editable control points — draggable dots at each recorded keyframe */}
          {focusKeyframes && onFocusKeyframeMove && focusKeyframes.map((kf, idx) => (
            <div
              key={idx}
              style={{
                position: 'absolute', zIndex: 9,
                left: `${kf.x * 100}%`, top: `${kf.y * 100}%`,
                transform: 'translate(-50%,-50%)',
                width: 10, height: 10, borderRadius: '50%',
                background: 'rgba(167,139,250,0.7)',
                border: '1.5px solid rgba(255,255,255,0.7)',
                cursor: 'grab', touchAction: 'none',
              }}
              onPointerDown={e => {
                e.stopPropagation()
                e.currentTarget.setPointerCapture(e.pointerId)
                const rect = (stageRef.current ?? monitorRef.current!).getBoundingClientRect()
                const onMove = (me: PointerEvent) => {
                  onFocusKeyframeMove(idx,
                    Math.max(0, Math.min(1, (me.clientX - rect.left) / rect.width)),
                    Math.max(0, Math.min(1, (me.clientY - rect.top) / rect.height)),
                  )
                }
                const onUp = () => {
                  e.currentTarget.removeEventListener('pointermove', onMove)
                  e.currentTarget.removeEventListener('pointerup', onUp)
                }
                e.currentTarget.addEventListener('pointermove', onMove)
                e.currentTarget.addEventListener('pointerup', onUp)
              }}
            />
          ))}
        </>)}

        {/* Focus pointer capture for recording — behind editable points (zIndex 8 < 9) */}
        {onSetFocusPoint && (
          <div
            style={{
              position: 'absolute', inset: 0, zIndex: 8,
              cursor: isRecordingFocus ? 'crosshair' : 'default',
            }}
            onPointerDown={e => {
              // Don't start recording if clicking a keyframe control point
              if ((e.target as HTMLElement) !== e.currentTarget) return
              e.currentTarget.setPointerCapture(e.pointerId)
              focusPointerDownRef.current = true
              const rect = e.currentTarget.getBoundingClientRect()
              const x = (e.clientX - rect.left) / rect.width
              const y = (e.clientY - rect.top) / rect.height
              const pos = { x, y }
              setFocusLivePos(pos); focusLivePosRef.current = pos
              onFocusRecordStart?.()
              onSetFocusPoint(x, y)
            }}
            onPointerMove={e => {
              if (!focusPointerDownRef.current) return
              const rect = e.currentTarget.getBoundingClientRect()
              const x = (e.clientX - rect.left) / rect.width
              const y = (e.clientY - rect.top) / rect.height
              const pos = { x, y }
              setFocusLivePos(pos); focusLivePosRef.current = pos
              onSetFocusPoint(x, y)
            }}
            onPointerUp={() => {
              focusPointerDownRef.current = false
              setFocusLivePos(null); focusLivePosRef.current = null
              onFocusRecordEnd?.()
            }}
          />
        )}

        {/* ── Move / uniform-resize gizmo for the selected media clip ──────
            Writes the clip's cropX/cropY/cropZoom via onGizmoChange. Only
            renders for media clips (not title/musicviz/drawfocus). */}
        {gizmo && onGizmoChange && (() => {
          const clamp = (lo: number, hi: number, v: number) => Math.min(hi, Math.max(lo, v))
          const round2 = (v: number) => Math.round(v * 100) / 100
          // Box tracks the clip's on-screen transform (scale about center + pan).
          const boxTransform = `scale(${gizmo.cropZoom / 100}) translate(${gizmo.cropX}%, ${gizmo.cropY}%)`
          const startMove = (e: React.PointerEvent) => {
            const rect = stageRef.current?.getBoundingClientRect()
            if (!rect) return
            e.currentTarget.setPointerCapture(e.pointerId)
            gizmoDragRef.current = {
              mode: 'move',
              startX: e.clientX, startY: e.clientY,
              baseX: gizmo.cropX, baseY: gizmo.cropY,
              zoom: gizmo.cropZoom, rect,
            }
          }
          const startResize = (e: React.PointerEvent) => {
            e.stopPropagation()
            const rect = stageRef.current?.getBoundingClientRect()
            if (!rect) return
            const cx = rect.left + rect.width / 2
            const cy = rect.top + rect.height / 2
            const startDist = Math.hypot(e.clientX - cx, e.clientY - cy)
            if (startDist <= 4) return
            e.currentTarget.setPointerCapture(e.pointerId)
            gizmoDragRef.current = { mode: 'resize', cx, cy, startDist, baseZoom: gizmo.cropZoom }
          }
          // Edge-handle drag → adjusts the clip's inset crop. stopPropagation so it
          // doesn't also begin a move. Insets are fractions of the element box; the
          // box is drawn scaled by cropZoom/100, so a screen delta maps to an inset
          // delta of Δpx / ((cropZoom/100) * stageDim).
          const startCrop = (edge: 'l' | 't' | 'r' | 'b') => (e: React.PointerEvent) => {
            e.stopPropagation()
            const rect = stageRef.current?.getBoundingClientRect()
            if (!rect) return
            e.currentTarget.setPointerCapture(e.pointerId)
            const base = gizmo.crop ?? { l: 0, t: 0, r: 0, b: 0 }
            gizmoDragRef.current = {
              mode: 'crop', edge,
              startX: e.clientX, startY: e.clientY,
              base: { ...base }, zoom: gizmo.cropZoom, rect,
            }
          }
          // Snapping: frame edges (0,1), center (0.5), quarters (0.25,0.75).
          // Hold Option/Alt to bypass. Move snaps the element's edges+center to
          // these frame lines; crop snaps the dragged inset to a frame line;
          // resize snaps the scale to round stops.
          const FRAME_LINES = [0, 0.25, 0.5, 0.75, 1]
          const SNAP_PX = 8
          const ZOOM_STOPS = [100, 125, 150, 200, 250, 300, 350, 400]
          // Snap one pan axis: return the cropX/Y that lands the nearest element
          // anchor (center / left|top edge / right|bottom edge) on a frame line,
          // plus the frame fraction to draw a guide at. null = no snap in range.
          const snapPan = (crop: number, dim: number, z: number): { crop: number; frac: number } | null => {
            const span = z * dim / 2               // element half-extent, px
            const shift = (crop / 100) * z * dim    // element-center offset from frame center, px
            const anchors = [
              { pos: shift, kind: 'c' as const },
              { pos: shift - span, kind: 'l' as const },
              { pos: shift + span, kind: 'r' as const },
            ]
            let best: { crop: number; frac: number; dpx: number } | null = null
            for (const f of FRAME_LINES) {
              const linePx = (f - 0.5) * dim
              for (const a of anchors) {
                const dpx = Math.abs(a.pos - linePx)
                if (dpx > SNAP_PX || (best && dpx >= best.dpx)) continue
                const targetShift = a.kind === 'c' ? linePx : a.kind === 'l' ? linePx + span : linePx - span
                best = { crop: clamp(-50, 50, (targetShift / (z * dim)) * 100), frac: f, dpx }
              }
            }
            return best ? { crop: best.crop, frac: best.frac } : null
          }
          const onMove = (e: React.PointerEvent) => {
            const d = gizmoDragRef.current
            if (!d) return
            const noSnap = e.altKey
            if (d.mode === 'move') {
              const dxPx = e.clientX - d.startX
              const dyPx = e.clientY - d.startY
              let newX = clamp(-50, 50, d.baseX + (100 * dxPx) / ((d.zoom / 100) * d.rect.width))
              let newY = clamp(-50, 50, d.baseY + (100 * dyPx) / ((d.zoom / 100) * d.rect.height))
              const gx: number[] = [], gy: number[] = []
              if (!noSnap) {
                const z = d.zoom / 100
                const sx = snapPan(newX, d.rect.width, z)
                const sy = snapPan(newY, d.rect.height, z)
                if (sx) { newX = sx.crop; gx.push(sx.frac) }
                if (sy) { newY = sy.crop; gy.push(sy.frac) }
              }
              setSnapGuides({ x: gx, y: gy })
              onGizmoChange({ cropX: round2(newX), cropY: round2(newY) })
            } else if (d.mode === 'resize') {
              const dist = Math.hypot(e.clientX - d.cx, e.clientY - d.cy)
              let newZoom = clamp(100, 400, d.baseZoom * (dist / d.startDist))
              if (!noSnap) {
                for (const s of ZOOM_STOPS) { if (Math.abs(newZoom - s) <= 6) { newZoom = s; break } }
              }
              if (snapGuides.x.length || snapGuides.y.length) setSnapGuides({ x: [], y: [] })
              onGizmoChange({ cropZoom: round2(newZoom) })
            } else {
              const zf = d.zoom / 100
              const dxF = (e.clientX - d.startX) / (zf * d.rect.width)
              const dyF = (e.clientY - d.startY) / (zf * d.rect.height)
              // Snap a dragged inset to a frame line (edge 0, quarter 0.25).
              const snapInset = (v: number) => {
                if (noSnap) return v
                for (const s of [0, 0.25]) { if (Math.abs(v - s) <= 0.025) return s }
                return v
              }
              let { l, t, r, b } = d.base
              if (d.edge === 'l') l = snapInset(clamp(0, 0.45, d.base.l + dxF))
              if (d.edge === 'r') r = snapInset(clamp(0, 0.45, d.base.r - dxF))
              if (d.edge === 't') t = snapInset(clamp(0, 0.45, d.base.t + dyF))
              if (d.edge === 'b') b = snapInset(clamp(0, 0.45, d.base.b - dyF))
              if (l + r > 0.9) { if (d.edge === 'l') l = 0.9 - r; else r = 0.9 - l }
              if (t + b > 0.9) { if (d.edge === 't') t = 0.9 - b; else b = 0.9 - t }
              // Guide on the cropped edge's frame fraction (left = l, right = 1-r, …).
              const gx: number[] = [], gy: number[] = []
              if (!noSnap) {
                if (d.edge === 'l' && [0, 0.25].includes(l)) gx.push(l)
                if (d.edge === 'r' && [0, 0.25].includes(r)) gx.push(1 - r)
                if (d.edge === 't' && [0, 0.25].includes(t)) gy.push(t)
                if (d.edge === 'b' && [0, 0.25].includes(b)) gy.push(1 - b)
              }
              setSnapGuides({ x: gx, y: gy })
              onGizmoChange({ crop: { l: round2(l), t: round2(t), r: round2(r), b: round2(b) } })
            }
          }
          const endDrag = (e: React.PointerEvent) => {
            if (gizmoDragRef.current) {
              try { e.currentTarget.releasePointerCapture(e.pointerId) } catch {}
              gizmoDragRef.current = null
              setSnapGuides({ x: [], y: [] })
            }
          }
          const handle = (corner: 'nw' | 'ne' | 'sw' | 'se'): React.CSSProperties => {
            const size = 11
            const pos: React.CSSProperties = { position: 'absolute' }
            if (corner === 'nw') { pos.top = -size / 2; pos.left = -size / 2 }
            if (corner === 'ne') { pos.top = -size / 2; pos.right = -size / 2 }
            if (corner === 'sw') { pos.bottom = -size / 2; pos.left = -size / 2 }
            if (corner === 'se') { pos.bottom = -size / 2; pos.right = -size / 2 }
            return {
              ...pos,
              width: size, height: size,
              background: 'var(--accent)',
              border: '1px solid rgba(255,255,255,0.85)',
              borderRadius: 2,
              pointerEvents: 'auto',
              cursor: corner === 'nw' || corner === 'se' ? 'nwse-resize' : 'nesw-resize',
              touchAction: 'none',
            }
          }
          // Edge (crop) handle — an accent bar at the midpoint of each side,
          // inset by the current crop so it sits on the cropped edge.
          const cr = gizmo.crop ?? { l: 0, t: 0, r: 0, b: 0 }
          const cropped = !!(cr.l || cr.t || cr.r || cr.b)
          const edgeHandle = (edge: 'l' | 't' | 'r' | 'b'): React.CSSProperties => {
            const thick = 4, long = 22
            const base: React.CSSProperties = {
              position: 'absolute',
              background: 'var(--accent)',
              border: '1px solid rgba(255,255,255,0.85)',
              borderRadius: 2,
              pointerEvents: 'auto',
              touchAction: 'none',
            }
            if (edge === 'l') return { ...base, left: `${cr.l * 100}%`, top: '50%', transform: 'translate(-50%,-50%)', width: thick, height: long, cursor: 'ew-resize' }
            if (edge === 'r') return { ...base, right: `${cr.r * 100}%`, top: '50%', transform: 'translate(50%,-50%)', width: thick, height: long, cursor: 'ew-resize' }
            if (edge === 't') return { ...base, top: `${cr.t * 100}%`, left: '50%', transform: 'translate(-50%,-50%)', width: long, height: thick, cursor: 'ns-resize' }
            return { ...base, bottom: `${cr.b * 100}%`, left: '50%', transform: 'translate(-50%,50%)', width: long, height: thick, cursor: 'ns-resize' }
          }
          return (
            <div style={{ position: 'absolute', inset: 0, zIndex: 9, pointerEvents: 'none' }}>
              {/* Snap guides — frame edge/center/quarter lines the drag locked to */}
              {snapGuides.x.map((f, i) => (
                <div key={`gx${i}`} style={{ position: 'absolute', left: `${f * 100}%`, top: 0, bottom: 0, width: 1, transform: 'translateX(-0.5px)', background: 'var(--accent)', boxShadow: '0 0 5px var(--accent)', opacity: 0.9 }} />
              ))}
              {snapGuides.y.map((f, i) => (
                <div key={`gy${i}`} style={{ position: 'absolute', top: `${f * 100}%`, left: 0, right: 0, height: 1, transform: 'translateY(-0.5px)', background: 'var(--accent)', boxShadow: '0 0 5px var(--accent)', opacity: 0.9 }} />
              ))}
              <div
                style={{
                  position: 'absolute', inset: 0,
                  transform: boxTransform, transformOrigin: 'center',
                  border: '1.5px solid var(--accent)',
                  boxSizing: 'border-box',
                  pointerEvents: 'auto',
                  cursor: 'move',
                  touchAction: 'none',
                }}
                onPointerDown={startMove}
                onPointerMove={onMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
              >
                {(['nw', 'ne', 'sw', 'se'] as const).map(c => (
                  <div
                    key={c}
                    style={handle(c)}
                    onPointerDown={startResize}
                    onPointerMove={onMove}
                    onPointerUp={endDrag}
                    onPointerCancel={endDrag}
                  />
                ))}
                {/* Crop-region outline — dashed inner box on the cropped edges */}
                {cropped && (
                  <div style={{
                    position: 'absolute',
                    left: `${cr.l * 100}%`, top: `${cr.t * 100}%`,
                    right: `${cr.r * 100}%`, bottom: `${cr.b * 100}%`,
                    border: '1px dashed rgba(255,255,255,0.7)',
                    boxSizing: 'border-box',
                    pointerEvents: 'none',
                  }} />
                )}
                {/* Edge (crop) handles — drag to inset each edge */}
                {(['l', 't', 'r', 'b'] as const).map(edge => (
                  <div
                    key={edge}
                    style={edgeHandle(edge)}
                    onPointerDown={startCrop(edge)}
                    onPointerMove={onMove}
                    onPointerUp={endDrag}
                    onPointerCancel={endDrag}
                  />
                ))}
              </div>
            </div>
          )
        })()}

        {/* Video overlays (labels, captions) */}
        {src && contentType === 'video' && (
          <div className="absolute inset-0 z-10 pointer-events-none">
            {clipLabel && (
              <div className="absolute top-2 left-2 px-2 py-0.5 rounded text-xs font-medium" style={{ background: 'rgba(0,0,0,0.6)', color: 'rgba(255,255,255,0.55)', backdropFilter: 'blur(4px)' }}>
                {clipLabel}
              </div>
            )}
            {activeCaption && (() => {
              const st = captionStyle
              const fs = Math.max(10, Math.round(stage.height * 0.028 * (st.size || 1)))
              const kWords = st.karaoke ? captionWords(activeCaption) : []
              const karaoke = kWords.length > 0
              const posStyle: React.CSSProperties =
                st.position === 'top'    ? { top: '8%', transform: 'translateX(-50%)' } :
                st.position === 'center' ? { top: '50%', transform: 'translate(-50%, -50%)' } :
                                           { bottom: '8%', transform: 'translateX(-50%)' }
              return (
                <div
                  className="absolute left-1/2 rounded text-center"
                  style={{
                    ...posStyle,
                    maxWidth: '90%',
                    padding: '8px 16px',
                    fontSize: fs,
                    fontWeight: 500,
                    lineHeight: 1.25,
                    background: st.bg !== 'none' ? st.bg : undefined,
                    color: st.color,
                    textShadow: '0 1px 2px rgba(0,0,0,0.8)',
                    backdropFilter: st.bg !== 'none' ? 'blur(4px)' : undefined,
                  }}
                >
                  {karaoke
                    ? kWords.map((w, i) => {
                        const active = karaokeT >= w.s && karaokeT <= w.e
                        const past = karaokeT > w.e
                        return (
                          <span key={i} style={{
                            color: active ? st.highlightColor : st.color,
                            opacity: active || past ? 1 : 0.55,
                            marginRight: '0.28em',
                          }}>{w.w}</span>
                        )
                      })
                    : <>
                        {activeCaption.speaker && <span className="font-semibold mr-1.5" style={{ color: 'var(--accent-light)', fontSize: Math.round(fs * 0.8) }}>{activeCaption.speaker}</span>}
                        {activeCaption.text}
                      </>}
                </div>
              )
            })()}
          </div>
        )}

          </div>{/* /stage */}
        </div>{/* /zoom wrapper */}

        {/* Audio mode overlay */}
        {src && contentType === 'audio' && (
          <div className="relative z-10 flex flex-col items-center gap-6 select-none px-8 w-full max-w-sm">
            <div className="w-24 h-24 rounded-3xl flex items-center justify-center" style={{ background: 'rgb(var(--accent-rgb) / 0.08)', border: '1px solid rgb(var(--accent-rgb) / 0.15)' }}>
              <Mic size={40} color="rgb(var(--accent-rgb) / 0.6)" />
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
              <div className="w-full text-center px-4 py-3 rounded-xl" style={{ background: 'rgb(var(--accent-rgb) / 0.06)', border: '1px solid rgb(var(--accent-rgb) / 0.15)' }}>
                {activeCaption.speaker && <span className="text-xs font-semibold mr-1.5" style={{ color: 'var(--accent-light)' }}>{activeCaption.speaker}:</span>}
                <span className="text-sm" style={{ color: 'var(--text-primary)' }}>{activeCaption.text}</span>
              </div>
            )}
          </div>
        )}

        {/* VU Meter — left side so right-side toolbars stay clear */}
        {showVUMeter && !perfMode && (
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
              style={{ color: 'var(--text-muted)', padding: 4, borderRadius: 6, display: 'flex', cursor: 'pointer', background: 'none', border: 'none' }}
              title="Zoom in"
            >
              <ZoomIn size={13} />
            </button>
            <span style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'monospace', lineHeight: 1 }}>{viewerZoom}×</span>
            <button
              tabIndex={-1}
              onClick={() => onViewerZoomChange(Math.max(0.25, Math.round((viewerZoom - 0.25) * 100) / 100))}
              style={{ color: 'var(--text-muted)', padding: 4, borderRadius: 6, display: 'flex', cursor: 'pointer', background: 'none', border: 'none' }}
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
            style={{ color: 'var(--text-muted)', padding: 4, borderRadius: 6, display: 'flex', cursor: 'pointer', background: 'none', border: 'none' }}
            title="Return to start (Home)"
          >
            <SkipBack size={13} />
          </button>
          <button
            tabIndex={-1}
            className={isPlaying ? 'transport-live' : undefined}
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
        style={{ height: 28, background: 'var(--bg-base)', borderTop: '1px solid var(--border)' }}
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
            style={{ fontSize: 13, color: 'var(--text-primary)', letterSpacing: '0.12em', width: 120 }}
          />
        ) : (
          <span
            className="font-mono tracking-widest select-none cursor-text"
            style={{ fontSize: 13, color: 'var(--text-primary)', letterSpacing: '0.12em' }}
            title="Click to jump to timecode"
            onClick={handleTimecodeClick}
          >
            {formatTimecode(currentTime)}
          </span>
        )}
        <span className="font-mono" style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.08em' }}>
          {activeEl?.duration ? `/ ${formatTimecode(activeEl.duration + timeOffset)}` : ''}
        </span>
      </div>

    </div>
  )
}
