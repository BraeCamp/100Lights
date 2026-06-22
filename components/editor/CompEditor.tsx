'use client'

// ── Comp Editor ───────────────────────────────────────────────────────────────
//
// Panel for viewing and editing multiple loop-recorded takes.
// Waveform rows per take + a comp summary row showing which take is active at
// each moment. Drag to select regions; mutual-exclusion enforced across takes.

import { useRef, useEffect, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Play, Square, X } from 'lucide-react'
import type { CompGroup, Take } from '@/lib/comping'
import { applyCompSelection } from '@/lib/comping'

// ── Types ─────────────────────────────────────────────────────────────────────

interface ClipForComp {
  id: string
  buf: AudioBuffer
}

export interface CompEditorProps {
  group: CompGroup
  clips: ClipForComp[]
  onGroupChange: (group: CompGroup) => void
  onRenderComp: (group: CompGroup) => void
  onClose: () => void
}

// ── Layout constants ──────────────────────────────────────────────────────────

const HEADER_W  = 92   // label column width (px)
const ROW_H     = 62   // height of each take canvas row (px)
const COMP_ROW_H = 28  // height of comp summary row (px)
const RULER_H   = 22   // height of the timeline ruler (px)

// ── Ruler ─────────────────────────────────────────────────────────────────────

