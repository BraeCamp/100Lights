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

// ── Note name helpers ─────────────────────────────────────────────────────────

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

function hzToNoteName(hz: number): string {
  const midi = 69 + 12 * Math.log2(hz / 440)
  const rounded = Math.round(midi)
  const name = NOTE_NAMES[((rounded % 12) + 12) % 12]
  const octave = Math.floor(rounded / 12) - 1
  return `${name}${octave}`
}

// ── Param editor popover ──────────────────────────────────────────────────────

// Hoisted so its identity is stable across renders — defined inside the
// editor it remounted on every param dispatch, which broke slider drags.
function FxSlider({ label, raw, min, max, log = false, color, onSet }: {
  label: string; raw: number; min: number; max: number; log?: boolean; color: string
  onSet: (v: number) => void
}) {
  const normalized = log
    ? (Math.log(raw / min) / Math.log(max / min))
    : ((raw - min) / (max - min))
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
      <span style={{ width: 60, flexShrink: 0 }}>{label}</span>
      <input type="range" min={0} max={1} step={0.001} value={normalized}
        onChange={e => {
          const n = parseFloat(e.target.value)
          onSet(log ? min * Math.pow(max / min, n) : min + n * (max - min))
        }}
        style={{ flex: 1, accentColor: color }} />
      <span style={{ width: 40, fontFamily: 'monospace', textAlign: 'right', color: 'var(--text-primary)', fontSize: 9 }}>
        {raw.toFixed(raw < 10 ? 2 : 0)}
      </span>
    </label>
  )
}

