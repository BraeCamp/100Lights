'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { Plus, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react'
import { useDaw, extractPeaks, makeAudioClip, makeMidiClip } from '@/lib/daw-state'
import type { DawTrack, DawClip, AudioClip, MidiClip } from '@/lib/daw-types'
import { isAudioClip, isMidiClip } from '@/lib/daw-types'
import { libraryGetAll } from '@/lib/sound-library'
import Waveform from './Waveform'

const HDR_W      = 200
const RULER_H    = 28
const MIN_BEAT_W = 10
const MAX_BEAT_W = 200

type SnapMode = 'off' | 'beat' | 'half' | 'bar'

function snapBeat(beat: number, mode: SnapMode): number {
  if (mode === 'off') return beat
  if (mode === 'bar')  return Math.round(beat / 4) * 4
  if (mode === 'beat') return Math.round(beat)
  return Math.round(beat * 2) / 2
}

// ── Ruler canvas ──────────────────────────────────────────────────────────────

function Ruler({ beatW, scrollLeft, totalBeats, onSeek }: {
  beatW: number
  scrollLeft: number
  totalBeats: number
  onSeek: (beat: number) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const { engine, project } = useDaw()
  const playheadRef = useRef<HTMLDivElement>(null)
  const rafRef      = useRef<number | undefined>(undefined)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    const W   = canvas.offsetWidth
    const H   = RULER_H
    canvas.width  = W * dpr
    canvas.height = H * dpr
    const ctx = canvas.getContext('2d')!
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, W, H)
    ctx.fillStyle = '#1a1a1a'
    ctx.fillRect(0, 0, W, H)

    const firstBeat = Math.floor(scrollLeft / beatW)
    const lastBeat  = Math.ceil((scrollLeft + W) / beatW)

    for (let b = firstBeat; b <= lastBeat; b++) {
      const x = b * beatW - scrollLeft
      const isBar = b % 4 === 0
      const barNum = Math.floor(b / 4) + 1
      const tickH  = isBar ? 14 : 6

      ctx.fillStyle = isBar ? '#555' : '#333'
      ctx.fillRect(x, H - tickH, 1, tickH)

      if (isBar && beatW >= 20) {
        ctx.fillStyle = '#666'
        ctx.font = '9px monospace'
        ctx.fillText(String(barNum), x + 2, H - tickH - 1)
      }
    }
  })

  // Playhead animation
  useEffect(() => {
    function frame() {
      const el = playheadRef.current
      if (el) {
        const x = engine.currentBeat * beatW - scrollLeft
        el.style.left = `${x}px`
      }
      rafRef.current = requestAnimationFrame(frame)
    }
    rafRef.current = requestAnimationFrame(frame)
    return () => { if (rafRef.current !== undefined) cancelAnimationFrame(rafRef.current) }
  }, [engine, beatW, scrollLeft])

  function handleClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const x    = e.clientX - rect.left + scrollLeft
    onSeek(Math.max(0, x / beatW))
  }

  // Loop region
  const loopStartX = project.loopStart * beatW - scrollLeft
  const loopEndX   = project.loopEnd   * beatW - scrollLeft

  return (
    <div style={{ position: 'relative', height: RULER_H, overflow: 'hidden', flexShrink: 0, borderBottom: '1px solid var(--border)' }}>
      <canvas
        ref={canvasRef}
        style={{ position: 'absolute', inset: 0, width: '100%', height: RULER_H, cursor: 'pointer' }}
        onClick={handleClick}
      />
      {/* Loop region */}
      {project.loopEnabled && (
        <div style={{
          position: 'absolute', top: 0, left: loopStartX, width: loopEndX - loopStartX,
          height: '100%', background: 'rgba(61,143,239,0.15)', pointerEvents: 'none',
          borderLeft: '1px solid rgba(61,143,239,0.5)', borderRight: '1px solid rgba(61,143,239,0.5)',
        }} />
      )}
      {/* Playhead */}
      <div
        ref={playheadRef}
        style={{ position: 'absolute', top: 0, width: 1, height: '100%', background: '#ef4444', pointerEvents: 'none' }}
      />
    </div>
  )
}

// ── Clip view ─────────────────────────────────────────────────────────────────