function CompRuler({
  loopDuration,
  loopStart,
  trackWidth,
}: {
  loopDuration: number
  loopStart: number
  trackWidth: number
}) {
  const steps = Math.max(2, Math.min(16, Math.floor(trackWidth / 64)))
  const stepDur = loopDuration / steps

  return (
    <div style={{
      display: 'flex', borderBottom: '1px solid var(--border)',
      background: 'var(--bg-card)', flexShrink: 0,
    }}>
      <div style={{ width: HEADER_W, flexShrink: 0 }} />
      <div style={{ position: 'relative', width: trackWidth, height: RULER_H, flexShrink: 0, overflow: 'hidden' }}>
        {Array.from({ length: steps + 1 }, (_, i) => {
          const t = i * stepDur
          const x = (t / loopDuration) * trackWidth
          const label = (loopStart + t).toFixed(2) + 's'
          return (
            <div key={i} style={{ position: 'absolute', left: x, top: 0, pointerEvents: 'none' }}>
              <div style={{ width: 1, height: 6, background: 'var(--border)', marginTop: 4, marginLeft: -0.5 }} />
              <span style={{
                display: 'block', fontSize: 9, color: 'var(--text-muted)',
                whiteSpace: 'nowrap', transform: 'translateX(-50%)',
                lineHeight: '10px', marginTop: 1,
              }}>
                {label}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Comp summary row ──────────────────────────────────────────────────────────

function CompRow({
  group,
  loopDuration,
  trackWidth,
}: {
  group: CompGroup
  loopDuration: number
  trackWidth: number
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    canvas.width  = trackWidth * dpr
    canvas.height = COMP_ROW_H * dpr
    ctx.scale(dpr, dpr)

    ctx.clearRect(0, 0, trackWidth, COMP_ROW_H)
    ctx.fillStyle = 'rgba(255,255,255,0.03)'
    ctx.fillRect(0, 0, trackWidth, COMP_ROW_H)

    for (const take of group.takes) {
      for (const region of take.regions) {
        if (!region.selected) continue
        const x0 = (region.startTime / loopDuration) * trackWidth
        const x1 = (region.endTime   / loopDuration) * trackWidth
        ctx.fillStyle = take.color
        ctx.fillRect(x0, 5, x1 - x0, COMP_ROW_H - 10)
      }
    }
  }, [group, loopDuration, trackWidth])

  return (
    <div style={{ display: 'flex', alignItems: 'center', borderTop: '1px solid var(--border)' }}>
      <div style={{
        width: HEADER_W, flexShrink: 0, padding: '0 10px',
        display: 'flex', alignItems: 'center',
      }}>
        <span style={{
          fontSize: 10, fontWeight: 700, color: 'var(--text-muted)',
          textTransform: 'uppercase', letterSpacing: '0.08em',
        }}>
          Comp
        </span>
      </div>
      <canvas
        ref={canvasRef}
        style={{ width: trackWidth, height: COMP_ROW_H, display: 'block', flexShrink: 0 }}
      />
    </div>
  )
}

// ── Take waveform row ─────────────────────────────────────────────────────────

interface TakeRowProps {
  take: Take
  clip: ClipForComp | undefined
  loopDuration: number
  trackWidth: number
  onRegionPaint: (takeId: string, start: number, end: number, selected: boolean) => void
  onPlayTake: (take: Take) => void
  isPlaying: boolean
}

function TakeRow({
  take,
  clip,
  loopDuration,
  trackWidth,
  onRegionPaint,
  onPlayTake,
  isPlaying,
}: TakeRowProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // ── Draw waveform ──────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !clip) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    canvas.width  = trackWidth * dpr
    canvas.height = ROW_H * dpr
    ctx.scale(dpr, dpr)

    const W = trackWidth
    const H = ROW_H
    const mid = H / 2
    const data = clip.buf.getChannelData(0)
    const spp  = data.length / W   // samples per pixel

    // Compute per-pixel peak amplitude
    const peaks = new Float32Array(W)
    for (let x = 0; x < W; x++) {
      const s = Math.floor(x * spp)
      const e = Math.min(data.length, Math.floor((x + 1) * spp))
      let peak = 0
      for (let i = s; i < e; i++) {
        const a = Math.abs(data[i])
        if (a > peak) peak = a
      }
      peaks[x] = peak
    }

    ctx.clearRect(0, 0, W, H)

    // 1. Full dim waveform (20% opacity)
    ctx.beginPath()
    ctx.strokeStyle = take.color + '38'  // ~22% opacity
    ctx.lineWidth = 1
    for (let x = 0; x < W; x++) {
      const h = peaks[x] * (mid - 3)
      ctx.moveTo(x + 0.5, mid - h)
      ctx.lineTo(x + 0.5, mid + h)
    }
    ctx.stroke()

    // 2. Selected region overlays (take color, 80% opacity waveform)
    for (const region of take.regions) {
      if (!region.selected) continue
      const x0 = Math.max(0, Math.floor((region.startTime / loopDuration) * W))
      const x1 = Math.min(W, Math.ceil((region.endTime   / loopDuration) * W))
      if (x1 <= x0) continue

      // Region background tint
      ctx.fillStyle = take.color + '28'  // ~16% opacity
      ctx.fillRect(x0, 0, x1 - x0, H)

      // Bright waveform inside region
      ctx.beginPath()
      ctx.strokeStyle = take.color + 'CC'  // ~80% opacity
      ctx.lineWidth = 1
      for (let x = x0; x < x1; x++) {
        const h = peaks[x] * (mid - 3)
        ctx.moveTo(x + 0.5, mid - h)
        ctx.lineTo(x + 0.5, mid + h)
      }
      ctx.stroke()

      // Boundary lines
      ctx.strokeStyle = take.color + '88'
      ctx.lineWidth = 1
      ctx.beginPath()
      if (x0 > 0)    { ctx.moveTo(x0 + 0.5, 0); ctx.lineTo(x0 + 0.5, H) }
      if (x1 < W)    { ctx.moveTo(x1 - 0.5, 0); ctx.lineTo(x1 - 0.5, H) }
      ctx.stroke()
    }
  }, [take, clip, loopDuration, trackWidth])

  // ── Mouse interaction ──────────────────────────────────────────────────────
  const dragRef = useRef<{ startT: number; painting: boolean } | null>(null)

  function xToTime(x: number): number {
    return Math.max(0, Math.min(loopDuration, (x / trackWidth) * loopDuration))
  }

  function handleMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    e.preventDefault()
    const rect = e.currentTarget.getBoundingClientRect()
    const t = xToTime(e.clientX - rect.left)

    // Determine if we're clicking on an already-selected region
    const onSelected = take.regions.some(r => r.selected && t >= r.startTime && t <= r.endTime)

    dragRef.current = { startT: t, painting: !onSelected }

    // If clicking a selected region with no drag — deselect it immediately
    if (onSelected) {
      onRegionPaint(take.id, 0, loopDuration, false)
    }

    function onMove(me: MouseEvent) {
      const d = dragRef.current
      if (!d) return
      const canvas = canvasRef.current
      if (!canvas) return
      const r = canvas.getBoundingClientRect()
      const curT = xToTime(me.clientX - r.left)
      const s  = Math.min(d.startT, curT)
      const en = Math.max(d.startT, curT)
      if (en - s > 0.005) {
        onRegionPaint(take.id, s, en, d.painting)
      }
    }

    function onUp() {
      dragRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center',
      borderBottom: '1px solid var(--border)',
    }}>
      {/* Label column */}
      <div style={{
        width: HEADER_W, flexShrink: 0, padding: '0 8px 0 12px',
        display: 'flex', alignItems: 'center', gap: 6,
      }}>
        <div style={{
          width: 8, height: 8, borderRadius: '50%',
          background: take.color, flexShrink: 0,
        }} />
        <span style={{
          fontSize: 11, fontWeight: 600, color: 'var(--text-primary)',
          flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          Take {take.index}
        </span>
        <button
          onClick={() => onPlayTake(take)}
          title={isPlaying ? 'Stop' : 'Preview take'}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: isPlaying ? take.color : 'var(--text-muted)',
            padding: 2, lineHeight: 1, display: 'flex', alignItems: 'center', flexShrink: 0,
          }}
        >
          {isPlaying ? <Square size={11} /> : <Play size={11} />}
        </button>
      </div>

      {/* Waveform canvas */}
      {clip ? (
        <canvas
          ref={canvasRef}
          style={{ width: trackWidth, height: ROW_H, display: 'block', cursor: 'crosshair', flexShrink: 0 }}
          onMouseDown={handleMouseDown}
        />
      ) : (
        <div style={{
          width: trackWidth, height: ROW_H, flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--text-muted)', fontSize: 11,
        }}>
          No audio
        </div>
      )}
    </div>
  )
}

