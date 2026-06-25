'use client'

import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { ZoomIn, ZoomOut, Maximize2, Plus } from 'lucide-react'
import { useDaw, extractPeaks, makeAudioClip, makeMidiClip } from '@/lib/daw-state'
import { decodeAiff } from '@/lib/wav-codec'
import { encodeWav } from '@/lib/wav-codec'
import type { DawTrack, DawClip, AudioClip, AutomationLane, ClipEffect, ClipEffectType } from '@/lib/daw-types'
import { isAudioClip, isMidiClip } from '@/lib/daw-types'
import { libraryGetAll } from '@/lib/sound-library'
import { libraryFulfill } from '@/lib/default-samples'
import Waveform from './Waveform'
import IsolateModal from './IsolateModal'
import dynamic from 'next/dynamic'

const AutomationLaneView = dynamic(() => import('./AutomationLaneView'), { ssr: false })

const HDR_W      = 200
const SEC_H      = 24
const BAR_H      = 20
const RULER_H    = SEC_H + BAR_H   // 44px total
const MIN_BEAT_W = 10
const MAX_BEAT_W = 200
const AUTO_H     = 60
const EFFECT_H   = 40

const EFFECT_COLORS: Record<ClipEffectType, string> = {
  volume:     '#22c55e',
  reverb:     '#3b82f6',
  delay:      '#06b6d4',
  filter:     '#eab308',
  tremolo:    '#a855f7',
  distortion: '#ef4444',
}

const EFFECT_DEFAULTS: Record<ClipEffectType, ClipEffect['params']> = {
  volume:     { gain: 1.4 },
  reverb:     { reverbWet: 0.4, reverbDecay: 2 },
  delay:      { delayTime: 0.375, feedback: 0.4, delayWet: 0.3 },
  filter:     { frequency: 800, filterType: 'lowpass', filterQ: 1 },
  tremolo:    { tremoloRate: 4, tremoloDepth: 0.6 },
  distortion: { distortion: 0.5 },
}

type SnapMode = 'off' | '1/16' | '1/8' | 'beat' | 'bar'