function EffectParamEditor({ effect: effectAtOpen, onClose }: { effect: ClipEffect; onClose: () => void }) {
  const { dispatch, project } = useDaw()
  // The open-time object goes stale as sliders dispatch — read the live one
  const effect = project.clipEffects?.find(e => e.id === effectAtOpen.id) ?? effectAtOpen
  const [liveSemitones, setLiveSemitones] = useState(
    (effect.params as Record<string, number>).semitones ?? 0
  )
  function set(key: string, val: number) {
    if (key === 'semitones') setLiveSemitones(val)
    dispatch({ type: 'UPDATE_CLIP_EFFECT', effectId: effect.id, patch: { params: { [key]: val } } })
  }
  const params = effect.params as Record<string, number>
  // plain function call (not JSX component) — a render-scoped component
  // type would remount the input on every dispatch and break drags
  const slider = (label: string, k: string, min: number, max: number, log = false) => (
    <FxSlider key={k} label={label} raw={params[k] ?? (min + max) / 2} min={min} max={max} log={log}
      color={EFFECT_COLORS[effect.type]} onSet={v => set(k, v)} />
  )

  return (
    <div style={{ background: '#1e1e2e', border: `1px solid ${EFFECT_COLORS[effect.type]}`, borderRadius: 6, padding: '10px 12px', minWidth: 220, boxShadow: '0 4px 20px rgba(0,0,0,0.6)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: EFFECT_COLORS[effect.type], textTransform: 'capitalize' }}>{effect.type}</span>
        <button onClick={onClose} style={{ fontSize: 9, background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>✕</button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {effect.type === 'volume'     && slider('Volume', 'gain', 0, 2)}
        {effect.type === 'reverb'     && <>{slider('Wet', 'reverbWet', 0, 1)}{slider('Decay', 'reverbDecay', 0.3, 5)}</>}
        {effect.type === 'delay'      && <>{slider('Time', 'delayTime', 0.05, 2)}{slider('Feedback', 'feedback', 0, 0.95)}{slider('Wet', 'delayWet', 0, 1)}</>}
        {effect.type === 'filter'     && <>{slider('Freq', 'frequency', 40, 18000, true)}{slider('Q', 'filterQ', 0.1, 20, true)}</>}
        {effect.type === 'tremolo'    && <>{slider('Rate', 'tremoloRate', 0.1, 15)}{slider('Depth', 'tremoloDepth', 0, 1)}</>}
        {effect.type === 'distortion' && slider('Amount', 'distortion', 0, 1)}
        {effect.type === 'pitch'      && (
          <>
            {slider('Semitones', 'semitones', -24, 24)}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10, color: 'var(--text-muted)', paddingTop: 2 }}>
              <span style={{ width: 60, flexShrink: 0 }}>Note</span>
              <span style={{ fontFamily: 'monospace', fontSize: 9 }}>A4</span>
              <span style={{ fontSize: 9 }}>→</span>
              <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 12, color: EFFECT_COLORS.pitch }}>
                {hzToNoteName(440 * Math.pow(2, liveSemitones / 12))}
              </span>
            </div>
          </>
        )}
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
        // Control x clamped inside the segment — matches EffectEditor and the
        // engine's evaluation, so the preview can't run backwards in time
        const c1t = Math.min(q.t, Math.max(p.t, p.t + (p.smooth ? p.h2[0] : 0)))
        const c2t = Math.min(q.t, Math.max(p.t, q.t + (q.smooth ? q.h1[0] : 0)))
        ctx.bezierCurveTo(
          toX(c1t), toY(p.v + (p.smooth ? p.h2[1] : 0)),
          toX(c2t), toY(q.v + (q.smooth ? q.h1[1] : 0)),
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
  selectedEffectIds,
  onSelect,
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
  selectedEffectIds: Set<string>
  onSelect: (id: string, shift: boolean) => void
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

            const isSelected = selectedEffectIds.has(eff.id)
            return (
              <div key={eff.id}
                data-effect-id={eff.id}
                style={{
                  position: 'absolute', left, width, top: 3, bottom: 3,
                  background: isExpanded ? `${color}50` : isSelected ? `${color}45` : `${color}30`,
                  border: `1px solid ${isExpanded ? color : isSelected ? '#fff' : color + '99'}`,
                  borderRadius: 3, overflow: 'hidden', cursor: 'grab', userSelect: 'none',
                  boxShadow: isSelected ? `0 0 0 1px ${color}80` : undefined,
                }}
                onMouseDown={e => {
                  if (e.button !== 0) return
                  e.stopPropagation()
                  onSelect(eff.id, e.shiftKey || e.altKey)
                  // If already selected and multiple are selected, drag all selected; else just this one
                  const dragIds = (selectedEffectIds.has(eff.id) && selectedEffectIds.size > 1)
                    ? [...selectedEffectIds]
                    : [eff.id]
                  const origins: Record<string, number> = {}
                  for (const id of dragIds) {
                    const e2 = effects.find(x => x.id === id)
                    if (e2) origins[id] = e2.startBeat
                  }
                  dragRef.current = { effectId: eff.id, startX: e.clientX, startBeat: eff.startBeat }
                  function mm(ev: MouseEvent) {
                    if (!dragRef.current) return
                    const dx = (ev.clientX - dragRef.current.startX) / beatW
                    for (const id of dragIds) {
                      const orig = origins[id] ?? 0
                      dispatch({ type: 'UPDATE_CLIP_EFFECT', effectId: id, patch: { startBeat: Math.max(0, orig + dx) } })
                    }
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
                onContextMenu={e => { e.preventDefault(); e.stopPropagation(); onSelect(eff.id, false); onCtxMenu({ effect: eff, x: e.clientX, y: e.clientY }) }}
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
  trackId, beatW, scrollLeft, viewWidth, onCopyEffects, onPasteEffects,
}: { trackId: string; beatW: number; scrollLeft: number; viewWidth: number; onCopyEffects?: (ids: Set<string>) => void; onPasteEffects?: () => void }) {
  const { project, dispatch, selectedEffectIds, setSelectedEffectIds, setSelectedClipIds, setSelectedClipId } = useDaw()
  const effects = (project.clipEffects ?? []).filter(e => e.trackId === trackId)

  const [numRows,          setNumRows]          = useState(1)
  const [addMenu,          setAddMenu]          = useState<{ x: number; y: number; beat: number; row: number } | null>(null)
  const [editTarget,       setEditTarget]       = useState<{ effect: ClipEffect; x: number; y: number } | null>(null)
  const [ctxMenu,          setCtxMenu]          = useState<{ effect: ClipEffect; x: number; y: number } | null>(null)

  // Menus are portals with no backdrop — close them on outside clicks and Escape.
  useEffect(() => {
    if (!addMenu && !ctxMenu) return
    const onPointerDown = (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest?.('[data-fx-menu]')) return
      setAddMenu(null); setCtxMenu(null)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setAddMenu(null); setCtxMenu(null) }
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [addMenu, ctxMenu])

  const [shapeTarget,      setShapeTarget]      = useState<{ effect: ClipEffect; mode: 'volume' | 'pitch' } | null>(null)
  const [expandedEffectId, setExpandedEffectId] = useState<string | null>(null)
  const [rubberBand,       setRubberBand]       = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null)
  const laneRef = useRef<HTMLDivElement>(null)
  const editPopRef = useRef<HTMLDivElement>(null)

  // The param-slider popup dismisses on any click outside it (or Escape) —
  // not just clicks inside this lane.
  useEffect(() => {
    if (!editTarget) return
    function onDown(e: MouseEvent) {
      if (editPopRef.current?.contains(e.target as Node)) return
      setEditTarget(null)
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setEditTarget(null) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [editTarget])

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

  function selectEffect(effId: string, shift: boolean) {
    setSelectedClipIds(new Set())
    setSelectedClipId(null)
    if (shift) {
      setSelectedEffectIds(prev => {
        const next = new Set(prev)
        if (next.has(effId)) next.delete(effId)
        else next.add(effId)
        return next
      })
    } else {
      setSelectedEffectIds(new Set([effId]))
    }
  }

  function onLaneMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    if (e.button !== 0) return
    // If clicking on an effect clip itself, don't start rubber-band
    if ((e.target as HTMLElement).closest('[data-effect-id]')) return
    const sx = e.clientX, sy = e.clientY
    setRubberBand({ x1: sx, y1: sy, x2: sx, y2: sy })
    function onMove(ev: MouseEvent) { setRubberBand({ x1: sx, y1: sy, x2: ev.clientX, y2: ev.clientY }) }
    function onUp(ev: MouseEvent) {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      setRubberBand(null)
      const dx = Math.abs(ev.clientX - sx), dy = Math.abs(ev.clientY - sy)
      if (dx < 5 && dy < 5) { if (!e.shiftKey) { setSelectedEffectIds(new Set()) }; return }
      const selL = Math.min(sx, ev.clientX), selR = Math.max(sx, ev.clientX)
      const selT = Math.min(sy, ev.clientY), selB = Math.max(sy, ev.clientY)
      const rect = laneRef.current?.getBoundingClientRect()
      if (!rect) return
      const newIds = new Set<string>()
      for (const eff of effects) {
        const effLeft  = rect.left + eff.startBeat * beatW - scrollLeft
        const effRight = effLeft + Math.max(8, eff.durationBeats * beatW)
        const effRow   = eff.row ?? 0
        const effTop   = rect.top + effRow * EFFECT_H + 3
        const effBot   = effTop + EFFECT_H - 6
        if (effRight < selL || effLeft > selR || effBot < selT || effTop > selB) continue
        newIds.add(eff.id)
      }
      setSelectedClipIds(new Set())
      setSelectedClipId(null)
      if (e.shiftKey) setSelectedEffectIds(prev => new Set([...prev, ...newIds]))
      else setSelectedEffectIds(newIds)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  return (
    <>
    <div
      ref={laneRef}
      style={{ flex: 1, display: 'flex', flexDirection: 'column', cursor: 'crosshair', overflow: 'hidden', borderBottom: '1px solid var(--border)', position: 'relative' }}
      onClick={() => { setAddMenu(null); setEditTarget(null) }}
      onMouseDown={onLaneMouseDown}
      onContextMenu={e => {
        // Only open add-menu when not right-clicking on an effect
        if ((e.target as HTMLElement).closest('[data-effect-id]')) return
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
          selectedEffectIds={selectedEffectIds}
          onSelect={selectEffect}
          onEditTarget={t => { setCtxMenu(null); setEditTarget(t) }}
          onCtxMenu={t => { setEditTarget(null); setCtxMenu(t) }}
          onShapeTarget={setShapeTarget}
          onExpand={eff => setExpandedEffectId(eff?.id ?? null)}
        />
      ))}

      {/* Rubber-band */}
      {rubberBand && (
        <div style={{
          position: 'fixed',
          left: Math.min(rubberBand.x1, rubberBand.x2),
          top:  Math.min(rubberBand.y1, rubberBand.y2),
          width:  Math.abs(rubberBand.x2 - rubberBand.x1),
          height: Math.abs(rubberBand.y2 - rubberBand.y1),
          border: '1px solid rgb(var(--accent-rgb) / 0.7)',
          background: 'rgb(var(--accent-rgb) / 0.08)',
          pointerEvents: 'none',
          zIndex: 200,
        }} />
      )}

      {/* Right-click dropdown */}
      {addMenu && createPortal(
        <div
          data-fx-menu
          onClick={e => e.stopPropagation()}
          onMouseDown={e => e.stopPropagation()}
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
        // React portals bubble events through the REACT tree — without the
        // stops below, any click inside the popup reaches the lane's onClick,
        // which closes the editor mid-adjustment.
        <div ref={editPopRef} onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()} style={{ position: 'fixed', zIndex: 1500, left: editTarget.x, top: editTarget.y + 8 }}>
          <EffectParamEditor effect={editTarget.effect} onClose={() => setEditTarget(null)} />
        </div>,
        document.body
      )}

      {/* Effect right-click context menu */}
      {ctxMenu && createPortal(
        <div
          data-fx-menu
          onClick={e => e.stopPropagation()}
          onMouseDown={e => e.stopPropagation()}
          style={{ position: 'fixed', zIndex: 1500, left: ctxMenu.x, top: ctxMenu.y, background: '#1e1e2e', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 0', minWidth: 160, boxShadow: '0 4px 20px rgba(0,0,0,0.6)' }}
          onMouseLeave={() => setCtxMenu(null)}
        >
          {/* Copy / Paste */}
          {(() => {
            const ctxId = ctxMenu.effect.id
            const copyIds = selectedEffectIds.has(ctxId) && selectedEffectIds.size > 1
              ? selectedEffectIds
              : new Set([ctxId])
            const copyLabel = copyIds.size > 1 ? `Copy Selected (${copyIds.size})` : 'Copy'
            return (
              <>
                <button
                  onClick={() => { onCopyEffects?.(copyIds); setCtxMenu(null) }}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', padding: '5px 12px', fontSize: 11, cursor: 'pointer', background: 'transparent', border: 'none', color: 'var(--text-primary)' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                >{copyLabel}</button>
                {onPasteEffects && (
                  <button
                    onClick={() => { onPasteEffects(); setCtxMenu(null) }}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', padding: '5px 12px', fontSize: 11, cursor: 'pointer', background: 'transparent', border: 'none', color: 'var(--text-primary)' }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                  >Paste</button>
                )}
                <div style={{ borderTop: '1px solid var(--border)', margin: '4px 0' }} />
              </>
            )
          })()}

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
            onClick={() => {
              const toDelete = selectedEffectIds.has(ctxMenu.effect.id) && selectedEffectIds.size > 1
                ? [...selectedEffectIds]
                : [ctxMenu.effect.id]
              for (const id of toDelete) dispatch({ type: 'REMOVE_CLIP_EFFECT', effectId: id })
              setSelectedEffectIds(new Set())
              setCtxMenu(null)
            }}
            style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', padding: '5px 12px', fontSize: 11, cursor: 'pointer', background: 'transparent', border: 'none', color: '#ef4444' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
          >
            {selectedEffectIds.has(ctxMenu.effect.id) && selectedEffectIds.size > 1 ? `Delete Selected (${selectedEffectIds.size})` : 'Delete'}
          </button>
        </div>,
        document.body
      )}

      {shapeTarget && (
        <ShapeModal effect={shapeTarget.effect} mode={shapeTarget.mode} onClose={() => setShapeTarget(null)} />
      )}
    </div>
    </>
  )
}
