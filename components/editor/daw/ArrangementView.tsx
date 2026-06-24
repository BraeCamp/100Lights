'use client'

import { useState, useRef, useEffect } from 'react'
import { ZoomIn, ZoomOut, Maximize2, Plus } from 'lucide-react'
import { useDaw, extractPeaks, makeAudioClip, makeMidiClip } from '@/lib/daw-state'
import type { DawTrack, DawClip, AudioClip, AutomationLane } from '@/lib/daw-types'
import { isAudioClip, isMidiClip } from '@/lib/daw-types'
import { libraryGetAll } from '@/lib/sound-library'
import Waveform from './Waveform'
import dynamic from 'next/dynamic'

const AutomationLaneView = dynamic(() => import('./AutomationLaneView'), { ssr: false })

const HDR_W      = 200
const RULER_H    = 28
const MIN_BEAT_W = 10
const MAX_BEAT_W = 200
const AUTO_H     = 60

type SnapMode = 'off' | 'beat' | 'half' | 'bar'

function snapBeat(beat: number, mode: SnapMode): number {
  if (mode === 'off')  return beat
  if (mode === 'bar')  return Math.round(beat / 4) * 4
  if (mode === 'beat') return Math.round(beat)
  return Math.round(beat * 2) / 2
}

// ── Ruler ─────────────────────────────────────────────────────────────────────

