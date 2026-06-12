'use client'

import { useEffect, useLayoutEffect, useRef, useMemo, useState } from 'react'
import { Play, Pause, SkipBack, Mic, Film } from 'lucide-react'
import type { Caption, ContentType } from '@/lib/types'
import type { VideoAdjustments } from '@/lib/editor-types'

// How many seconds before a clip boundary to start pre-playing the hidden video.
// The hidden decoder runs live so no seek stall occurs at the actual transition.
const PREPLAY_LEAD = 0.5

const WAVEFORM = [30, 55, 80, 45, 70, 90, 60, 40, 75, 85, 50, 65, 95, 70, 45, 80, 60, 35, 70, 90, 55, 80, 65, 40, 75, 95, 50, 65, 80, 55, 70, 40]

interface ClipHint {
  inPoint: number   // where in the source file this clip starts
  startTime: number // when on the timeline this clip starts
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
  /** All known media URLs — kept buffered in the pool to eliminate clip-switch lag */
  preloadSrcs?: string[]
  /**
   * Per-URL hint describing when + where the clip transitions.
   * Used to pre-play the next clip's hidden decoder before the boundary.
   */
  seekHints?: Record<string, ClipHint>
}

function buildFilter(adj?: VideoAdjustments): string {
  if (!adj) return 'none'
  const parts: string[] = []
  if (adj.brightness !== 100) parts.push(`brightness(${adj.brightness / 100})`)
  if (adj.contrast !== 100)   parts.push(`contrast(${adj.contrast / 100})`)
  if (adj.saturation !== 100) parts.push(`saturate(${adj.saturation / 100})`)
  if (adj.highlights !== 0)   parts.push(`brightness(${1 + adj.highlights / 200})`)
  return parts.length ? parts.join(' ') : 'none'
}