function ClipView({ clip, track, beatW, selected, onSelect, onDoubleClick, onMove, onResize, onDelete }: {
  clip: DawClip
  track: DawTrack
  beatW: number
  selected: boolean
  onSelect: () => void
  onDoubleClick: () => void
  onMove: (startBeat: number, trackId: string) => void
  onResize: (durationBeats: number) => void
  onDelete: () => void
}) {
  const dragRef    = useRef<{ startX: number; startBeat: number } | null>(null)
  const resizeRef  = useRef<{ startX: number; startDur: number } | null>(null)
  const [ctx, setCtx] = useState<{ x: number; y: number } | null>(null)

  const left  = clip.startBeat * beatW
  const width = Math.max(8, clip.durationBeats * beatW)
  const color = track.color
  const isAudio = isAudioClip(clip)

  function onMouseDownBody(e: React.MouseEvent) {
    if (e.button !== 0) return
    e.stopPropagation()
    onSelect()
    dragRef.current = { startX: e.clientX, startBeat: clip.startBeat }
    function onMove2(ev: MouseEvent) {
      if (!dragRef.current) return
      const delta = (ev.clientX - dragRef.current.startX) / beatW
      onMove(Math.max(0, dragRef.current.startBeat + delta), track.id)
    }
    function onUp() {
      dragRef.current = null
      document.removeEventListener('mousemove', onMove2)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove2)
    document.addEventListener('mouseup', onUp)
  }

  function onMouseDownResizeHandle(e: React.MouseEvent) {
    e.stopPropagation()
    resizeRef.current = { startX: e.clientX, startDur: clip.durationBeats }
    function onMove2(ev: MouseEvent) {
      if (!resizeRef.current) return
      const delta = (ev.clientX - resizeRef.current.startX) / beatW
      onResize(Math.max(0.25, resizeRef.current.startDur + delta))
    }
    function onUp() {
      resizeRef.current = null
      document.removeEventListener('mousemove', onMove2)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove2)
    document.addEventListener('mouseup', onUp)
  }

  return (
    <>
      <div
        style={{
          position: 'absolute',
          left, width,
          top: 4, bottom: 4,
          background: `${color}40`,
          border: `1px solid ${selected ? '#fff' : color}`,
          borderRadius: 3,
          overflow: 'hidden',
          cursor: 'grab',
          userSelect: 'none',
          boxSizing: 'border-box',
        }}
        onMouseDown={onMouseDownBody}
        onDoubleClick={onDoubleClick}
        onContextMenu={e => { e.preventDefault(); e.stopPropagation(); setCtx({ x: e.clientX, y: e.clientY }) }}
      >
        {/* Waveform for audio clips */}
        {isAudio && clip.waveformPeaks && clip.waveformPeaks.length > 0 && (
          <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', opacity: 0.7 }}>
            <Waveform peaks={clip.waveformPeaks} color={color} width={width} height={56} />
          </div>
        )}
        {/* MIDI note preview */}
        {isMidiClip(clip) && clip.notes.length > 0 && (
          <div style={{ position: 'absolute', inset: 0 }}>
            {clip.notes.map(n => {
              const nx = (n.startBeat / clip.durationBeats) * width
              const nw = Math.max(2, (n.durationBeats / clip.durationBeats) * width)
              const ny = ((127 - n.pitch) / 127) * (56 - 4)
              return <div key={n.id} style={{ position: 'absolute', left: nx, top: ny + 2, width: nw, height: 2, background: color, borderRadius: 1 }} />
            })}
          </div>
        )}
        <div style={{ position: 'absolute', top: 2, left: 4, right: 8, fontSize: 9, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', pointerEvents: 'none' }}>
          {clip.name}
        </div>
        {/* Resize handle */}
        <div
          onMouseDown={onMouseDownResizeHandle}
          style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 6, cursor: 'ew-resize' }}
        />
      </div>

      {/* Context menu */}
      {ctx && (
        <div
          style={{ position: 'fixed', zIndex: 1000, left: ctx.x, top: ctx.y, background: '#2a2a2a', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 0', minWidth: 140, boxShadow: '0 4px 20px rgba(0,0,0,0.5)' }}
          onMouseLeave={() => setCtx(null)}
        >
          {[
            { label: 'Delete', action: onDelete },
            { label: 'Open in Piano Roll', action: onDoubleClick },
          ].map(it => (
            <button key={it.label} onClick={() => { it.action(); setCtx(null) }}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '5px 12px', fontSize: 11, cursor: 'pointer', background: 'transparent', border: 'none', color: 'var(--text-secondary)' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#333'; (e.currentTarget as HTMLElement).style.color = '#d4d4d4' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)' }}
            >{it.label}</button>
          ))}
        </div>
      )}
    </>
  )
}

// ── Track lane ────────────────────────────────────────────────────────────────

function TrackLane({ track, beatW, scrollLeft, viewWidth, snap, onHeightChange }: {
  track: DawTrack
  beatW: number
  scrollLeft: number
  viewWidth: number
  snap: SnapMode
  onHeightChange: (h: number) => void
}) {
  const { project, dispatch, engine, setEditTarget, setSelectedClipId, selectedClipId } = useDaw()
  const clips = project.arrangementClips.filter(c => c.trackId === track.id)
  const dragHeightRef = useRef<{ startY: number; startH: number } | null>(null)

  async function handleLaneDrop(e: React.DragEvent) {
    e.preventDefault()
    const rect  = e.currentTarget.getBoundingClientRect()
    const beatX = (e.clientX - rect.left + scrollLeft) / beatW
    const libId = e.dataTransfer.getData('application/x-library-entry-id')

    if (libId) {
      const entries = await libraryGetAll()
      const entry   = entries.find(en => en.id === libId)
      if (!entry) return
      const url  = URL.createObjectURL(entry.audioBlob)
      const clip = makeAudioClip(track.id, entry.name, snapBeat(beatX, snap), 8, { audioUrl: url })
      dispatch({ type: 'ADD_CLIP', clip })
      const buf = await engine.loadClipBuffer(clip)
      if (buf) {
        const peaks = extractPeaks(buf)
        const updated: AudioClip = { ...clip, waveformPeaks: peaks, durationBeats: engine.secondsToBeats(buf.duration) }
        dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: { waveformPeaks: peaks, durationBeats: updated.durationBeats } })
      }
    }
  }

  async function handleLaneDoubleClick(e: React.MouseEvent) {
    const rect  = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const beatX = (e.clientX - rect.left + scrollLeft) / beatW

    if (track.type === 'audio') {
      const input = document.createElement('input')
      input.type  = 'file'
      input.accept = 'audio/*'
      input.onchange = async () => {
        const file = input.files?.[0]
        if (!file) return
        const url  = URL.createObjectURL(file)
        const clip = makeAudioClip(track.id, file.name.replace(/\.[^.]+$/, ''), snapBeat(beatX, snap), 8, { audioUrl: url })
        dispatch({ type: 'ADD_CLIP', clip })
        const ab  = await file.arrayBuffer()
        const buf = await engine.loadBufferFromArrayBuffer(clip.id, ab)
        const peaks = extractPeaks(buf)
        const updated: AudioClip = { ...clip, waveformPeaks: peaks, durationBeats: engine.secondsToBeats(buf.duration) }
        dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: { waveformPeaks: peaks, durationBeats: updated.durationBeats } })
      }
      input.click()
    } else {
      const clip = makeMidiClip(track.id, 'MIDI Clip', snapBeat(beatX, snap), 4)
      dispatch({ type: 'ADD_CLIP', clip })
      setEditTarget({ type: 'midi-clip', clipId: clip.id })
    }
  }

  const visibleClips = clips.filter(c => {
    const clipStart = c.startBeat * beatW
    const clipEnd   = clipStart + c.durationBeats * beatW
    return clipEnd >= scrollLeft && clipStart <= scrollLeft + viewWidth
  })

  return (
    <div
      style={{
        height: track.height, flexShrink: 0, position: 'relative',
        background: 'var(--bg-surface)',
        borderBottom: '1px solid var(--border)',
        overflow: 'hidden',
      }}
      onDoubleClick={handleLaneDoubleClick}
      onDragOver={e => e.preventDefault()}
      onDrop={handleLaneDrop}
    >
      {/* Bar grid lines */}
      {Array.from({ length: Math.ceil(viewWidth / beatW / 4) + 1 }, (_, i) => {
        const barBeat = i * 4
        const x = barBeat * beatW - scrollLeft
        return x >= 0 && x <= viewWidth + 4 ? (
          <div key={i} style={{ position: 'absolute', left: x, top: 0, bottom: 0, width: 1, background: 'rgba(255,255,255,0.04)', pointerEvents: 'none' }} />
        ) : null
      })}

      {visibleClips.map(clip => (
        <div key={clip.id} style={{ position: 'absolute', inset: 0, left: -scrollLeft + clip.startBeat * beatW, pointerEvents: 'none' }}>
          <div style={{ position: 'relative', width: clip.durationBeats * beatW, height: '100%', pointerEvents: 'all' }}>
            <ClipView
              clip={clip}
              track={track}
              beatW={beatW}
              selected={selectedClipId === clip.id}
              onSelect={() => setSelectedClipId(clip.id)}
              onDoubleClick={() => setEditTarget({ type: clip.kind === 'midi' ? 'midi-clip' : 'audio-clip', clipId: clip.id })}
              onMove={(sb, tid) => dispatch({ type: 'MOVE_CLIP', clipId: clip.id, startBeat: snapBeat(sb, snap), trackId: tid })}
              onResize={db => dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: { durationBeats: db } })}
              onDelete={() => dispatch({ type: 'REMOVE_CLIP', clipId: clip.id })}
            />
          </div>
        </div>
      ))}

      {/* Height resize handle */}
      <div
        style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 4, cursor: 'ns-resize', zIndex: 2 }}
        onMouseDown={e => {
          dragHeightRef.current = { startY: e.clientY, startH: track.height }
          function onMove(ev: MouseEvent) {
            if (!dragHeightRef.current) return
            const h = Math.max(32, dragHeightRef.current.startH + ev.clientY - dragHeightRef.current.startY)
            onHeightChange(h)
          }
          function onUp() { dragHeightRef.current = null; document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
          document.addEventListener('mousemove', onMove)
          document.addEventListener('mouseup', onUp)
        }}
      />
    </div>
  )
}

