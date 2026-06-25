'use client'

import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useDaw } from '@/lib/daw-state'
import type { ClipEffect, ClipEffectType } from '@/lib/daw-types'
import ShapeModal from './ShapeModal'
import EffectEditor from './EffectEditor'

export const EFFECT_H = 40

const EFFECT_COLORS: Record<ClipEffectType, string> = {
  volume:     '#22c55e',
  reverb:     '#3b82f6',
  delay:      '#06b6d4',
  filter:     '#eab308',
  tremolo:    '#a855f7',
  distortion: '#ef4444',
  pitch:      '#f97316',
}

const EFFECT_DEFAULTS: Record<ClipEffectType, ClipEffect['params']> = {
  volume:     { gain: 1.4 },
  reverb:     { reverbWet: 0.4, reverbDecay: 2 },
  delay:      { delayTime: 0.375, feedback: 0.4, delayWet: 0.3 },
  filter:     { frequency: 800, filterType: 'lowpass', filterQ: 1 },
  tremolo:    { tremoloRate: 4, tremoloDepth: 0.6 },
  distortion: { distortion: 0.5 },
  pitch:      { semitones: 0 },
}

const SHAPEABLE: Partial<Record<ClipEffectType, 'volume' | 'pitch'>> = {
  volume: 'volume',
  pitch:  'pitch',
}

const EFFECT_TYPES: ClipEffectType[] = ['volume', 'pitch', 'reverb', 'delay', 'filter', 'tremolo', 'distortion']

// ── Param editor popover ──────────────────────────────────────────────────────

function EffectParamEditor({ effect, onClose }: { effect: ClipEffect; onClose: () => void }) {
  const { dispatch } = useDaw()
  function set(key: string, val: number) {
    dispatch({ type: 'UPDATE_CLIP_EFFECT', effectId: effect.id, patch: { params: { [key]: val } } })
  }
  function Slider({ label, k, min, max, log = false }: { label: string; k: string; min: number; max: number; log?: boolean }) {
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
        {effect.type === 'pitch'      && <Slider label="Semitones" k="semitones" min={-24} max={24} />}
        {effect.automation?.points.length ? (
          <div style={{ fontSize: 9, color: EFFECT_COLORS[effect.type], marginTop: 2 }}>
            automation: {effect.automation.points.length} pts  (dbl-click clip to edit)
          </div>
        ) : effect.params.shapeEnvelope ? (
          <div style={{ fontSize: 9, color: EFFECT_COLORS[effect.type], marginTop: 2 }}>
            ~ shape active · {effect.params.shapeEnvelope.length} frames
          </div>
        ) : null}
      </div>
    </div>
  )
}

// ── Mini waveform canvas (for volume clips with shapeEnvelope) ────────────────

function ClipWaveform({ env, color }: { env: number[]; color: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current; if (!canvas) return
    const W = canvas.offsetWidth, H = canvas.offsetHeight
    if (!W || !H) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = W * dpr; canvas.height = H * dpr
    const ctx = canvas.getContext('2d')!
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, W, H)
    ctx.fillStyle = `${color}40`
    ctx.strokeStyle = `${color}90`
    ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(0, H)
    for (let i = 0; i < env.length; i++) {
      ctx.lineTo((i / (env.length - 1)) * W, H - env[i] * H * 0.88)
    }
    ctx.lineTo(W, H); ctx.closePath(); ctx.fill()
    ctx.beginPath()
    for (let i = 0; i < env.length; i++) {
      const x = (i / (env.length - 1)) * W, y = H - env[i] * H * 0.88
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
    }
    ctx.stroke()
  })
  return (
    <canvas
      ref={ref}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', borderRadius: 2 }}
    />
  )
}

// ── Automation curve preview (for clips with automation points) ───────────────

function AutomationPreview({ effect, width, color }: { effect: ClipEffect; width: number; color: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current; if (!canvas || !effect.automation?.points.length) return
    const H = canvas.offsetHeight
    if (!width || !H) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = width * dpr; canvas.height = H * dpr
    const ctx = canvas.getContext('2d')!
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, width, H)

    const pts    = [...effect.automation.points].sort((a, b) => a.t - b.t)
    const dur    = effect.durationBeats
    const toX    = (t: number) => (t / dur) * width
    const toY    = (v: number) => H - v * H * 0.88

    ctx.strokeStyle = `${color}80`; ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(0, toY(pts[0].v))
    ctx.lineTo(toX(pts[0].t), toY(pts[0].v))
    for (let i = 0; i < pts.length - 1; i++) {
      const p = pts[i], q = pts[i + 1]
      const qx = toX(q.t), qy = toY(q.v)
      if (p.smooth || q.smooth) {
        ctx.bezierCurveTo(
          toX(p.t + (p.smooth ? p.h2[0] : 0)), toY(p.v + (p.smooth ? p.h2[1] : 0)),
          toX(q.t + (q.smooth ? q.h1[0] : 0)), toY(q.v + (q.smooth ? q.h1[1] : 0)),
          qx, qy,
        )
      } else {
        ctx.lineTo(qx, qy)
      }
    }
    ctx.lineTo(width, toY(pts[pts.length - 1].v))
    ctx.stroke()

    for (const pt of pts) {
      ctx.fillStyle = color
      ctx.beginPath(); ctx.arc(toX(pt.t), toY(pt.v), 2.5, 0, Math.PI * 2); ctx.fill()
    }
  })
  return (
    <canvas
      ref={ref}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', borderRadius: 2 }}
    />
  )
}