export default function VideoPlayer({
  src, contentType, captions, currentTime, timeOffset, isPlaying,
  adjustments, onTimeUpdate, onPlay, onPause, onMediaError, videoRef, clipLabel,
  preloadSrcs = [], seekHints = {},
}: Props) {
  // ── Video pool ──────────────────────────────────────────────
  // One <video> per unique URL lives in the DOM permanently.
  // Clip switching = toggling visibility, never changing src → no reload delay.
  const poolRef = useRef<Map<string, HTMLVideoElement>>(new Map())

  // visibleSrc: URL that is actually painted on screen.
  // Trails `src` by at most one animation frame so we never show a stale frame.
  const [visibleSrc, setVisibleSrc] = useState<string | null>(null)

  const allSrcs = useMemo(() => {
    const s = new Set(preloadSrcs)
    if (src) s.add(src)
    return Array.from(s)
  }, [src, preloadSrcs])

  // Keep videoRef.current pointing at the active pool element.
  useLayoutEffect(() => {
    const el = src ? (poolRef.current.get(src) ?? null) : null
    ;(videoRef as React.MutableRefObject<HTMLVideoElement | null>).current = el
  })

  // Stable refs so effects that fire only on `src` change can still read current values.
  const timeOffsetRef  = useRef(timeOffset)
  const currentTimeRef = useRef(currentTime)
  const isPlayingRef   = useRef(isPlaying)
  useEffect(() => { timeOffsetRef.current  = timeOffset  }, [timeOffset])
  useEffect(() => { currentTimeRef.current = currentTime }, [currentTime])
  useEffect(() => { isPlayingRef.current   = isPlaying   }, [isPlaying])

  // ── Src change: reveal only after frame is ready ────────────
  // Keeps the old clip visible until the new one has decoded its first frame,
  // preventing the black-flash between clips.
  const prevSrcRef = useRef<string | null>(null)

  useEffect(() => {
    if (src === prevSrcRef.current) return
    prevSrcRef.current = src

    if (!src) { setVisibleSrc(null); return }

    const video = poolRef.current.get(src)
    if (!video) { setVisibleSrc(src); return }

    const clipTime = Math.max(0, currentTimeRef.current - timeOffsetRef.current)

    // If pre-play already ran, the video is at (or very near) the right frame.
    // Reveal immediately — no seek, no wait.
    if (Math.abs(video.currentTime - clipTime) <= 0.12) {
      setVisibleSrc(src)
      return
    }

    // Otherwise seek first, reveal when frame is ready.
    setVisibleSrc(null)
    video.currentTime = clipTime

    const reveal = () => setVisibleSrc(src)

    // requestVideoFrameCallback fires after the compositor actually has the frame —
    // more reliable than 'seeked' (which can fire one render cycle too early).
    if (typeof (video as any).requestVideoFrameCallback === 'function') {
      const id = (video as any).requestVideoFrameCallback(reveal)
      const fallback = setTimeout(reveal, 200)
      return () => {
        (video as any).cancelVideoFrameCallback?.(id)
        clearTimeout(fallback)
      }
    }

    video.addEventListener('seeked', reveal, { once: true })
    const fallback = setTimeout(reveal, 200)
    return () => {
      video.removeEventListener('seeked', reveal)
      clearTimeout(fallback)
    }
  }, [src]) // eslint-disable-line — intentionally only on src change

  // ── Drift correction (light-touch) ──────────────────────────
  // Only re-seeks if the active video drifts more than 0.5s from the timeline.
  // Does NOT fire on every currentTime tick to avoid thrashing the decoder.
  useEffect(() => {
    const video = src ? poolRef.current.get(src) : null
    if (!video) return
    const clipTime = Math.max(0, currentTime - timeOffset)
    if (Math.abs(video.currentTime - clipTime) > 0.5) {
      video.currentTime = clipTime
    }
  }, [currentTime, timeOffset, src]) // eslint-disable-line

  // ── Play / pause sync ────────────────────────────────────────
  useEffect(() => {
    for (const [s, el] of poolRef.current) {
      if (s === src) {
        if (isPlaying) el.play().catch(() => {})
        else           el.pause()
      } else {
        // Non-active videos are paused here; the pre-play effect below
        // will override this for the upcoming clip when needed.
        el.pause()
      }
    }
  }, [src, isPlaying]) // eslint-disable-line

  // ── Pre-play engine ──────────────────────────────────────────
  // This is the core of seamless transitions (analogous to DaVinci's background
  // decoder / FCP's pre-roll buffer):
  //
  //  • When the playhead is within PREPLAY_LEAD seconds of a clip boundary,
  //    start the next clip's hidden <video> playing from the exact position it
  //    needs to be at when it becomes active.
  //  • At the transition, the decoder has been running in real-time so the frame
  //    is already decoded and in GPU memory → reveal is instant (≈ one vsync).
  //  • For clips where inPoint < PREPLAY_LEAD (can't start before 0), fall back
  //    to a pre-seek so at least the keyframe is decoded.
  useEffect(() => {
    if (!isPlaying) return  // no pre-play while paused — it would desync

    for (const [url, hint] of Object.entries(seekHints)) {
      if (url === src) continue
      const video = poolRef.current.get(url)
      if (!video) continue

      const timeUntilTransition = hint.startTime - currentTime

      if (timeUntilTransition <= PREPLAY_LEAD && timeUntilTransition > -0.1) {
        // We're inside the pre-play window.
        if (hint.inPoint >= PREPLAY_LEAD) {
          // Ideal case: enough inPoint headroom to start the decoder in-flight.
          // Seek to the position the clip will be at when we transition.
          const targetPos = hint.inPoint - timeUntilTransition
          if (video.paused || Math.abs(video.currentTime - targetPos) > 0.15) {
            video.currentTime = Math.max(0, targetPos)
            video.play().catch(() => {})
          }
        } else {
          // inPoint is near 0: just seek to the start and let the decoder run.
          // Not perfectly in-sync but at least the first keyframe is warm.
          if (Math.abs(video.currentTime - hint.inPoint) > 0.08) {
            video.currentTime = hint.inPoint
          }
          if (video.paused) video.play().catch(() => {})
        }
      } else if (timeUntilTransition > PREPLAY_LEAD) {
        // Not near the transition yet — park the video at inPoint (pre-seek).
        if (video.readyState >= 1 && Math.abs(video.currentTime - hint.inPoint) > 0.08) {
          video.currentTime = hint.inPoint
        }
        if (!video.paused) video.pause()
      }
    }
  }, [seekHints, currentTime, isPlaying, src]) // eslint-disable-line

  const activeCaption = captions.find(c => currentTime >= c.start && currentTime <= c.end) ?? null

  function setPoolRef(s: string, el: HTMLVideoElement | null) {
    if (el) poolRef.current.set(s, el)
  }

  const activeEl = src ? poolRef.current.get(src) : null

  return (
    <div className="flex flex-col h-full" style={{ background: '#0a0a0a' }}>

      {/* ── Monitor ──────────────────────────────────────────────── */}
      <div className="relative flex-1 flex items-center justify-center overflow-hidden" style={{ background: '#000' }}>

        {/* Empty monitor placeholder */}
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

        {/* Pool — one <video> per URL; opacity-only switching keeps GPU compositor
            layer active so the reveal is a single vsync compositor op, not a repaint. */}
        {allSrcs.map(s => (
          <video
            key={s}
            ref={el => setPoolRef(s, el)}
            src={s}
            preload="auto"
            playsInline
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'contain',
              filter: s === src ? buildFilter(adjustments) : 'none',
              // opacity-only (no visibility:hidden) — keeps the GPU compositor layer
              // alive so switching is a zero-cost layer-tree op.
              opacity: s === visibleSrc && contentType === 'video' ? 1 : 0,
              pointerEvents: 'none',
              zIndex: s === visibleSrc ? 1 : 0,
            }}
            onTimeUpdate={e => {
              if (s === src) onTimeUpdate(e.currentTarget.currentTime + timeOffset)
            }}
            onPlay={() => { if (s === src) onPlay() }}
            onPause={() => { if (s === src) onPause() }}
            onEnded={() => { if (s === src) onPause() }}
            onError={() => { if (s === src) onMediaError?.() }}
          />
        ))}

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

        {/* Video overlays */}
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
      </div>

      {/* ── Timecode strip ───────────────────────────────────────── */}
      <div
        className="flex items-center justify-between px-4 shrink-0"
        style={{ height: 28, background: '#0d0d0d', borderTop: '1px solid #1a1a1a' }}
      >
        <span
          className="font-mono tracking-widest select-none"
          style={{ fontSize: 13, color: '#d0d0d0', letterSpacing: '0.12em' }}
          title="Timecode (HH:MM:SS:FF @ 24fps)"
        >
          {formatTimecode(currentTime)}
        </span>
        <span className="font-mono" style={{ fontSize: 10, color: '#3a3a3a', letterSpacing: '0.08em' }}>
          {activeEl?.duration ? `/ ${formatTimecode(activeEl.duration + timeOffset)}` : ''}
        </span>
      </div>

      {/* ── Transport bar ────────────────────────────────────────── */}
      {/* Always enabled — playhead advances even on an empty timeline */}
      <div className="flex items-center gap-3 px-4 py-2 shrink-0" style={{ borderTop: '1px solid #1e1e1e', background: '#111' }}>
        <button
          onClick={() => {
            if (activeEl) activeEl.currentTime = 0
            onTimeUpdate(timeOffset)
          }}
          className="p-1.5 rounded"
          style={{ color: '#666' }}
          title="Return to start (Home)"
        >
          <SkipBack size={14} />
        </button>
        <button
          onClick={() => isPlaying ? onPause() : onPlay()}
          className="w-8 h-8 rounded-lg flex items-center justify-center"
          style={{ background: 'var(--accent)' }}
          title={isPlaying ? 'Pause (K / Space)' : 'Play (L / Space)'}
        >
          {isPlaying
            ? <Pause size={14} color="#fff" />
            : <Play  size={14} color="#fff" />}
        </button>
        <div className="flex-1 h-1 rounded-full overflow-hidden" style={{ background: '#222' }}>
          <div
            className="h-full rounded-full"
            style={{
              width: activeEl?.duration
                ? `${Math.min(100, ((currentTime - timeOffset) / activeEl.duration) * 100)}%`
                : '0%',
              background: 'var(--accent)',
              transition: 'width 0.1s linear',
            }}
          />
        </div>
        <span className="text-xs font-mono shrink-0" style={{ color: '#333', fontSize: 9 }}>J·K·L</span>
      </div>
    </div>
  )
}

function formatTimecode(s: number, fps = 24): string {
  const t   = Math.max(0, s)
  const h   = Math.floor(t / 3600)
  const m   = Math.floor((t % 3600) / 60)
  const sec = Math.floor(t % 60)
  const f   = Math.floor((t % 1) * fps)
  const p   = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${p(h)}:${p(m)}:${p(sec)}:${p(f)}`
}