function snapBeat(beat: number, mode: SnapMode, beatsPerBar = 4): number {
  if (mode === 'off')   return beat
  if (mode === 'bar')   return Math.round(beat / beatsPerBar) * beatsPerBar
  if (mode === 'beat')  return Math.round(beat)
  if (mode === '1/8')   return Math.round(beat * 2) / 2
  if (mode === '1/16')  return Math.round(beat * 4) / 4
  return beat
}

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

    // Background
    ctx.fillStyle = '#161616'
    ctx.fillRect(0, 0, W, RULER_H)
    ctx.fillStyle = '#252525'
    ctx.fillRect(0, SEC_H, W, 1)

    // ── Seconds ruler ──────────────────────────────────────────────────────────
    const INTERVALS = [0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60]
    const secInterval  = INTERVALS.find(iv => iv * pxPerSec >= 70) ?? 60
    const halfInterval = secInterval / 2
    const startTime    = scrollLeft / pxPerSec
    const endTime      = startTime + W / pxPerSec

    // minor ticks (half-interval, odd multiples)
    const firstHalfIdx = Math.floor(startTime / halfInterval)
    for (let i = firstHalfIdx; i * halfInterval <= endTime + halfInterval; i++) {
      if (i % 2 === 0) continue  // even = major, drawn below
      const x = Math.round(i * halfInterval * pxPerSec - scrollLeft)
      if (x < 0 || x > W) continue
      ctx.fillStyle = '#2d2d2d'
      ctx.fillRect(x, SEC_H - 5, 1, 5)
    }

    // major ticks + labels
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

    // ── Bar ruler ──────────────────────────────────────────────────────────────
    const pxPerBar    = beatW * sigNum
    if (pxPerBar >= 6) {
      const firstBar   = Math.floor(scrollLeft / pxPerBar)
      const labelEvery = Math.max(1, Math.ceil(36 / pxPerBar))
      for (let bar = firstBar; bar * pxPerBar <= scrollLeft + W + pxPerBar; bar++) {
        const x = Math.round(bar * pxPerBar - scrollLeft)
        if (x >= -1 && x <= W + 1) {
          ctx.fillStyle = '#3a3a3a'
          ctx.fillRect(x, SEC_H + 1, 1, BAR_H - 1)
        }
        // beat sub-ticks
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

    // time-sig hint (far right)
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
          const rect  = e.currentTarget.getBoundingClientRect()
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

// ── Clip view ─────────────────────────────────────────────────────────────────

// ── Effect lane ───────────────────────────────────────────────────────────────

function EffectParamEditor({ effect, onClose }: { effect: ClipEffect; onClose: () => void }) {
  const { dispatch } = useDaw()
  function set(key: string, val: number) {
    dispatch({ type: 'UPDATE_CLIP_EFFECT', effectId: effect.id, patch: { params: { [key]: val } } })
  }
  function Slider({ label, k, min, max, step = 0.01, log = false }: { label: string; k: string; min: number; max: number; step?: number; log?: boolean }) {
    const raw = (effect.params as Record<string, number>)[k] ?? (min + max) / 2
    const normalized = log
      ? (Math.log(raw / min) / Math.log(max / min))
      : ((raw - min) / (max - min))
    return (
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
        <span style={{ width: 60, flexShrink: 0 }}>{label}</span>
        <input type="range" min={0} max={1} step={0.001} value={normalized}
          onChange={e => {
            const n = parseFloat(e.target.value)
            const v = log ? min * Math.pow(max / min, n) : min + n * (max - min)
            set(k, v)
          }}
          style={{ flex: 1, accentColor: EFFECT_COLORS[effect.type] }} />
        <span style={{ width: 40, fontFamily: 'monospace', textAlign: 'right', color: 'var(--text-primary)', fontSize: 9 }}>
          {raw.toFixed(raw < 10 ? 2 : 0)}
        </span>
      </label>
    )
  }

  return (
    <div style={{ background: '#1e1e2e', border: `1px solid ${EFFECT_COLORS[effect.type]}`, borderRadius: 6, padding: '10px 12px', minWidth: 220, boxShadow: '0 4px 20px rgba(0,0,0,0.6)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: EFFECT_COLORS[effect.type], textTransform: 'capitalize' }}>{effect.type}</span>
        <button onClick={onClose} style={{ fontSize: 9, background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>✕</button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {effect.type === 'volume'     && <Slider label="Volume" k="gain" min={0} max={2} />}
        {effect.type === 'reverb'     && <><Slider label="Wet" k="reverbWet" min={0} max={1} /><Slider label="Decay" k="reverbDecay" min={0.3} max={5} /></>}
        {effect.type === 'delay'      && <><Slider label="Time" k="delayTime" min={0.05} max={2} /><Slider label="Feedback" k="feedback" min={0} max={0.95} /><Slider label="Wet" k="delayWet" min={0} max={1} /></>}
        {effect.type === 'filter'     && <><Slider label="Freq" k="frequency" min={40} max={18000} log /><Slider label="Q" k="filterQ" min={0.1} max={20} log /></>}
        {effect.type === 'tremolo'    && <><Slider label="Rate" k="tremoloRate" min={0.1} max={15} /><Slider label="Depth" k="tremoloDepth" min={0} max={1} /></>}
        {effect.type === 'distortion' && <Slider label="Amount" k="distortion" min={0} max={1} />}
      </div>
    </div>
  )
}

function EffectLaneView({
  trackId, beatW, scrollLeft, viewWidth,
}: { trackId: string; beatW: number; scrollLeft: number; viewWidth: number }) {
  const { project, dispatch } = useDaw()
  const effects = (project.clipEffects ?? []).filter(e => e.trackId === trackId)
  const [addMenu, setAddMenu]   = useState<{ x: number; y: number; beat: number } | null>(null)
  const [editTarget, setEditTarget] = useState<{ effect: ClipEffect; x: number; y: number } | null>(null)
  const dragRef  = useRef<{ effectId: string; startX: number; startBeat: number } | null>(null)
  const resizeRef = useRef<{ effectId: string; startX: number; startDur: number } | null>(null)
  const laneRef  = useRef<HTMLDivElement>(null)

  const viewStartBeat = scrollLeft / beatW
  const viewEndBeat   = viewStartBeat + viewWidth / beatW

  function beatFromClientX(clientX: number) {
    const rect = laneRef.current?.getBoundingClientRect()
    if (!rect) return 0
    return (clientX - rect.left + scrollLeft) / beatW
  }

  const EFFECT_TYPES: ClipEffectType[] = ['volume', 'reverb', 'delay', 'filter', 'tremolo', 'distortion']

  function addEffect(type: ClipEffectType, beat: number) {
    const effect: ClipEffect = {
      id: crypto.randomUUID(),
      trackId,
      type,
      startBeat: Math.max(0, beat),
      durationBeats: 4,
      params: { ...EFFECT_DEFAULTS[type] },
    }
    dispatch({ type: 'ADD_CLIP_EFFECT', effect })
  }

  return (
    <div ref={laneRef} style={{ flex: 1, height: EFFECT_H, position: 'relative', background: 'rgba(0,0,0,0.35)', borderBottom: '1px solid var(--border)', overflow: 'hidden', cursor: 'crosshair' }}
      onContextMenu={e => { e.preventDefault(); const beat = beatFromClientX(e.clientX); setAddMenu({ x: e.clientX, y: e.clientY, beat }) }}
      onClick={() => { setAddMenu(null); setEditTarget(null) }}
    >
      {/* Grid lines */}
      {Array.from({ length: Math.ceil(viewEndBeat) - Math.floor(viewStartBeat) + 1 }, (_, i) => Math.floor(viewStartBeat) + i).map(b => {
        const x = b * beatW - scrollLeft
        return x >= 0 && x <= viewWidth ? (
          <div key={b} style={{ position: 'absolute', left: x, top: 0, bottom: 0, width: 1, background: 'rgba(255,255,255,0.04)', pointerEvents: 'none' }} />
        ) : null
      })}

      {/* Scrolled effect clips */}
      <div style={{ position: 'absolute', top: 0, bottom: 0, left: -scrollLeft, width: (viewEndBeat + 10) * beatW }}>
        {effects.map(eff => {
          if (eff.startBeat + eff.durationBeats < viewStartBeat || eff.startBeat > viewEndBeat) return null
          const left  = eff.startBeat * beatW
          const width = Math.max(8, eff.durationBeats * beatW)
          const color = EFFECT_COLORS[eff.type]
          return (
            <div key={eff.id} style={{ position: 'absolute', left, width, top: 3, bottom: 3, background: `${color}30`, border: `1px solid ${color}`, borderRadius: 3, overflow: 'hidden', cursor: 'grab', userSelect: 'none' }}
              onMouseDown={e => {
                if (e.button !== 0) return
                e.stopPropagation()
                dragRef.current = { effectId: eff.id, startX: e.clientX, startBeat: eff.startBeat }
                function mm(ev: MouseEvent) {
                  if (!dragRef.current) return
                  const newStart = Math.max(0, dragRef.current.startBeat + (ev.clientX - dragRef.current.startX) / beatW)
                  dispatch({ type: 'UPDATE_CLIP_EFFECT', effectId: dragRef.current.effectId, patch: { startBeat: newStart } })
                }
                function mu() { dragRef.current = null; document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu) }
                document.addEventListener('mousemove', mm); document.addEventListener('mouseup', mu)
              }}
              onClick={e => { e.stopPropagation(); setEditTarget({ effect: eff, x: e.clientX, y: e.clientY }) }}
              onContextMenu={e => { e.preventDefault(); e.stopPropagation(); dispatch({ type: 'REMOVE_CLIP_EFFECT', effectId: eff.id }) }}
            >
              <span style={{ position: 'absolute', top: 3, left: 4, fontSize: 8, color, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', pointerEvents: 'none', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', maxWidth: width - 16 }}>
                {eff.type}
              </span>
              {/* Resize handle */}
              <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 5, cursor: 'ew-resize' }}
                onMouseDown={e => {
                  e.stopPropagation()
                  resizeRef.current = { effectId: eff.id, startX: e.clientX, startDur: eff.durationBeats }
                  function mm(ev: MouseEvent) {
                    if (!resizeRef.current) return
                    dispatch({ type: 'UPDATE_CLIP_EFFECT', effectId: resizeRef.current.effectId, patch: { durationBeats: Math.max(0.5, resizeRef.current.startDur + (ev.clientX - resizeRef.current.startX) / beatW) } })
                  }
                  function mu() { resizeRef.current = null; document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu) }
                  document.addEventListener('mousemove', mm); document.addEventListener('mouseup', mu)
                }} />
            </div>
          )
        })}
      </div>

      {/* Add-effect context menu */}
      {addMenu && createPortal(
        <div style={{ position: 'fixed', zIndex: 1500, left: addMenu.x, top: addMenu.y, background: '#1e1e2e', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 0', minWidth: 140, boxShadow: '0 4px 20px rgba(0,0,0,0.6)' }}
          onMouseLeave={() => setAddMenu(null)}>
          <div style={{ fontSize: 9, color: 'var(--text-muted)', padding: '2px 10px 6px', letterSpacing: 0.5, textTransform: 'uppercase' }}>Add Effect</div>
          {EFFECT_TYPES.map(t => (
            <button key={t} onClick={() => { addEffect(t, addMenu.beat); setAddMenu(null) }}
              style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', padding: '5px 10px', fontSize: 11, cursor: 'pointer', background: 'transparent', border: 'none', color: 'var(--text-primary)' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: EFFECT_COLORS[t], flexShrink: 0 }} />
              <span style={{ textTransform: 'capitalize' }}>{t}</span>
            </button>
          ))}
        </div>,
        document.body
      )}

      {/* Effect param editor */}
      {editTarget && createPortal(
        <div style={{ position: 'fixed', zIndex: 1500, left: editTarget.x, top: editTarget.y + 8 }}>
          <EffectParamEditor effect={editTarget.effect} onClose={() => setEditTarget(null)} />
        </div>,
        document.body
      )}
    </div>
  )
}

// ── Clip crop modal ───────────────────────────────────────────────────────────

function ClipCropModal({ clip, onClose }: { clip: AudioClip; onClose: () => void }) {
  const { dispatch, engine } = useDaw()
  const canvasRef  = useRef<HTMLCanvasElement>(null)
  const bufRef     = useRef<AudioBuffer | null>(null)
  const peaksRef   = useRef<number[]>([])
  const dragging   = useRef<'start' | 'end' | null>(null)
  const [ready,      setReady]      = useState(false)
  const [startFrac,  setStartFrac]  = useState(0)
  const [endFrac,    setEndFrac]    = useState(1)

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
    <div style={{ position: 'fixed', inset: 0, zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.7)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background: '#181828', border: '1px solid var(--border)', borderRadius: 8, padding: 16, width: 440, boxShadow: '0 8px 32px rgba(0,0,0,0.6)' }}>
        <div style={{ marginBottom: 10, fontSize: 12, color: 'var(--text-primary)', fontWeight: 600 }}>Crop: {clip.name}</div>
        {!ready
          ? <div style={{ height: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: 'var(--text-muted)', background: '#0a0a0f', borderRadius: 4, marginBottom: 10 }}>Loading…</div>
          : <canvas ref={canvasRef} width={408} height={60}
              style={{ width: '100%', height: 60, display: 'block', borderRadius: 4, cursor: 'ew-resize', background: '#0a0a0f', marginBottom: 6 }}
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

// ── Clip view ─────────────────────────────────────────────────────────────────

function ClipView({ clip, track, beatW, selected, multiSelected, onSelect, onShiftSelect, onDoubleClick, onMove, onResize, onCrop, onIsolate, onDelete }: {
  clip: DawClip; track: DawTrack; beatW: number; selected: boolean; multiSelected: boolean
  onSelect(): void; onShiftSelect(): void; onDoubleClick(): void
  onMove(startBeat: number, trackId: string, altKey: boolean): void
  onResize(durationBeats: number, altKey: boolean): void
  onCrop(): void; onIsolate(beat: number): void; onDelete(): void
}) {
  const clipDivRef = useRef<HTMLDivElement>(null)
  const dragRef    = useRef<{ startX: number; startBeat: number } | null>(null)
  const resizeRef  = useRef<{ startX: number; startDur: number } | null>(null)
  const [ctxPos, setCtxPos] = useState<{ x: number; y: number; beat: number } | null>(null)

  const left  = clip.startBeat * beatW
  const width = Math.max(8, clip.durationBeats * beatW)
  const color = track.color

  function onMouseDownBody(e: React.MouseEvent) {
    if (e.button !== 0) return
    e.stopPropagation()
    if (e.shiftKey) { onShiftSelect() } else { onSelect() }
    dragRef.current = { startX: e.clientX, startBeat: clip.startBeat }
    function mm(ev: MouseEvent) {
      if (!dragRef.current) return
      // Detect target track under cursor — briefly disable pointer events so elementFromPoint
      // sees the lane beneath the dragged clip
      const div = clipDivRef.current
      if (div) div.style.pointerEvents = 'none'
      const el = document.elementFromPoint(ev.clientX, ev.clientY)
      if (div) div.style.pointerEvents = ''
      const targetTrackId = el?.closest('[data-track-id]')?.getAttribute('data-track-id') ?? track.id
      onMove(Math.max(0, dragRef.current.startBeat + (ev.clientX - dragRef.current.startX) / beatW), targetTrackId, ev.altKey)
    }
    function mu() { dragRef.current = null; document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu) }
    document.addEventListener('mousemove', mm); document.addEventListener('mouseup', mu)
  }

  function onMouseDownResize(e: React.MouseEvent) {
    e.stopPropagation()
    resizeRef.current = { startX: e.clientX, startDur: clip.durationBeats }
    function mm(ev: MouseEvent) {
      if (!resizeRef.current) return
      onResize(Math.max(0.125, resizeRef.current.startDur + (ev.clientX - resizeRef.current.startX) / beatW), ev.altKey)
    }
    function mu() { resizeRef.current = null; document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu) }
    document.addEventListener('mousemove', mm); document.addEventListener('mouseup', mu)
  }

  const menuItems = [
    { label: 'Delete', fn: onDelete },
    ...(isAudioClip(clip) ? [
      { label: 'Crop', fn: onCrop },
      { label: 'Isolate on Playhead', fn: () => onIsolate(ctxPos?.beat ?? clip.startBeat) },
    ] : []),
    { label: 'Open Piano Roll', fn: onDoubleClick },
  ]

  return (
    <>
      <div
        ref={clipDivRef}
        style={{ position: 'absolute', left, width, top: 4, bottom: 4, background: `${color}40`, border: `1px solid ${selected ? '#fff' : multiSelected ? `${color}cc` : color}`, borderRadius: 3, overflow: 'hidden', cursor: 'grab', userSelect: 'none', boxSizing: 'border-box', outline: multiSelected && !selected ? `1px solid #fff6` : undefined }}
        onMouseDown={onMouseDownBody}
        onDoubleClick={onDoubleClick}
        onContextMenu={e => {
          e.preventDefault(); e.stopPropagation()
          const rect = clipDivRef.current?.getBoundingClientRect()
          const beat = rect ? clip.startBeat + (e.clientX - rect.left) / beatW : clip.startBeat
          setCtxPos({ x: e.clientX, y: e.clientY, beat })
        }}
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
          {isAudioClip(clip) && clip.loopEnabled && <span style={{ marginLeft: 4, opacity: 0.7 }}>↻</span>}
        </div>
        <div onMouseDown={onMouseDownResize} style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 6, cursor: 'ew-resize' }} />
      </div>

      {ctxPos && (
        <div style={{ position: 'fixed', zIndex: 1000, left: ctxPos.x, top: ctxPos.y, background: '#2a2a2a', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 0', minWidth: 140, boxShadow: '0 4px 20px rgba(0,0,0,0.5)' }} onMouseLeave={() => setCtxPos(null)}>
          {menuItems.map(it => (
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
  const [open, setOpen]       = useState(false)
  const [dropPos, setDropPos] = useState({ top: 0, left: 0 })
  const btnRef  = useRef<HTMLButtonElement>(null)
  const dropRef = useRef<HTMLDivElement>(null)

  const existing = new Set(project.automationLanes.filter(l => l.trackId === track.id).map(l => l.parameter))
  const opts: { label: string; parameter: string; min: number; max: number; def: number }[] = [
    { label: 'Volume', parameter: 'volume', min: 0, max: 1, def: track.volume },
    { label: 'Pan',    parameter: 'pan',    min: -1, max: 1, def: track.pan },
    ...track.effects.map(e => ({ label: `${e.type.toUpperCase()} Wet`, parameter: `fx:${e.id}:wet`, min: 0, max: 1, def: 0.5 })),
  ].filter(o => !existing.has(o.parameter))

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (dropRef.current?.contains(e.target as Node)) return
      if (btnRef.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  function handleToggle() {
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      setDropPos({ top: r.bottom + 4, left: r.left })
    }
    setOpen(o => !o)
  }

  if (opts.length === 0) return null

  return (
    <>
      <button
        ref={btnRef}
        onClick={handleToggle}
        style={{ display: 'flex', alignItems: 'center', gap: 2, padding: '1px 4px', fontSize: 9, background: 'transparent', border: '1px solid var(--border)', borderRadius: 3, color: 'var(--text-muted)', cursor: 'pointer' }}
        title="Add automation lane"
      ><Plus size={8} /> A</button>
      {open && createPortal(
        <div ref={dropRef} style={{
          position: 'fixed', top: dropPos.top, left: dropPos.left,
          zIndex: 1000, background: '#2a2a2a', border: '1px solid var(--border)',
          borderRadius: 6, padding: '4px 0', minWidth: 130,
          boxShadow: '0 4px 16px rgba(0,0,0,0.6)',
        }}>
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
        </div>,
        document.body
      )}
    </>
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
  const { project, dispatch, engine, setEditTarget, setSelectedClipId, selectedClipId, setSelectedTrackId, selectedTrackId, selectedClipIds, setSelectedClipIds } = useDaw()
  const clips = project.arrangementClips.filter(c => c.trackId === track.id)
  const autoLanes = project.automationLanes.filter(l => l.trackId === track.id)
  const dragHRef = useRef<{ startY: number; startH: number } | null>(null)
  const [editing,      setEditing]      = useState(false)
  const [draft,        setDraft]        = useState(track.name)
  const [cropTarget,   setCropTarget]   = useState<AudioClip | null>(null)
  const [showFx,       setShowFx]       = useState(false)
  const [isolateTgt,   setIsolateTgt]   = useState<number | null>(null)  // beat position

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
      let entry = entries.find(en => en.id === libId)
      if (!entry) return
      if (!entry.audioBlob) {
        const fulfilled = await libraryFulfill(entry.id)
        if (!fulfilled?.audioBlob) return
        entry = fulfilled
      }
      const url  = URL.createObjectURL(entry.audioBlob!)
      const clip = makeAudioClip(track.id, entry.name, snapBeat(beatX, snap, project.timeSignatureNum), 8, { audioUrl: url })
      dispatch({ type: 'ADD_CLIP', clip })
      const buf = await engine.loadClipBuffer(clip)
      if (buf) {
        const peaks = extractPeaks(buf)
        dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: { waveformPeaks: peaks, durationBeats: engine.secondsToBeats(buf.duration), bufferDuration: buf.duration } })
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
        const ext  = file.name.split('.').pop()?.toLowerCase() ?? ''
        let ab = await file.arrayBuffer()
        let blobUrl: string

        // Chrome's decodeAudioData does not support AIFF — convert to WAV first
        if (ext === 'aif' || ext === 'aiff') {
          try {
            const { channels, sampleRate } = decodeAiff(ab)
            const wavBuf = encodeWav(channels, sampleRate)
            const wavBlob = new Blob([wavBuf], { type: 'audio/wav' })
            ab = wavBuf
            blobUrl = URL.createObjectURL(wavBlob)
          } catch {
            console.error('Could not decode AIFF file:', file.name)
            return
          }
        } else {
          blobUrl = URL.createObjectURL(file)
        }

        const clip = makeAudioClip(track.id, file.name.replace(/\.[^.]+$/, ''), snapBeat(beatX, snap, project.timeSignatureNum), 8, { audioUrl: blobUrl })
        dispatch({ type: 'ADD_CLIP', clip })
        const buf = await engine.loadBufferFromArrayBuffer(clip.id, ab)
        const peaks = extractPeaks(buf)
        dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: { waveformPeaks: peaks, durationBeats: engine.secondsToBeats(buf.duration), bufferDuration: buf.duration } })
      }
      input.click()
    } else {
      const clip = makeMidiClip(track.id, 'MIDI Clip', snapBeat(beatX, snap, project.timeSignatureNum), 4)
      dispatch({ type: 'ADD_CLIP', clip })
      setEditTarget({ type: 'midi-clip', clipId: clip.id })
    }
  }

  const isSelected = selectedTrackId === track.id

  return (
    <div style={{ boxShadow: isSelected ? `inset 2px 0 0 var(--accent)` : 'none' }}>
      {/* Main track row */}
      <div style={{ display: 'flex', height: track.height, flexShrink: 0 }}>
        {/* Header — click to select track (opens Devices/Instrument panel) */}
        <div
          onClick={e => { if (!(e.target as HTMLElement).closest('button,input,select')) setSelectedTrackId(track.id) }}
          style={{ width: HDR_W, height: track.height, flexShrink: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 4, padding: '4px 8px', background: isSelected ? 'rgba(61,143,239,0.10)' : 'var(--bg-card)', borderRight: '1px solid var(--border)', borderBottom: '1px solid var(--border)', borderLeft: `3px solid ${track.color}`, boxSizing: 'border-box', overflow: 'hidden', cursor: 'pointer', transition: 'background 0.1s' }}
        >
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
            <button
              title="Toggle effects lane"
              onClick={e => { e.stopPropagation(); setShowFx(v => !v) }}
              style={{ fontSize: 8, width: 22, height: 14, borderRadius: 2, border: `1px solid ${showFx ? 'var(--accent)' : 'var(--border)'}`, background: showFx ? 'var(--accent)' : 'var(--bg-surface)', color: showFx ? '#fff' : 'var(--text-muted)', cursor: 'pointer', fontWeight: 700, padding: 0, flexShrink: 0 }}
            >FX</button>
            <button
              title="Open device panel"
              onClick={e => { e.stopPropagation(); setSelectedTrackId(track.id) }}
              style={{ fontSize: 9, width: 16, height: 14, borderRadius: 2, border: '1px solid var(--border)', background: 'var(--bg-surface)', color: 'var(--text-muted)', cursor: 'pointer', fontWeight: 700, padding: 0, flexShrink: 0 }}
            >⚙</button>
          </div>
        </div>

        {/* Lane */}
        <div
          data-testid="track-lane"
          data-track-id={track.id}
          data-track-type={track.type}
          style={{ flex: 1, height: track.height, position: 'relative', background: isSelected ? 'rgba(61,143,239,0.04)' : 'var(--bg-surface)', borderBottom: '1px solid var(--border)', overflow: 'hidden', transition: 'background 0.1s' }}
          onMouseDown={() => { setSelectedClipIds(new Set()); setSelectedClipId(null) }}
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
            {visibleClips.map(clip => {
              const isSelected      = selectedClipId === clip.id
              const isMultiSelected = selectedClipIds.has(clip.id)
              return (
                <ClipView
                  key={clip.id}
                  clip={clip}
                  track={track} beatW={beatW}
                  selected={isSelected}
                  multiSelected={isMultiSelected}
                  onSelect={() => { setSelectedClipId(clip.id); setSelectedClipIds(new Set([clip.id])) }}
                  onShiftSelect={() => {
                    setSelectedClipIds(prev => {
                      const next = new Set(prev)
                      if (next.has(clip.id)) { next.delete(clip.id) } else { next.add(clip.id) }
                      return next
                    })
                    setSelectedClipId(clip.id)
                  }}
                  onDoubleClick={() => setEditTarget({ type: clip.kind === 'midi' ? 'midi-clip' : 'audio-clip', clipId: clip.id })}
                  onMove={(sb, tid, alt) => dispatch({ type: 'MOVE_CLIP', clipId: clip.id, startBeat: snapBeat(sb, alt ? 'off' : snap, project.timeSignatureNum), trackId: tid })}
                  onResize={(db, alt) => {
                    const endBeat      = clip.startBeat + db
                    const snappedEnd   = alt ? endBeat : snapBeat(endBeat, snap, project.timeSignatureNum)
                    const newDurBeats  = Math.max(0.125, snappedEnd - clip.startBeat)
                    const patch: Record<string, unknown> = { durationBeats: newDurBeats }
                    // If we know the buffer length, also write trimEnd so the crop is permanent
                    if (isAudioClip(clip) && clip.bufferDuration) {
                      const newDurSec = engine.beatsToSeconds(newDurBeats)
                      patch.trimEnd   = Math.max(0, clip.bufferDuration - clip.trimStart - newDurSec)
                    }
                    dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch })
                  }}
                  onCrop={() => { if (isAudioClip(clip)) setCropTarget(clip) }}
                  onIsolate={beat => setIsolateTgt(beat)}
                  onDelete={() => dispatch({ type: 'REMOVE_CLIP', clipId: clip.id })}
                />
              )
            })}
            {/* Repeat handle — appears at the right edge of the rightmost selected clip in this track */}
            {(() => {
              const sel = clips.filter(c => selectedClipIds.has(c.id))
              if (sel.length === 0) return null
              const rightmost = sel.reduce((a, b) => (a.startBeat + a.durationBeats >= b.startBeat + b.durationBeats ? a : b))
              const handleX   = (rightmost.startBeat + rightmost.durationBeats) * beatW + 2
              return (
                <div
                  title="Repeat selection"
                  style={{
                    position: 'absolute', left: handleX, top: '50%', transform: 'translateY(-50%)',
                    width: 18, height: 18, borderRadius: 9, background: '#3d8fef',
                    color: '#fff', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: 'pointer', zIndex: 10, userSelect: 'none', boxShadow: '0 1px 4px rgba(0,0,0,0.5)',
                  }}
                  onClick={e => {
                    e.stopPropagation()
                    const allSelected = project.arrangementClips.filter(c => selectedClipIds.has(c.id))
                    if (allSelected.length === 0) return
                    const selStart = Math.min(...allSelected.map(c => c.startBeat))
                    const selEnd   = Math.max(...allSelected.map(c => c.startBeat + c.durationBeats))
                    const span     = selEnd - selStart
                    if (span <= 0) return
                    const newIds = new Set<string>()
                    for (const c of allSelected) {
                      const newClip = { ...c, id: crypto.randomUUID(), startBeat: c.startBeat + span }
                      dispatch({ type: 'ADD_CLIP', clip: newClip })
                      newIds.add(newClip.id)
                    }
                    setSelectedClipIds(newIds)
                  }}
                >»</div>
              )
            })()}
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

      {/* Effects lane */}
      {showFx && (
        <div style={{ display: 'flex', height: EFFECT_H, flexShrink: 0 }}>
          {/* Left header */}
          <div style={{ width: HDR_W, height: EFFECT_H, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6, padding: '0 8px', background: 'rgba(0,0,0,0.3)', borderRight: '1px solid var(--border)', borderBottom: '1px solid var(--border)', borderLeft: `3px solid ${track.color}`, boxSizing: 'border-box' }}>
            <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: 1, textTransform: 'uppercase' }}>FX</span>
            <span style={{ fontSize: 9, color: 'var(--text-muted)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {(project.clipEffects ?? []).filter(e => e.trackId === track.id).length === 0
                ? 'right-click lane to add'
                : (project.clipEffects ?? []).filter(e => e.trackId === track.id).map(e => e.type).join(', ')}
            </span>
          </div>
          {/* Lane */}
          <EffectLaneView
            trackId={track.id}
            beatW={beatW}
            scrollLeft={scrollLeft}
            viewWidth={viewWidth}
          />
        </div>
      )}

      {cropTarget && <ClipCropModal clip={cropTarget} onClose={() => setCropTarget(null)} />}
      {isolateTgt !== null && (
        <IsolateModal
          trackId={track.id}
          initialBeat={isolateTgt}
          onClose={() => setIsolateTgt(null)}
        />
      )}
    </div>
  )
}

// ── Arrangement View ──────────────────────────────────────────────────────────

export default function ArrangementView() {
  const { project, dispatch, engine, setPosition } = useDaw()
  const [beatW, setBeatW]           = useState(40)
  const [scrollLeft, setScrollLeft] = useState(0)
  const [snap, setSnap]             = useState<SnapMode>('1/16')
  const [tsPopover, setTsPopover]   = useState<{ x: number; y: number } | null>(null)
  const [tsDraftNum, setTsDraftNum] = useState(project.timeSignatureNum)
  const [tsDraftDen, setTsDraftDen] = useState(project.timeSignatureDen)
  const outerRef      = useRef<HTMLDivElement>(null)
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

  // Close time-sig popover on outside click
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
      </div>

      {/* Ruler row (ruler area only — headers handled inside TrackRow) */}
      <div style={{ display: 'flex', flexShrink: 0 }} onWheel={handleWheel}>
        <div style={{ width: HDR_W, height: RULER_H, flexShrink: 0, background: 'var(--bg-surface)', borderRight: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }} />
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <Ruler beatW={beatW} scrollLeft={scrollLeft} snap={snap} onSeek={b => { engine.seek(b); setPosition(b) }} onEditTimeSig={handleEditTimeSig} />
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