// ── Single FX row ─────────────────────────────────────────────────────────────

function EffectRow({
  rowIndex, trackId, beatW, scrollLeft, viewWidth,
  effects, isLast,
  expandedEffectId,
  onEditTarget, onCtxMenu, onShapeTarget, onExpand,
}: {
  rowIndex: number
  trackId: string
  beatW: number
  scrollLeft: number
  viewWidth: number
  effects: ClipEffect[]
  isLast: boolean
  expandedEffectId: string | null
  onEditTarget: (t: { effect: ClipEffect; x: number; y: number }) => void
  onCtxMenu: (t: { effect: ClipEffect; x: number; y: number }) => void
  onShapeTarget: (t: { effect: ClipEffect; mode: 'volume' | 'pitch' }) => void
  onExpand: (eff: ClipEffect | null) => void
}) {
  const { dispatch } = useDaw()
  const dragRef    = useRef<{ effectId: string; startX: number; startBeat: number } | null>(null)
  const resizeRef  = useRef<{ effectId: string; startX: number; startDur: number } | null>(null)
  const clickTimer = useRef<{ effectId: string; timer: ReturnType<typeof setTimeout> } | null>(null)

  const viewStartBeat = scrollLeft / beatW
  const viewEndBeat   = viewStartBeat + viewWidth / beatW
  const rowEffects    = effects.filter(e => (e.row ?? 0) === rowIndex)
  const expandedInRow = rowEffects.find(e => e.id === expandedEffectId) ?? null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
      {/* Clip row */}
      <div
        style={{
          height: EFFECT_H, position: 'relative', flexShrink: 0,
          background: rowIndex % 2 === 0 ? 'rgba(0,0,0,0.35)' : 'rgba(0,0,0,0.25)',
          borderBottom: isLast && !expandedInRow ? 'none' : '1px solid rgba(255,255,255,0.04)',
          overflow: 'hidden',
        }}
      >
        {/* Beat grid */}
        {Array.from({ length: Math.ceil(viewEndBeat) - Math.floor(viewStartBeat) + 1 }, (_, i) => Math.floor(viewStartBeat) + i).map(b => {
          const x = b * beatW - scrollLeft
          return x >= 0 && x <= viewWidth ? (
            <div key={b} style={{ position: 'absolute', left: x, top: 0, bottom: 0, width: 1, background: 'rgba(255,255,255,0.04)', pointerEvents: 'none' }} />
          ) : null
        })}

        {/* Effect clips */}
        <div style={{ position: 'absolute', top: 0, bottom: 0, left: -scrollLeft, width: (viewEndBeat + 10) * beatW }}>
          {rowEffects.map(eff => {
            if (eff.startBeat + eff.durationBeats < viewStartBeat || eff.startBeat > viewEndBeat) return null
            const left  = eff.startBeat * beatW
            const width = Math.max(8, eff.durationBeats * beatW)
            const color = EFFECT_COLORS[eff.type]
            const isExpanded = eff.id === expandedEffectId

            return (
              <div key={eff.id}
                style={{
                  position: 'absolute', left, width, top: 3, bottom: 3,
                  background: isExpanded ? `${color}50` : `${color}30`,
                  border: `1px solid ${isExpanded ? color : color + '99'}`,
                  borderRadius: 3, overflow: 'hidden', cursor: 'grab', userSelect: 'none',
                }}
                onMouseDown={e => {
                  if (e.button !== 0) return
                  e.stopPropagation()
                  dragRef.current = { effectId: eff.id, startX: e.clientX, startBeat: eff.startBeat }
                  function mm(ev: MouseEvent) {
                    if (!dragRef.current) return
                    dispatch({ type: 'UPDATE_CLIP_EFFECT', effectId: dragRef.current.effectId, patch: { startBeat: Math.max(0, dragRef.current.startBeat + (ev.clientX - dragRef.current.startX) / beatW) } })
                  }
                  function mu() { dragRef.current = null; document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu) }
                  document.addEventListener('mousemove', mm); document.addEventListener('mouseup', mu)
                }}
                onClick={e => {
                  e.stopPropagation()
                  if (clickTimer.current?.effectId === eff.id) return
                  const timer = setTimeout(() => {
                    clickTimer.current = null
                    onEditTarget({ effect: eff, x: e.clientX, y: e.clientY })
                  }, 220)
                  clickTimer.current = { effectId: eff.id, timer }
                }}
                onDoubleClick={e => {
                  e.stopPropagation()
                  if (clickTimer.current) { clearTimeout(clickTimer.current.timer); clickTimer.current = null }
                  onExpand(isExpanded ? null : eff)
                }}
                onContextMenu={e => { e.preventDefault(); e.stopPropagation(); onCtxMenu({ effect: eff, x: e.clientX, y: e.clientY }) }}
              >
                {/* Mini waveform: volume shapeEnvelope */}
                {eff.type === 'volume' && eff.params.shapeEnvelope?.length && !eff.automation?.points.length && (
                  <ClipWaveform env={eff.params.shapeEnvelope} color={color} />
                )}
                {/* Automation curve preview */}
                {eff.automation?.points.length ? (
                  <AutomationPreview effect={eff} width={width - 2} color={color} />
                ) : null}
                <span style={{ position: 'absolute', top: 3, left: 4, fontSize: 8, color, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', pointerEvents: 'none', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', maxWidth: width - 16, zIndex: 1 }}>
                  {eff.type}{eff.automation?.points.length ? ' ⟳' : eff.params.shapeEnvelope ? ' ~' : ''}
                </span>
                <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 5, cursor: 'ew-resize', zIndex: 2 }}
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
      </div>

      {/* Expanded automation editor */}
      {expandedInRow && (
        <EffectEditor
          effect={expandedInRow}
          beatW={beatW}
          scrollLeft={scrollLeft}
          onClose={() => onExpand(null)}
        />
      )}
    </div>
  )
}