// ── Track header (arrangement) ────────────────────────────────────────────────

function ArrTrackHeader({ track }: { track: DawTrack }) {
  const { dispatch, engine } = useDaw()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft]     = useState(track.name)

  return (
    <div style={{
      width: HDR_W, height: track.height, flexShrink: 0,
      display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 4, padding: '4px 8px',
      background: 'var(--bg-card)', borderRight: '1px solid var(--border)', borderBottom: '1px solid var(--border)',
      borderLeft: `3px solid ${track.color}`, boxSizing: 'border-box', overflow: 'hidden',
    }}>
      {editing ? (
        <input autoFocus value={draft} onChange={e => setDraft(e.target.value)}
          onBlur={() => { dispatch({ type: 'UPDATE_TRACK', trackId: track.id, patch: { name: draft } }); setEditing(false) }}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') { dispatch({ type: 'UPDATE_TRACK', trackId: track.id, patch: { name: draft } }); setEditing(false) } e.stopPropagation() }}
          style={{ fontSize: 11, background: '#111', border: '1px solid var(--accent)', color: 'var(--text-primary)', borderRadius: 3, padding: '1px 4px', outline: 'none' }}
        />
      ) : (
        <span onDoubleClick={() => { setEditing(true); setDraft(track.name) }} style={{ fontSize: 11, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', userSelect: 'none', cursor: 'default' }}>
          {track.name}
        </span>
      )}
      <div style={{ display: 'flex', gap: 2 }}>
        <button onClick={() => dispatch({ type: 'UPDATE_TRACK', trackId: track.id, patch: { mute: !track.mute } })}
          style={{ fontSize: 8, width: 16, height: 14, borderRadius: 2, border: '1px solid var(--border)', background: track.mute ? '#d97706' : 'var(--bg-surface)', color: track.mute ? '#fff' : 'var(--text-muted)', cursor: 'pointer', fontWeight: 700, padding: 0 }}>M</button>
        <button onClick={() => dispatch({ type: 'UPDATE_TRACK', trackId: track.id, patch: { solo: !track.solo } })}
          style={{ fontSize: 8, width: 16, height: 14, borderRadius: 2, border: '1px solid var(--border)', background: track.solo ? '#eab308' : 'var(--bg-surface)', color: track.solo ? '#000' : 'var(--text-muted)', cursor: 'pointer', fontWeight: 700, padding: 0 }}>S</button>
        <input type="range" min={0} max={1} step={0.01} value={track.volume}
          onChange={e => { const v = parseFloat(e.target.value); dispatch({ type: 'UPDATE_TRACK', trackId: track.id, patch: { volume: v } }); engine.setTrackVolume(track.id, v) }}
          className="cf-slider" style={{ flex: 1, accentColor: track.color, minWidth: 0 }} />
      </div>
    </div>
  )
}

// ── Arrangement View ──────────────────────────────────────────────────────────

export default function ArrangementView() {
  const { project, dispatch, engine, setPosition } = useDaw()
  const [beatW, setBeatW]           = useState(40)
  const [scrollLeft, setScrollLeft] = useState(0)
  const [snap, setSnap]             = useState<SnapMode>('beat')
  const containerRef = useRef<HTMLDivElement>(null)
  const [viewWidth, setViewWidth]   = useState(800)
  const playheadRef = useRef<HTMLDivElement>(null)
  const rafRef      = useRef<number | undefined>(undefined)

  useEffect(() => {
    const ro = new ResizeObserver(entries => { setViewWidth(entries[0].contentRect.width) })
    if (containerRef.current) ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [])

  // Playhead RAF
  useEffect(() => {
    function frame() {
      const el = playheadRef.current
      if (el) el.style.left = `${engine.currentBeat * beatW - scrollLeft}px`
      rafRef.current = requestAnimationFrame(frame)
    }
    rafRef.current = requestAnimationFrame(frame)
    return () => { if (rafRef.current !== undefined) cancelAnimationFrame(rafRef.current) }
  }, [engine, beatW, scrollLeft])

  function handleWheel(e: React.WheelEvent) {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault()
      setBeatW(w => Math.max(MIN_BEAT_W, Math.min(MAX_BEAT_W, w * (e.deltaY < 0 ? 1.15 : 0.87))))
    } else {
      setScrollLeft(s => Math.max(0, s + e.deltaX + e.deltaY * 0.5))
    }
  }

  function fitToWindow() {
    const maxBeat = project.arrangementClips.reduce((m, c) => Math.max(m, c.startBeat + c.durationBeats), 32)
    setBeatW(Math.max(MIN_BEAT_W, (viewWidth - HDR_W) / maxBeat))
    setScrollLeft(0)
  }

  const totalBeats = project.arrangementClips.reduce((m, c) => Math.max(m, c.startBeat + c.durationBeats), project.loopEnd + 16)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-base)', overflow: 'hidden' }}>
      {/* Toolbar */}
      <div style={{ height: 30, display: 'flex', alignItems: 'center', gap: 4, padding: '0 8px', background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <button onClick={() => setBeatW(w => Math.min(MAX_BEAT_W, w * 1.3))} style={toolBtn} title="Zoom in"><ZoomIn size={13} /></button>
        <button onClick={() => setBeatW(w => Math.max(MIN_BEAT_W, w * 0.77))} style={toolBtn} title="Zoom out"><ZoomOut size={13} /></button>
        <button onClick={fitToWindow} style={toolBtn} title="Fit to window"><Maximize2 size={13} /></button>
        <div style={{ width: 1, height: 16, background: 'var(--border)' }} />
        <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>SNAP</span>
        {(['off', 'beat', 'half', 'bar'] as SnapMode[]).map(m => (
          <button key={m} onClick={() => setSnap(m)}
            style={{ ...toolBtn, background: snap === m ? 'var(--bg-card)' : 'transparent', color: snap === m ? 'var(--text-primary)' : 'var(--text-muted)', border: snap === m ? '1px solid var(--border)' : '1px solid transparent', fontSize: 9, padding: '2px 6px' }}>
            {m.charAt(0).toUpperCase() + m.slice(1)}
          </button>
        ))}
      </div>

      {/* Main body */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {/* Left: track headers */}
        <div style={{ width: HDR_W, flexShrink: 0, display: 'flex', flexDirection: 'column', overflowY: 'hidden' }}>
          {/* Ruler placeholder */}
          <div style={{ height: RULER_H, background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)', borderRight: '1px solid var(--border)', flexShrink: 0 }} />
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {project.tracks.map(t => (
              <ArrTrackHeader key={t.id} track={t} />
            ))}
            {/* Add track */}
            <div style={{ padding: 8, display: 'flex', gap: 4, borderRight: '1px solid var(--border)' }}>
              {(['audio', 'midi', 'drum'] as const).map(type => (
                <button key={type} onClick={() => dispatch({ type: 'ADD_TRACK', trackType: type })}
                  style={{ flex: 1, padding: '3px 0', fontSize: 9, borderRadius: 3, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-muted)', cursor: 'pointer' }}>
                  +{type[0].toUpperCase()}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Right: timeline area */}
        <div
          ref={containerRef}
          style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}
          onWheel={handleWheel}
        >
          <Ruler beatW={beatW} scrollLeft={scrollLeft} totalBeats={totalBeats} onSeek={b => { engine.seek(b); setPosition(b) }} />

          {/* Track lanes */}
          <div
            style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', position: 'relative' }}
            onScroll={e => {}}
          >
            {project.tracks.map(t => (
              <TrackLane
                key={t.id}
                track={t}
                beatW={beatW}
                scrollLeft={scrollLeft}
                viewWidth={viewWidth}
                snap={snap}
                onHeightChange={h => dispatch({ type: 'UPDATE_TRACK', trackId: t.id, patch: { height: h } })}
              />
            ))}
          </div>

          {/* Global playhead overlay */}
          <div ref={playheadRef} style={{ position: 'absolute', top: 0, bottom: 0, width: 1, background: '#ef4444', pointerEvents: 'none', zIndex: 10 }} />
        </div>
      </div>
    </div>
  )
}

const toolBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  width: 26, height: 22, borderRadius: 3, border: '1px solid transparent',
  background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer',
}