function Ruler({ beatW, scrollLeft, onSeek }: {
  beatW: number; scrollLeft: number; onSeek: (beat: number) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const { project } = useDaw()

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
    ctx.fillStyle = '#1a1a1a'
    ctx.fillRect(0, 0, W, H)

    const firstBeat = Math.floor(scrollLeft / beatW)
    const lastBeat  = Math.ceil((scrollLeft + W) / beatW)
    for (let b = firstBeat; b <= lastBeat; b++) {
      const x = b * beatW - scrollLeft
      const isBar = b % 4 === 0
      ctx.fillStyle = isBar ? '#555' : '#333'
      ctx.fillRect(x, H - (isBar ? 14 : 6), 1, isBar ? 14 : 6)
      if (isBar && beatW >= 20) {
        ctx.fillStyle = '#666'
        ctx.font = '9px monospace'
        ctx.fillText(String(Math.floor(b / 4) + 1), x + 2, H - 16)
      }
    }
  })

  const loopL = project.loopStart * beatW - scrollLeft
  const loopR = project.loopEnd   * beatW - scrollLeft

  return (
    <div style={{ position: 'relative', height: RULER_H, overflow: 'hidden', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
      <canvas
        ref={canvasRef}
        style={{ position: 'absolute', inset: 0, width: '100%', height: RULER_H, cursor: 'pointer' }}
        onClick={e => {
          const rect = e.currentTarget.getBoundingClientRect()
          onSeek(Math.max(0, (e.clientX - rect.left + scrollLeft) / beatW))
        }}
      />
      {project.loopEnabled && (
        <div style={{ position: 'absolute', top: 0, left: loopL, width: loopR - loopL, height: '100%', background: 'rgba(61,143,239,0.15)', pointerEvents: 'none', borderLeft: '1px solid rgba(61,143,239,0.5)', borderRight: '1px solid rgba(61,143,239,0.5)' }} />
      )}
    </div>
  )
}

// ── Clip view ─────────────────────────────────────────────────────────────────

function ClipView({ clip, track, beatW, selected, onSelect, onDoubleClick, onMove, onResize, onDelete }: {
  clip: DawClip; track: DawTrack; beatW: number; selected: boolean
  onSelect(): void; onDoubleClick(): void
  onMove(startBeat: number, trackId: string): void
  onResize(durationBeats: number): void; onDelete(): void
}) {
  const dragRef   = useRef<{ startX: number; startBeat: number } | null>(null)
  const resizeRef = useRef<{ startX: number; startDur: number } | null>(null)
  const [ctxPos, setCtxPos] = useState<{ x: number; y: number } | null>(null)

  const left  = clip.startBeat * beatW
  const width = Math.max(8, clip.durationBeats * beatW)
  const color = track.color

  function onMouseDownBody(e: React.MouseEvent) {
    if (e.button !== 0) return
    e.stopPropagation(); onSelect()
    dragRef.current = { startX: e.clientX, startBeat: clip.startBeat }
    function mm(ev: MouseEvent) {
      if (!dragRef.current) return
      onMove(Math.max(0, dragRef.current.startBeat + (ev.clientX - dragRef.current.startX) / beatW), track.id)
    }
    function mu() { dragRef.current = null; document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu) }
    document.addEventListener('mousemove', mm); document.addEventListener('mouseup', mu)
  }

  function onMouseDownResize(e: React.MouseEvent) {
    e.stopPropagation()
    resizeRef.current = { startX: e.clientX, startDur: clip.durationBeats }
    function mm(ev: MouseEvent) {
      if (!resizeRef.current) return
      onResize(Math.max(0.25, resizeRef.current.startDur + (ev.clientX - resizeRef.current.startX) / beatW))
    }
    function mu() { resizeRef.current = null; document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu) }
    document.addEventListener('mousemove', mm); document.addEventListener('mouseup', mu)
  }

  return (
    <>
      <div
        style={{ position: 'absolute', left, width, top: 4, bottom: 4, background: `${color}40`, border: `1px solid ${selected ? '#fff' : color}`, borderRadius: 3, overflow: 'hidden', cursor: 'grab', userSelect: 'none', boxSizing: 'border-box' }}
        onMouseDown={onMouseDownBody}
        onDoubleClick={onDoubleClick}
        onContextMenu={e => { e.preventDefault(); e.stopPropagation(); setCtxPos({ x: e.clientX, y: e.clientY }) }}
      >
        {isAudioClip(clip) && clip.waveformPeaks && clip.waveformPeaks.length > 0 && (
          <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', opacity: 0.7 }}>
            <Waveform peaks={clip.waveformPeaks} color={color} width={width} height={56} />
          </div>
        )}
        {isMidiClip(clip) && clip.notes.length > 0 && (
          <div style={{ position: 'absolute', inset: 0 }}>
            {clip.notes.map(n => {
              const nx = (n.startBeat / clip.durationBeats) * width
              const nw = Math.max(2, (n.durationBeats / clip.durationBeats) * width)
              const ny = ((127 - n.pitch) / 127) * 52
              return <div key={n.id} style={{ position: 'absolute', left: nx, top: ny + 2, width: nw, height: 2, background: color, borderRadius: 1 }} />
            })}
          </div>
        )}
        <div style={{ position: 'absolute', top: 2, left: 4, right: 8, fontSize: 9, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', pointerEvents: 'none' }}>
          {clip.name}
        </div>
        <div onMouseDown={onMouseDownResize} style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 6, cursor: 'ew-resize' }} />
      </div>

      {ctxPos && (
        <div style={{ position: 'fixed', zIndex: 1000, left: ctxPos.x, top: ctxPos.y, background: '#2a2a2a', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 0', minWidth: 140, boxShadow: '0 4px 20px rgba(0,0,0,0.5)' }} onMouseLeave={() => setCtxPos(null)}>
          {[{ label: 'Delete', fn: onDelete }, { label: 'Open Piano Roll', fn: onDoubleClick }].map(it => (
            <button key={it.label} onClick={() => { it.fn(); setCtxPos(null) }}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '5px 12px', fontSize: 11, cursor: 'pointer', background: 'transparent', border: 'none', color: 'var(--text-primary)' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
            >{it.label}</button>
          ))}
        </div>
      )}
    </>
  )
}

// ── Add-automation button ─────────────────────────────────────────────────────

function AddAutoButton({ track }: { track: DawTrack }) {
  const { project, dispatch } = useDaw()
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)

  const existing = new Set(project.automationLanes.filter(l => l.trackId === track.id).map(l => l.parameter))

  const opts: { label: string; parameter: string; min: number; max: number; def: number }[] = [
    { label: 'Volume', parameter: 'volume', min: 0, max: 1, def: track.volume },
    { label: 'Pan',    parameter: 'pan',    min: -1, max: 1, def: track.pan },
    ...track.effects.map(e => ({ label: `${e.type.toUpperCase()} Wet`, parameter: `fx:${e.id}:wet`, min: 0, max: 1, def: 0.5 })),
  ].filter(o => !existing.has(o.parameter))

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (btnRef.current && !btnRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  if (opts.length === 0) return null

  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      <button
        ref={btnRef}
        onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', gap: 2, padding: '1px 4px', fontSize: 9, background: 'transparent', border: '1px solid var(--border)', borderRadius: 3, color: 'var(--text-muted)', cursor: 'pointer' }}
        title="Add automation lane"
      ><Plus size={8} /> A</button>
      {open && (
        <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 300, background: '#2a2a2a', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 0', minWidth: 130, boxShadow: '0 4px 16px rgba(0,0,0,0.6)' }}>
          {opts.map(o => (
            <button key={o.parameter} onClick={() => {
              dispatch({ type: 'ADD_AUTOMATION_LANE', lane: { id: crypto.randomUUID(), trackId: track.id, parameter: o.parameter, label: o.label, min: o.min, max: o.max, defaultValue: o.def, points: [], expanded: true } })
              setOpen(false)
            }}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '5px 12px', fontSize: 11, background: 'transparent', border: 'none', color: 'var(--text-primary)', cursor: 'pointer' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
            >{o.label}</button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Automation lane header ─────────────────────────────────────────────────────

function AutoLaneHeader({ lane, track }: { lane: AutomationLane; track: DawTrack }) {
  const { dispatch } = useDaw()
  return (
    <div style={{ width: HDR_W, height: AUTO_H, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 4, padding: '0 8px', background: '#181818', borderRight: '1px solid var(--border)', borderBottom: '1px solid var(--border)', borderLeft: `3px solid ${track.color}55`, boxSizing: 'border-box' }}>
      <div style={{ flex: 1, fontSize: 10, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {lane.label}
      </div>
      <button onClick={() => dispatch({ type: 'CLEAR_AUTOMATION_LANE', laneId: lane.id })} title="Clear" style={{ width: 16, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: '1px solid var(--border)', borderRadius: 2, color: 'var(--text-muted)', cursor: 'pointer', fontSize: 9, padding: 0, flexShrink: 0 }}>⌫</button>
      <button onClick={() => dispatch({ type: 'REMOVE_AUTOMATION_LANE', laneId: lane.id })} title="Remove lane" style={{ width: 16, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: '1px solid var(--border)', borderRadius: 2, color: 'var(--text-muted)', cursor: 'pointer', fontSize: 11, padding: 0, flexShrink: 0 }}>×</button>
    </div>
  )
}

// ── Track row (combined header + lane + auto lanes) ───────────────────────────

function TrackRow({ track, beatW, scrollLeft, viewWidth, snap }: {
  track: DawTrack; beatW: number; scrollLeft: number; viewWidth: number; snap: SnapMode
}) {
  const { project, dispatch, engine, setEditTarget, setSelectedClipId, selectedClipId } = useDaw()
  const clips = project.arrangementClips.filter(c => c.trackId === track.id)
  const autoLanes = project.automationLanes.filter(l => l.trackId === track.id)
  const dragHRef = useRef<{ startY: number; startH: number } | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(track.name)

  const viewStartBeat = scrollLeft / beatW
  const viewEndBeat   = (scrollLeft + viewWidth) / beatW
  const visibleClips  = clips.filter(c => c.startBeat + c.durationBeats >= viewStartBeat && c.startBeat <= viewEndBeat)

  async function handleDrop(e: React.DragEvent) {
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

  async function handleDoubleClick(e: React.MouseEvent) {
    const rect  = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const beatX = (e.clientX - rect.left + scrollLeft) / beatW
    if (track.type === 'audio') {
      const input = document.createElement('input'); input.type = 'file'; input.accept = 'audio/*'
      input.onchange = async () => {
        const file = input.files?.[0]; if (!file) return
        const url  = URL.createObjectURL(file)
        const clip = makeAudioClip(track.id, file.name.replace(/\.[^.]+$/, ''), snapBeat(beatX, snap), 8, { audioUrl: url })
        dispatch({ type: 'ADD_CLIP', clip })
        const ab = await file.arrayBuffer()
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

  return (
    <div>
      {/* Main track row */}
      <div style={{ display: 'flex', height: track.height, flexShrink: 0 }}>
        {/* Header */}
        <div style={{ width: HDR_W, height: track.height, flexShrink: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 4, padding: '4px 8px', background: 'var(--bg-card)', borderRight: '1px solid var(--border)', borderBottom: '1px solid var(--border)', borderLeft: `3px solid ${track.color}`, boxSizing: 'border-box', overflow: 'hidden' }}>
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
          <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
            <button onClick={() => dispatch({ type: 'UPDATE_TRACK', trackId: track.id, patch: { mute: !track.mute } })}
              style={{ fontSize: 8, width: 16, height: 14, borderRadius: 2, border: '1px solid var(--border)', background: track.mute ? '#d97706' : 'var(--bg-surface)', color: track.mute ? '#fff' : 'var(--text-muted)', cursor: 'pointer', fontWeight: 700, padding: 0 }}>M</button>
            <button onClick={() => dispatch({ type: 'UPDATE_TRACK', trackId: track.id, patch: { solo: !track.solo } })}
              style={{ fontSize: 8, width: 16, height: 14, borderRadius: 2, border: '1px solid var(--border)', background: track.solo ? '#eab308' : 'var(--bg-surface)', color: track.solo ? '#000' : 'var(--text-muted)', cursor: 'pointer', fontWeight: 700, padding: 0 }}>S</button>
            <input type="range" min={0} max={1} step={0.01} value={track.volume}
              onChange={e => { const v = parseFloat(e.target.value); dispatch({ type: 'UPDATE_TRACK', trackId: track.id, patch: { volume: v } }); engine.setTrackVolume(track.id, v) }}
              onClick={e => e.stopPropagation()}
              className="cf-slider" style={{ flex: 1, accentColor: track.color, minWidth: 0 }} />
            <AddAutoButton track={track} />
          </div>
        </div>

        {/* Lane */}
        <div
          style={{ flex: 1, height: track.height, position: 'relative', background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)', overflow: 'hidden' }}
          onDoubleClick={handleDoubleClick}
          onDragOver={e => e.preventDefault()}
          onDrop={handleDrop}
        >
          {Array.from({ length: Math.ceil(viewWidth / beatW / 4) + 1 }, (_, i) => {
            const x = i * 4 * beatW - scrollLeft
            return x >= 0 && x <= viewWidth + 4 ? (
              <div key={i} style={{ position: 'absolute', left: x, top: 0, bottom: 0, width: 1, background: 'rgba(255,255,255,0.04)', pointerEvents: 'none' }} />
            ) : null
          })}
          {/* Scrolled clip container — clips positioned at clip.startBeat * beatW from beat 0 */}
          <div style={{ position: 'absolute', top: 0, bottom: 0, left: -scrollLeft, width: (viewEndBeat + 10) * beatW }}>
            {visibleClips.map(clip => (
              <ClipView
                key={clip.id}
                clip={clip}
                track={track} beatW={beatW}
                selected={selectedClipId === clip.id}
                onSelect={() => setSelectedClipId(clip.id)}
                onDoubleClick={() => setEditTarget({ type: clip.kind === 'midi' ? 'midi-clip' : 'audio-clip', clipId: clip.id })}
                onMove={(sb, tid) => dispatch({ type: 'MOVE_CLIP', clipId: clip.id, startBeat: snapBeat(sb, snap), trackId: tid })}
                onResize={db => dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: { durationBeats: db } })}
                onDelete={() => dispatch({ type: 'REMOVE_CLIP', clipId: clip.id })}
              />
            ))}
          </div>
          {/* Height resize handle */}
          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 4, cursor: 'ns-resize', zIndex: 2 }}
            onMouseDown={e => {
              dragHRef.current = { startY: e.clientY, startH: track.height }
              function mm(ev: MouseEvent) { if (!dragHRef.current) return; dispatch({ type: 'UPDATE_TRACK', trackId: track.id, patch: { height: Math.max(32, dragHRef.current.startH + ev.clientY - dragHRef.current.startY) } }) }
              function mu() { dragHRef.current = null; document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu) }
              document.addEventListener('mousemove', mm); document.addEventListener('mouseup', mu)
            }}
          />
        </div>
      </div>

      {/* Automation lane rows */}
      {autoLanes.map(lane => (
        <div key={lane.id} style={{ display: 'flex', height: AUTO_H, flexShrink: 0 }}>
          <AutoLaneHeader lane={lane} track={track} />
          <div style={{ flex: 1, height: AUTO_H, overflow: 'hidden', borderBottom: '1px solid var(--border)', background: '#1a1a1a' }}>
            <AutomationLaneView
              lane={lane}
              beatWidth={beatW}
              viewStartBeat={scrollLeft / beatW}
              height={AUTO_H}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Arrangement View ──────────────────────────────────────────────────────────

export default function ArrangementView() {
  const { project, dispatch, engine, setPosition } = useDaw()
  const [beatW, setBeatW]           = useState(40)
  const [scrollLeft, setScrollLeft] = useState(0)
  const [snap, setSnap]             = useState<SnapMode>('beat')
  const outerRef   = useRef<HTMLDivElement>(null)
  const laneRef    = useRef<HTMLDivElement>(null)
  const playheadRef = useRef<HTMLDivElement>(null)
  const rafRef      = useRef<number | undefined>(undefined)
  const [viewWidth, setViewWidth] = useState(800)

  useEffect(() => {
    const ro = new ResizeObserver(entries => setViewWidth(entries[0].contentRect.width - HDR_W))
    if (outerRef.current) ro.observe(outerRef.current)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    function frame() {
      const el = playheadRef.current
      if (el) el.style.left = `${HDR_W + engine.currentBeat * beatW - scrollLeft}px`
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
    setBeatW(Math.max(MIN_BEAT_W, viewWidth / maxBeat))
    setScrollLeft(0)
  }

  return (
    <div ref={outerRef} style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-base)', overflow: 'hidden' }}>

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

      {/* Ruler row (ruler area only — headers handled inside TrackRow) */}
      <div style={{ display: 'flex', flexShrink: 0 }} onWheel={handleWheel}>
        <div style={{ width: HDR_W, height: RULER_H, flexShrink: 0, background: 'var(--bg-surface)', borderRight: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }} />
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <Ruler beatW={beatW} scrollLeft={scrollLeft} onSeek={b => { engine.seek(b); setPosition(b) }} />
        </div>
      </div>

      {/* Track rows (scrollable) */}
      <div
        ref={laneRef}
        style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', position: 'relative' }}
        onWheel={handleWheel}
      >
        {project.tracks.map(track => (
          <TrackRow
            key={track.id}
            track={track}
            beatW={beatW}
            scrollLeft={scrollLeft}
            viewWidth={viewWidth}
            snap={snap}
          />
        ))}

        {/* Add track buttons */}
        <div style={{ display: 'flex', height: 36 }}>
          <div style={{ width: HDR_W, flexShrink: 0, display: 'flex', gap: 4, padding: 8, borderRight: '1px solid var(--border)' }}>
            {(['audio', 'midi', 'drum'] as const).map(type => (
              <button key={type} onClick={() => dispatch({ type: 'ADD_TRACK', trackType: type })}
                style={{ flex: 1, padding: '3px 0', fontSize: 9, borderRadius: 3, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-muted)', cursor: 'pointer' }}>
                +{type[0].toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Global playhead overlay */}
      <div
        ref={playheadRef}
        style={{ position: 'absolute', top: 30 + RULER_H, bottom: 0, width: 1, background: '#ef4444', pointerEvents: 'none', zIndex: 10 }}
      />
    </div>
  )
}

const toolBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  width: 26, height: 22, borderRadius: 3, border: '1px solid transparent',
  background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer',
}