// ── Lane (all rows) ───────────────────────────────────────────────────────────

export default function EffectLaneView({
  trackId, beatW, scrollLeft, viewWidth,
}: { trackId: string; beatW: number; scrollLeft: number; viewWidth: number }) {
  const { project, dispatch } = useDaw()
  const effects = (project.clipEffects ?? []).filter(e => e.trackId === trackId)

  const [numRows,        setNumRows]        = useState(1)
  const [addMenu,        setAddMenu]        = useState<{ x: number; y: number; beat: number; row: number } | null>(null)
  const [editTarget,     setEditTarget]     = useState<{ effect: ClipEffect; x: number; y: number } | null>(null)
  const [ctxMenu,        setCtxMenu]        = useState<{ effect: ClipEffect; x: number; y: number } | null>(null)
  const [shapeTarget,    setShapeTarget]    = useState<{ effect: ClipEffect; mode: 'volume' | 'pitch' } | null>(null)
  const [expandedEffectId, setExpandedEffectId] = useState<string | null>(null)
  const laneRef = useRef<HTMLDivElement>(null)

  function beatFromClientX(clientX: number) {
    const rect = laneRef.current?.getBoundingClientRect()
    if (!rect) return 0
    return (clientX - rect.left + scrollLeft) / beatW
  }

  function addEffect(type: ClipEffectType, beat: number, row: number) {
    const effect: ClipEffect = {
      id: crypto.randomUUID(),
      trackId,
      type,
      startBeat: Math.max(0, beat),
      durationBeats: 4,
      row,
      params: { ...EFFECT_DEFAULTS[type] },
    }
    dispatch({ type: 'ADD_CLIP_EFFECT', effect })
  }

  return (
    <div
      ref={laneRef}
      style={{ flex: 1, display: 'flex', flexDirection: 'column', cursor: 'crosshair', overflow: 'hidden', borderBottom: '1px solid var(--border)' }}
      onClick={() => { setAddMenu(null); setEditTarget(null) }}
      onContextMenu={e => {
        e.preventDefault()
        const rect = laneRef.current?.getBoundingClientRect()
        const row  = rect ? Math.floor((e.clientY - rect.top) / EFFECT_H) : 0
        setAddMenu({ x: e.clientX, y: e.clientY, beat: beatFromClientX(e.clientX), row: Math.min(row, numRows - 1) })
      }}
    >
      {Array.from({ length: numRows }, (_, rowIndex) => (
        <EffectRow
          key={rowIndex}
          rowIndex={rowIndex}
          trackId={trackId}
          beatW={beatW}
          scrollLeft={scrollLeft}
          viewWidth={viewWidth}
          effects={effects}
          isLast={rowIndex === numRows - 1}
          expandedEffectId={expandedEffectId}
          onEditTarget={t => { setCtxMenu(null); setEditTarget(t) }}
          onCtxMenu={t => { setEditTarget(null); setCtxMenu(t) }}
          onShapeTarget={setShapeTarget}
          onExpand={eff => setExpandedEffectId(eff?.id ?? null)}
        />
      ))}

      {/* Right-click dropdown */}
      {addMenu && createPortal(
        <div
          style={{ position: 'fixed', zIndex: 1500, left: addMenu.x, top: addMenu.y, background: '#1e1e2e', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 0', minWidth: 160, boxShadow: '0 4px 20px rgba(0,0,0,0.6)' }}
          onMouseLeave={() => setAddMenu(null)}
        >
          <button
            onClick={() => { setNumRows(n => n + 1); setAddMenu(null) }}
            style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', padding: '5px 12px', fontSize: 11, cursor: 'pointer', background: 'transparent', border: 'none', color: 'var(--text-primary)', fontWeight: 600 }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
          >
            <span style={{ fontSize: 12, lineHeight: 1 }}>+</span> Add FX Bar
          </button>

          <div style={{ borderTop: '1px solid var(--border)', margin: '4px 0' }} />

          <div style={{ fontSize: 9, color: 'var(--text-muted)', padding: '2px 12px 4px', letterSpacing: 0.5, textTransform: 'uppercase' }}>Add Effect</div>
          {EFFECT_TYPES.map(t => (
            <button key={t}
              onClick={() => { addEffect(t, addMenu.beat, addMenu.row); setAddMenu(null) }}
              style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', padding: '5px 12px', fontSize: 11, cursor: 'pointer', background: 'transparent', border: 'none', color: 'var(--text-primary)' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
            >
              <span style={{ width: 8, height: 8, borderRadius: 2, background: EFFECT_COLORS[t], flexShrink: 0 }} />
              <span style={{ textTransform: 'capitalize' }}>{t}</span>
            </button>
          ))}
        </div>,
        document.body
      )}

      {/* Param editor popover */}
      {editTarget && createPortal(
        <div style={{ position: 'fixed', zIndex: 1500, left: editTarget.x, top: editTarget.y + 8 }}>
          <EffectParamEditor effect={editTarget.effect} onClose={() => setEditTarget(null)} />
        </div>,
        document.body
      )}

      {/* Effect right-click context menu */}
      {ctxMenu && createPortal(
        <div
          style={{ position: 'fixed', zIndex: 1500, left: ctxMenu.x, top: ctxMenu.y, background: '#1e1e2e', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 0', minWidth: 160, boxShadow: '0 4px 20px rgba(0,0,0,0.6)' }}
          onMouseLeave={() => setCtxMenu(null)}
        >
          {SHAPEABLE[ctxMenu.effect.type] && (
            <button
              onClick={() => { setShapeTarget({ effect: ctxMenu.effect, mode: SHAPEABLE[ctxMenu.effect.type]! }); setCtxMenu(null) }}
              style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', padding: '5px 12px', fontSize: 11, cursor: 'pointer', background: 'transparent', border: 'none', color: 'var(--text-primary)' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
            >
              <span style={{ fontSize: 9 }}>~</span>
              Shape {ctxMenu.effect.type === 'volume' ? 'Volume' : 'Pitch'}
              {ctxMenu.effect.params.shapeEnvelope && <span style={{ fontSize: 8, color: EFFECT_COLORS[ctxMenu.effect.type], marginLeft: 4 }}>●</span>}
            </button>
          )}
          <button
            onClick={() => { setExpandedEffectId(ctxMenu.effect.id); setCtxMenu(null) }}
            style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', padding: '5px 12px', fontSize: 11, cursor: 'pointer', background: 'transparent', border: 'none', color: 'var(--text-primary)' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
          >
            Edit Automation
          </button>
          <button
            onClick={() => { setEditTarget({ effect: ctxMenu.effect, x: ctxMenu.x, y: ctxMenu.y }); setCtxMenu(null) }}
            style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', padding: '5px 12px', fontSize: 11, cursor: 'pointer', background: 'transparent', border: 'none', color: 'var(--text-primary)' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
          >
            Edit Params
          </button>
          <div style={{ borderTop: '1px solid var(--border)', margin: '4px 0' }} />
          <button
            onClick={() => { dispatch({ type: 'REMOVE_CLIP_EFFECT', effectId: ctxMenu.effect.id }); setCtxMenu(null) }}
            style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', padding: '5px 12px', fontSize: 11, cursor: 'pointer', background: 'transparent', border: 'none', color: '#ef4444' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
          >
            Delete
          </button>
        </div>,
        document.body
      )}

      {shapeTarget && (
        <ShapeModal effect={shapeTarget.effect} mode={shapeTarget.mode} onClose={() => setShapeTarget(null)} />
      )}
    </div>
  )
}