// ── CompEditor ────────────────────────────────────────────────────────────────

export default function CompEditor({
  group,
  clips,
  onGroupChange,
  onRenderComp,
  onClose,
}: CompEditorProps) {
  const panelRef   = useRef<HTMLDivElement>(null)
  const [trackWidth, setTrackWidth] = useState(580)
  const loopDuration = group.loopEnd - group.loopStart

  // Measure panel width to set canvas size
  useEffect(() => {
    const el = panelRef.current
    if (!el) return
    const obs = new ResizeObserver(() => {
      const w = el.clientWidth - HEADER_W - 24
      setTrackWidth(Math.max(200, w))
    })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  // ── Audio playback ─────────────────────────────────────────────────────────
  const [playingTakeId, setPlayingTakeId] = useState<string | null>(null)
  const audioSrcRef = useRef<AudioBufferSourceNode | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)

  const stopAudio = useCallback(() => {
    try { audioSrcRef.current?.stop() } catch { /* already stopped */ }
    audioSrcRef.current = null
    setPlayingTakeId(null)
  }, [])

  function playTake(take: Take) {
    if (playingTakeId === take.id) { stopAudio(); return }
    stopAudio()
    const clip = clips.find(c => c.id === take.clipId)
    if (!clip) return
    if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
      audioCtxRef.current = new AudioContext()
    }
    const ctx = audioCtxRef.current
    const src = ctx.createBufferSource()
    src.buffer = clip.buf
    src.connect(ctx.destination)
    src.start()
    src.onended = () => { audioSrcRef.current = null; setPlayingTakeId(null) }
    audioSrcRef.current = src
    setPlayingTakeId(take.id)
  }

  // Cleanup on unmount
  useEffect(() => () => { stopAudio() }, [stopAudio])

  // ── Region edit handler ────────────────────────────────────────────────────
  function handleRegionPaint(
    takeId: string,
    start: number,
    end: number,
    selected: boolean,
  ) {
    const updated = applyCompSelection(group, takeId, start, end, selected)
    onGroupChange(updated)
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  const portal = (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 400,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.55)',
    }}>
      {/* Backdrop */}
      <div style={{ position: 'fixed', inset: 0 }} onClick={onClose} />

      {/* Panel */}
      <div
        ref={panelRef}
        style={{
          position: 'relative', zIndex: 1,
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          boxShadow: '0 24px 64px rgba(0,0,0,0.65)',
          width: 'min(92vw, 900px)',
          maxHeight: '82vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 14px 10px 16px',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}>
          <span style={{
            fontSize: 10, fontWeight: 800, color: 'var(--text-muted)',
            textTransform: 'uppercase', letterSpacing: '0.1em', flexShrink: 0,
          }}>
            Comp Editor
          </span>
          <span style={{ fontSize: 11, color: 'var(--text-secondary)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            — {group.laneType}
          </span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>
            {group.takes.length} take{group.takes.length !== 1 ? 's' : ''} · {loopDuration.toFixed(1)}s
          </span>
          <button
            onClick={() => { stopAudio(); onRenderComp(group) }}
            style={{
              padding: '5px 13px', borderRadius: 6, border: 'none',
              background: 'var(--accent)', color: '#fff',
              cursor: 'pointer', fontSize: 12, fontWeight: 600, flexShrink: 0,
            }}
          >
            Render Comp
          </button>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--text-muted)', padding: 4, lineHeight: 1,
              display: 'flex', alignItems: 'center', flexShrink: 0,
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* ── Scrollable body ───────────────────────────────────────────── */}
        <div style={{ overflowY: 'auto', flex: 1 }}>
          <CompRuler
            loopDuration={loopDuration}
            loopStart={group.loopStart}
            trackWidth={trackWidth}
          />

          {group.takes.map(take => (
            <TakeRow
              key={take.id}
              take={take}
              clip={clips.find(c => c.id === take.clipId)}
              loopDuration={loopDuration}
              trackWidth={trackWidth}
              onRegionPaint={handleRegionPaint}
              onPlayTake={playTake}
              isPlaying={playingTakeId === take.id}
            />
          ))}

          <CompRow
            group={group}
            loopDuration={loopDuration}
            trackWidth={trackWidth}
          />
        </div>

        {/* ── Footer hint ────────────────────────────────────────────────── */}
        <div style={{
          padding: '7px 16px',
          borderTop: '1px solid var(--border)',
          fontSize: 10, color: 'var(--text-muted)',
          flexShrink: 0,
        }}>
          Drag on a take to select a region · Click selected region to deselect · One take per time slot (mutex enforced)
        </div>
      </div>
    </div>
  )

  if (typeof document === 'undefined') return null
  return createPortal(portal, document.body)
}
