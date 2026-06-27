'use client'

import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { ZoomIn, ZoomOut, Maximize2 } from 'lucide-react'
import { useDaw, makeMidiClip } from '@/lib/daw-state'
import { isMidiClip } from '@/lib/daw-types'
import TrackRow, { HDR_W, SnapMode, snapBeat } from './TrackRow'

const SEC_H   = 24
const BAR_H   = 20
const RULER_H = SEC_H + BAR_H
const MIN_BEAT_W = 10
const MAX_BEAT_W = 200

// ── Ruler ─────────────────────────────────────────────────────────────────────

function Ruler({ beatW, scrollLeft, onSeek, onEditTimeSig, snap }: {
  beatW: number; scrollLeft: number; snap: SnapMode
  onSeek: (beat: number) => void
  onEditTimeSig: (e: React.MouseEvent) => void
}) {
  const canvasRef    = useRef<HTMLCanvasElement>(null)
  const loopDragRef  = useRef<{ type: 'start'|'end'|'move'; startX: number; startLoopStart: number; startLoopEnd: number } | null>(null)
  const [loopCursor, setLoopCursor] = useState('grab')
  const { project, dispatch } = useDaw()
  const { tempo, timeSignatureNum: sigNum, timeSignatureDen: sigDen, loopStart, loopEnd, loopEnabled } = project
  const pxPerSec = beatW * tempo / 60

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    const W   = canvas.offsetWidth
    canvas.width  = W * dpr
    canvas.height = RULER_H * dpr
    const ctx = canvas.getContext('2d')!
    ctx.scale(dpr, dpr)

    ctx.fillStyle = '#161616'
    ctx.fillRect(0, 0, W, RULER_H)
    ctx.fillStyle = '#252525'
    ctx.fillRect(0, SEC_H, W, 1)

    const INTERVALS = [0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60]
    const secInterval  = INTERVALS.find(iv => iv * pxPerSec >= 70) ?? 60
    const halfInterval = secInterval / 2
    const startTime    = scrollLeft / pxPerSec
    const endTime      = startTime + W / pxPerSec

    const firstHalfIdx = Math.floor(startTime / halfInterval)
    for (let i = firstHalfIdx; i * halfInterval <= endTime + halfInterval; i++) {
      if (i % 2 === 0) continue
      const x = Math.round(i * halfInterval * pxPerSec - scrollLeft)
      if (x < 0 || x > W) continue
      ctx.fillStyle = '#2d2d2d'
      ctx.fillRect(x, SEC_H - 5, 1, 5)
    }

    const firstMajorIdx = Math.floor(startTime / secInterval)
    for (let i = firstMajorIdx; i * secInterval <= endTime + secInterval; i++) {
      const t = i * secInterval
      const x = Math.round(t * pxPerSec - scrollLeft)
      if (x < -30 || x > W + 30) continue
      ctx.fillStyle = '#3d3d3d'
      ctx.fillRect(x, 2, 1, SEC_H - 3)
      const mins = Math.floor(t / 60)
      const secs = Math.floor(t % 60)
      ctx.fillStyle = '#ccc'
      ctx.font = '9px monospace'
      ctx.fillText(`${mins}:${String(secs).padStart(2, '0')}`, x + 3, 11)
    }

    const pxPerBar  = beatW * sigNum
    if (pxPerBar >= 6) {
      const firstBar   = Math.floor(scrollLeft / pxPerBar)
      const labelEvery = Math.max(1, Math.ceil(36 / pxPerBar))
      for (let bar = firstBar; bar * pxPerBar <= scrollLeft + W + pxPerBar; bar++) {
        const x = Math.round(bar * pxPerBar - scrollLeft)
        if (x >= -1 && x <= W + 1) {
          ctx.fillStyle = '#3a3a3a'
          ctx.fillRect(x, SEC_H + 1, 1, BAR_H - 1)
        }
        if (pxPerBar >= 24) {
          for (let b = 1; b < sigNum; b++) {
            const bx = Math.round(x + b * beatW)
            if (bx < 0 || bx > W) continue
            ctx.fillStyle = '#252525'
            ctx.fillRect(bx, SEC_H + BAR_H - 6, 1, 6)
          }
        }
        if (bar % labelEvery === 0 && x > -2 && x < W) {
          ctx.fillStyle = '#999'
          ctx.font = '9px monospace'
          ctx.fillText(String(bar + 1), x + 3, SEC_H + BAR_H - 4)
        }
      }
    }

    ctx.fillStyle = '#555'
    ctx.font = '8px monospace'
    ctx.textAlign = 'right'
    ctx.fillText(`${sigNum}/${sigDen} ✎`, W - 4, SEC_H + BAR_H - 4)
    ctx.textAlign = 'left'
  })

  const loopL = loopStart * beatW - scrollLeft
  const loopR = loopEnd   * beatW - scrollLeft

  return (
    <div style={{ position: 'relative', height: RULER_H, overflow: 'hidden', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
      <canvas
        ref={canvasRef}
        style={{ position: 'absolute', inset: 0, width: '100%', height: RULER_H, cursor: 'pointer' }}
        onClick={e => {
          const rect   = e.currentTarget.getBoundingClientRect()
          const localY = e.clientY - rect.top
          if (localY >= SEC_H) {
            onEditTimeSig(e)
          } else {
            onSeek(Math.max(0, (e.clientX - rect.left + scrollLeft) / beatW))
          }
        }}
      />
      {loopEnabled && loopR > loopL && (
        <div
          style={{
            position: 'absolute', top: 0, left: loopL, width: Math.max(4, loopR - loopL), height: SEC_H,
            background: 'rgba(61,143,239,0.18)', boxSizing: 'border-box',
            borderLeft: '2px solid rgba(61,143,239,0.7)', borderRight: '2px solid rgba(61,143,239,0.7)',
            cursor: loopCursor,
          }}
          onMouseMove={e => {
            if (loopDragRef.current) return
            const rect = e.currentTarget.getBoundingClientRect()
            const relX = e.clientX - rect.left
            setLoopCursor(relX < 8 || relX > rect.width - 8 ? 'ew-resize' : 'grab')
          }}
          onMouseLeave={() => { if (!loopDragRef.current) setLoopCursor('grab') }}
          onMouseDown={e => {
            e.stopPropagation()
            if (e.button !== 0) return
            const rect = e.currentTarget.getBoundingClientRect()
            const relX = e.clientX - rect.left
            const type = relX < 8 ? 'start' : relX > rect.width - 8 ? 'end' : 'move'
            loopDragRef.current = { type, startX: e.clientX, startLoopStart: loopStart, startLoopEnd: loopEnd }
            setLoopCursor(type === 'move' ? 'grabbing' : 'ew-resize')
            function mm(ev: MouseEvent) {
              if (!loopDragRef.current) return
              const { type: t, startX, startLoopStart: s, startLoopEnd: en } = loopDragRef.current
              const db      = (ev.clientX - startX) / beatW
              const useSnap = ev.altKey ? 'off' as SnapMode : snap
              const dur     = en - s
              let ns = s, ne = en
              if (t === 'start') {
                ns = Math.min(snapBeat(Math.max(0, s + db), useSnap, sigNum), en - 0.25)
              } else if (t === 'end') {
                ne = Math.max(snapBeat(en + db, useSnap, sigNum), s + 0.25)
              } else {
                ns = snapBeat(Math.max(0, s + db), useSnap, sigNum)
                ne = ns + dur
              }
              dispatch({ type: 'SET_LOOP', start: ns, end: ne })
            }
            function mu() {
              loopDragRef.current = null
              setLoopCursor('grab')
              document.removeEventListener('mousemove', mm)
              document.removeEventListener('mouseup', mu)
            }
            document.addEventListener('mousemove', mm)
            document.addEventListener('mouseup', mu)
          }}
        />
      )}
    </div>
  )
}

// ── Arrangement View ──────────────────────────────────────────────────────────

export default function ArrangementView() {
  const { project, dispatch, engine, setPosition, selectedClipId, selectedTrackId, expandedPianoRollClipId, setExpandedPianoRollClipId, onSave, isSaving } = useDaw()
  const [beatW, setBeatW]           = useState(40)
  const [scrollLeft, setScrollLeft] = useState(0)
  const [snap, setSnap]             = useState<SnapMode>('1/16')
  const [tsPopover, setTsPopover]   = useState<{ x: number; y: number } | null>(null)
  const [tsDraftNum, setTsDraftNum] = useState(project.timeSignatureNum)
  const [tsDraftDen, setTsDraftDen] = useState(project.timeSignatureDen)
  const outerRef    = useRef<HTMLDivElement>(null)
  const laneRef     = useRef<HTMLDivElement>(null)
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
      if (el) el.style.left = `${engine.currentBeat * beatW - scrollLeft}px`
      rafRef.current = requestAnimationFrame(frame)
    }
    rafRef.current = requestAnimationFrame(frame)
    return () => { if (rafRef.current !== undefined) cancelAnimationFrame(rafRef.current) }
  }, [engine, beatW, scrollLeft])

  const tsPopoverRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!tsPopover) return
    function onDown(e: MouseEvent) {
      if (tsPopoverRef.current && !tsPopoverRef.current.contains(e.target as Node)) setTsPopover(null)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [tsPopover])

  function handleEditTimeSig(e: React.MouseEvent) {
    setTsDraftNum(project.timeSignatureNum)
    setTsDraftDen(project.timeSignatureDen)
    setTsPopover({ x: e.clientX, y: e.clientY })
  }

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

  function openPianoRoll() {
    // If a MIDI clip is selected, toggle its inline piano roll
    if (selectedClipId) {
      const clip = project.arrangementClips.find(c => c.id === selectedClipId)
      if (clip && isMidiClip(clip)) {
        setExpandedPianoRollClipId(expandedPianoRollClipId === clip.id ? null : clip.id)
        return
      }
    }
    // Find any MIDI clip on selected track
    if (selectedTrackId) {
      const track = project.tracks.find(t => t.id === selectedTrackId)
      if (track && track.type !== 'drum') {
        const existing = project.arrangementClips.find(c => isMidiClip(c) && c.trackId === selectedTrackId)
        if (existing) {
          setExpandedPianoRollClipId(expandedPianoRollClipId === existing.id ? null : existing.id)
          return
        }
        // Create a new MIDI clip and immediately expand its piano roll
        const newClip = makeMidiClip(selectedTrackId, 'MIDI', engine.currentBeat, 4)
        dispatch({ type: 'ADD_CLIP', clip: newClip })
        setExpandedPianoRollClipId(newClip.id)
        return
      }
    }
    // Toggle off if already open
    if (expandedPianoRollClipId) { setExpandedPianoRollClipId(null); return }
  }

  return (
    <div ref={outerRef} style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-base)', overflow: 'hidden', position: 'relative' }}>

      {/* Toolbar */}
      <div style={{ height: 30, display: 'flex', alignItems: 'center', gap: 4, padding: '0 8px', background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <button onClick={() => setBeatW(w => Math.min(MAX_BEAT_W, w * 1.3))} style={toolBtn} title="Zoom in"><ZoomIn size={13} /></button>
        <button onClick={() => setBeatW(w => Math.max(MIN_BEAT_W, w * 0.77))} style={toolBtn} title="Zoom out"><ZoomOut size={13} /></button>
        <button onClick={fitToWindow} style={toolBtn} title="Fit to window"><Maximize2 size={13} /></button>
        <div style={{ width: 1, height: 16, background: 'var(--border)' }} />
        <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>SNAP</span>
        {(['off', '1/16', '1/8', 'beat', 'bar'] as SnapMode[]).map(m => (
          <button key={m} onClick={() => setSnap(m)}
            style={{ ...toolBtn, background: snap === m ? 'var(--bg-card)' : 'transparent', color: snap === m ? 'var(--text-primary)' : 'var(--text-muted)', border: snap === m ? '1px solid var(--border)' : '1px solid transparent', fontSize: 9, padding: '2px 6px' }}>
            {m === 'off' ? 'Off' : m === 'beat' ? 'Beat' : m === 'bar' ? 'Bar' : m}
          </button>
        ))}
        <span style={{ fontSize: 8, color: 'var(--text-muted)', marginLeft: 2 }} title="Hold ⌥ Option while dragging to bypass snap">⌥=free</span>
        <div style={{ flex: 1 }} />
        <button onClick={openPianoRoll} title="Open Piano Roll (open/create MIDI clip for selected track)" style={{
          ...toolBtn, width: 'auto', padding: '2px 8px', fontSize: 9, fontWeight: 700,
          border: `1px solid ${expandedPianoRollClipId ? '#7c3aed' : 'var(--border)'}`,
          background: expandedPianoRollClipId ? 'rgba(124,58,237,0.18)' : 'transparent',
          color: expandedPianoRollClipId ? '#a78bfa' : 'var(--text-muted)',
          letterSpacing: '0.04em',
        }}>PIANO ROLL</button>
        {onSave && (
          <button onClick={onSave} disabled={isSaving} title="Save project (⌘S)" style={{
            ...toolBtn, width: 'auto', padding: '2px 10px', fontSize: 9, fontWeight: 700,
            border: '1px solid var(--border)',
            background: isSaving ? 'rgba(34,197,94,0.15)' : 'transparent',
            color: isSaving ? '#4ade80' : 'var(--text-muted)',
            letterSpacing: '0.04em', marginLeft: 4,
          }}>{isSaving ? 'SAVING…' : 'SAVE'}</button>
        )}
      </div>

      {/* Ruler row */}
      <div style={{ display: 'flex', flexShrink: 0 }} onWheel={handleWheel}>
        <div style={{ width: HDR_W, height: RULER_H, flexShrink: 0, background: 'var(--bg-surface)', borderRight: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }} />
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <Ruler beatW={beatW} scrollLeft={scrollLeft} snap={snap} onSeek={b => { engine.seek(b); setPosition(b) }} onEditTimeSig={handleEditTimeSig} />
        </div>
      </div>

      {/* Track rows */}
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
            {(['audio', 'drum'] as const).map(type => (
              <button key={type} onClick={() => dispatch({ type: 'ADD_TRACK', trackType: type })}
                style={{ flex: 1, padding: '3px 0', fontSize: 9, borderRadius: 3, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-muted)', cursor: 'pointer' }}>
                {type === 'audio' ? '+Track' : '+Drum'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Global playhead overlay — clipped to track content area so it stays behind the header */}
      <div style={{ position: 'absolute', left: HDR_W, right: 0, top: 30 + RULER_H, bottom: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 10 }}>
        <div ref={playheadRef} style={{ position: 'absolute', top: 0, bottom: 0, width: 1, background: '#ef4444' }} />
      </div>

      {/* Time signature popover */}
      {tsPopover && createPortal(
        <div ref={tsPopoverRef} style={{
          position: 'fixed', top: tsPopover.y - 110, left: tsPopover.x,
          background: '#1e1e1e', border: '1px solid var(--border)',
          borderRadius: 6, padding: '10px 12px', zIndex: 1000,
          boxShadow: '0 4px 16px rgba(0,0,0,0.7)', display: 'flex',
          flexDirection: 'column', gap: 8, minWidth: 140,
        }}>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.06em' }}>TIME SIGNATURE</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="number" min={1} max={16} value={tsDraftNum}
              onChange={e => setTsDraftNum(Math.max(1, parseInt(e.target.value) || 4))}
              onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') { dispatch({ type: 'SET_TIME_SIG', num: tsDraftNum, den: tsDraftDen }); setTsPopover(null) } }}
              style={{ width: 40, background: '#111', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 14, fontFamily: 'monospace', borderRadius: 3, padding: '3px 5px', outline: 'none', textAlign: 'center' }}
            />
            <span style={{ color: 'var(--text-muted)', fontSize: 16 }}>/</span>
            <select value={tsDraftDen} onChange={e => setTsDraftDen(parseInt(e.target.value))}
              style={{ width: 48, background: '#111', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 14, fontFamily: 'monospace', borderRadius: 3, padding: '3px 4px', outline: 'none', cursor: 'pointer' }}>
              {[2, 4, 8, 16].map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => { dispatch({ type: 'SET_TIME_SIG', num: tsDraftNum, den: tsDraftDen }); setTsPopover(null) }}
              style={{ flex: 1, background: 'var(--accent)', border: 'none', color: '#fff', fontSize: 11, borderRadius: 3, padding: '5px 0', cursor: 'pointer', fontWeight: 600 }}>
              Apply
            </button>
            <button onClick={() => setTsPopover(null)}
              style={{ flex: 1, background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)', fontSize: 11, borderRadius: 3, padding: '5px 0', cursor: 'pointer' }}>
              Cancel
            </button>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}

const toolBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  width: 26, height: 22, borderRadius: 3, border: '1px solid transparent',
  background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer',
}
