'use client'

import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useDaw } from '@/lib/daw-state'
import type { AudioClip } from '@/lib/daw-types'

export default function ClipCropModal({ clip, onClose }: { clip: AudioClip; onClose: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const { dispatch, engine } = useDaw()
  const canvasRef  = useRef<HTMLCanvasElement>(null)
  const bufRef     = useRef<AudioBuffer | null>(null)
  const peaksRef   = useRef<number[]>([])
  const dragging   = useRef<'start' | 'end' | null>(null)
  const [ready,     setReady]     = useState(false)
  const [startFrac, setStartFrac] = useState(0)
  const [endFrac,   setEndFrac]   = useState(1)

  useEffect(() => {
    if (!clip.audioUrl) return
    let cancelled = false
    fetch(clip.audioUrl)
      .then(r => r.arrayBuffer())
      .then(ab => { const ctx = new AudioContext(); return ctx.decodeAudioData(ab).finally(() => ctx.close()) })
      .then(buf => {
        if (cancelled) return
        bufRef.current = buf
        setStartFrac(buf.duration > 0 ? clip.trimStart / buf.duration : 0)
        setEndFrac(buf.duration > 0 ? 1 - clip.trimEnd / buf.duration : 1)
        const data = buf.getChannelData(0)
        const W = 400
        const spb = Math.max(1, Math.floor(data.length / W))
        const peaks: number[] = []
        for (let x = 0; x < W; x++) {
          let p = 0; for (let j = 0; j < spb; j++) p = Math.max(p, Math.abs(data[x * spb + j] ?? 0)); peaks.push(p)
        }
        peaksRef.current = peaks
        setReady(true)
      }).catch(() => {})
    return () => { cancelled = true }
  }, [clip.audioUrl, clip.trimStart, clip.trimEnd])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !ready) return
    const ctx = canvas.getContext('2d')!
    const W = canvas.width, H = canvas.height
    ctx.clearRect(0, 0, W, H)
    peaksRef.current.forEach((p, x) => {
      const bh = Math.max(1, p * (H - 4) * 0.9)
      ctx.fillStyle = x >= startFrac * W && x <= endFrac * W ? '#3d8fef' : 'rgba(61,143,239,0.15)'
      ctx.fillRect(x, (H - bh) / 2, 1, bh)
    })
    ctx.fillStyle = 'rgba(0,0,0,0.52)'
    ctx.fillRect(0, 0, startFrac * W, H)
    ctx.fillRect(endFrac * W, 0, W - endFrac * W, H)
    const drawH = (x: number) => {
      ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = 2
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke()
      ctx.fillStyle = '#f59e0b'; ctx.fillRect(x - 4, 0, 8, 6)
    }
    drawH(startFrac * W); drawH(endFrac * W)
  }, [ready, startFrac, endFrac])

  function getRatio(e: React.MouseEvent<HTMLCanvasElement>) {
    const r = canvasRef.current!.getBoundingClientRect()
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))
  }

  function handleApply() {
    const buf = bufRef.current; if (!buf) return
    const newTrimStart = startFrac * buf.duration
    const newTrimEnd   = (1 - endFrac) * buf.duration
    const playDur      = buf.duration - newTrimStart - newTrimEnd
    dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: {
      trimStart: newTrimStart, trimEnd: newTrimEnd,
      durationBeats: Math.max(0.125, engine.secondsToBeats(playDur)),
      loopEnabled: false,
    }})
    engine.evictBuffer(clip.id)
    onClose()
  }

  const dur = bufRef.current?.duration ?? 0
  return createPortal(
    <div
className="electron-nodrag"
style={{ position: 'fixed', inset: 0, zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.7)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: 16, width: 440, boxShadow: '0 8px 32px rgba(0,0,0,0.6)' }}>
        <div style={{ marginBottom: 10, fontSize: 12, color: 'var(--text-primary)', fontWeight: 600 }}>Crop: {clip.name}</div>
        {!ready
          ? <div style={{ height: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: 'var(--text-muted)', background: 'var(--bg-base)', borderRadius: 4, marginBottom: 10 }}>Loading…</div>
          : <canvas ref={canvasRef} width={408} height={60}
              style={{ width: '100%', height: 60, display: 'block', borderRadius: 4, cursor: 'ew-resize', background: 'var(--bg-base)', marginBottom: 6 }}
              onMouseDown={e => { const r = getRatio(e); dragging.current = Math.abs(r - startFrac) <= Math.abs(r - endFrac) ? 'start' : 'end' }}
              onMouseMove={e => { if (!dragging.current) return; const r = getRatio(e); dragging.current === 'start' ? setStartFrac(Math.min(r, endFrac - 0.02)) : setEndFrac(Math.max(r, startFrac + 0.02)) }}
              onMouseUp={() => { dragging.current = null }} onMouseLeave={() => { dragging.current = null }}
            />
        }
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'var(--text-muted)', fontFamily: 'monospace', marginBottom: 12 }}>
          <span>In: {(startFrac * dur).toFixed(2)}s</span>
          <span>{((endFrac - startFrac) * dur).toFixed(2)}s selected</span>
          <span>Out: {(endFrac * dur).toFixed(2)}s</span>
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ fontSize: 11, padding: '5px 14px', borderRadius: 4, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' }}>Cancel</button>
          <button onClick={handleApply} style={{ fontSize: 11, padding: '5px 14px', borderRadius: 4, border: 'none', background: 'var(--accent)', color: '#fff', cursor: 'pointer' }}>Apply Crop</button>
        </div>
      </div>
    </div>,
    document.body
  )
}
