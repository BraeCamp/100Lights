'use client'
// 10 LFOs: drawable point editor (grid snap, per-segment curvature), path
// mode (2D X/Y output), chaos mode (Lorenz/Rossler/S&H) with live scope.

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useApollo, useMeters, Knob, Sel, ToggleBtn, UI } from './ApolloContext'
import { LfoPoint, SYNC_RATES, ChaosType, LfoTrigMode } from '@/lib/apollo/patch'

const GRID_OPTS = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32]

function curveShape(t: number, c: number): number {
  if (c === 0) return t
  const k = Math.pow(4, Math.abs(c) * 2)
  return c > 0 ? Math.pow(t, k) : 1 - Math.pow(1 - t, k)
}

function evalPoints(pts: LfoPoint[], x: number): number {
  if (!pts.length) return 0.5
  if (x <= pts[0].x) return pts[0].y
  for (let s = 0; s < pts.length - 1; s++) {
    const p0 = pts[s], p1 = pts[s + 1]
    if (x >= p0.x && x <= p1.x) {
      const span = p1.x - p0.x
      const t = span > 1e-6 ? (x - p0.x) / span : 1
      return p0.y + (p1.y - p0.y) * curveShape(t, p0.curve)
    }
  }
  return pts[pts.length - 1].y
}

const SHAPES: { label: string; pts: LfoPoint[] }[] = [
  { label: 'Sin', pts: Array.from({ length: 17 }, (_, k) => ({ x: k / 16, y: 0.5 - 0.5 * Math.sin((k / 16) * Math.PI * 2), curve: 0 })) },
  { label: 'Tri', pts: [{ x: 0, y: 1, curve: 0 }, { x: 0.5, y: 0, curve: 0 }, { x: 1, y: 1, curve: 0 }] },
  { label: 'Saw↓', pts: [{ x: 0, y: 0, curve: 0 }, { x: 1, y: 1, curve: 0 }] },
  { label: 'Saw↑', pts: [{ x: 0, y: 1, curve: 0 }, { x: 1, y: 0, curve: 0 }] },
  { label: 'Sqr', pts: [{ x: 0, y: 0, curve: 0 }, { x: 0.5, y: 0, curve: 0 }, { x: 0.5, y: 1, curve: 0 }, { x: 1, y: 1, curve: 0 }] },
  { label: 'Ramp', pts: [{ x: 0, y: 1, curve: -0.6 }, { x: 1, y: 0, curve: 0 }] },
]

// `visible`/`onAdd` (optional — Apollo 2's minimal UI): show only the first
// `visible` LFO slots plus a bare "+" that reveals the next one.
export default function LfoPanel({ visible = 10, onAdd }: { visible?: number; onAdd?: () => void } = {}) {
  const ctx = useApollo()
  const meters = useMeters()
  const [sel, setSel] = useState(0)
  useEffect(() => { if (sel >= visible) setSel(0) }, [sel, visible])
  const cfg = ctx.patch.lfos[sel]
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const scopeRef = useRef<HTMLCanvasElement>(null)
  const scopeHist = useRef<number[]>([])
  const [localPts, setLocalPts] = useState<LfoPoint[] | null>(null)
  const dragIdx = useRef<{ kind: 'point' | 'curve'; idx: number; startY?: number; startCurve?: number } | null>(null)
  const isPath = cfg.mode === 'path'
  const pts = localPts || (isPath ? cfg.pathPoints : cfg.points)

  const commitPts = useCallback((next: LfoPoint[]) => {
    setLocalPts(null)
    ctx.update(p => {
      if (p.lfos[sel].mode === 'path') p.lfos[sel].pathPoints = next
      else p.lfos[sel].points = next
      ctx.engine.sendLfoLut(sel, p.lfos[sel].points, p.lfos[sel].mode === 'path' ? p.lfos[sel].pathPoints : null)
    })
  }, [ctx, sel])

  const draw = useCallback(() => {
    const cv = canvasRef.current
    if (!cv) return
    const dpr = window.devicePixelRatio || 1
    const w = cv.clientWidth, h = cv.clientHeight
    if (cv.width !== w * dpr) { cv.width = w * dpr; cv.height = h * dpr }
    const g = cv.getContext('2d')
    if (!g) return
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.fillStyle = UI.inset
    g.fillRect(0, 0, w, h)
    // grid
    g.strokeStyle = 'rgba(255,255,255,0.07)'
    g.lineWidth = 1
    for (let x = 0; x <= cfg.gridX; x++) { g.beginPath(); g.moveTo((x / cfg.gridX) * w, 0); g.lineTo((x / cfg.gridX) * w, h); g.stroke() }
    for (let y = 0; y <= cfg.gridY; y++) { g.beginPath(); g.moveTo(0, (y / cfg.gridY) * h); g.lineTo(w, (y / cfg.gridY) * h); g.stroke() }
    if (cfg.mode === 'chaos') return
    const cur = localPts || (isPath ? cfg.pathPoints : cfg.points)
    // shape
    g.strokeStyle = UI.blue
    g.lineWidth = 2
    g.beginPath()
    for (let px = 0; px <= w; px++) {
      const y = evalPoints(cur, px / w)
      const py = (1 - y) * (h - 6) + 3
      if (px === 0) g.moveTo(px, py)
      else g.lineTo(px, py)
    }
    g.stroke()
    // points
    for (const p of cur) {
      g.fillStyle = '#e8e8e8'
      g.beginPath()
      g.arc(p.x * w, (1 - p.y) * (h - 6) + 3, 4, 0, Math.PI * 2)
      g.fill()
    }
    // playhead + value — hidden while a trig/env LFO is idle (engine sends -1)
    const ph = meters.lfoPhase[sel] ?? 0
    if (ph >= 0) {
      g.strokeStyle = UI.green
      g.beginPath()
      g.moveTo(ph * w, 0)
      g.lineTo(ph * w, h)
      g.stroke()
      const val = evalPoints(cur, ph)
      g.fillStyle = UI.green
      g.beginPath()
      g.arc(ph * w, (1 - val) * (h - 6) + 3, 3.5, 0, Math.PI * 2)
      g.fill()
    }
  }, [cfg, localPts, isPath, meters.lfoPhase, sel])

  useEffect(() => { draw() }, [draw, ctx.version, meters])

  // chaos scope
  useEffect(() => {
    if (cfg.mode !== 'chaos') return
    const hist = scopeHist.current
    hist.push(meters.lfo[sel] || 0)
    if (hist.length > 200) hist.shift()
    const cv = scopeRef.current
    if (!cv) return
    const dpr = window.devicePixelRatio || 1
    const w = cv.clientWidth, h = cv.clientHeight
    if (cv.width !== w * dpr) { cv.width = w * dpr; cv.height = h * dpr }
    const g = cv.getContext('2d')
    if (!g) return
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.fillStyle = UI.inset
    g.fillRect(0, 0, w, h)
    g.strokeStyle = UI.yellow
    g.lineWidth = 1.5
    g.beginPath()
    hist.forEach((v, k) => {
      const px = (k / 200) * w
      const py = (1 - v) * (h - 4) + 2
      if (k === 0) g.moveTo(px, py)
      else g.lineTo(px, py)
    })
    g.stroke()
  }, [meters, cfg.mode, sel])

  const canvasPos = (e: React.PointerEvent): { x: number; y: number } => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height)),
    }
  }
  const snap = (v: number, div: number) => Math.round(v * div) / div

  const onDown = (e: React.PointerEvent) => {
    if (cfg.mode === 'chaos') return
    const { x, y } = canvasPos(e)
    const cur = [...pts]
    // nearest point?
    let pi = -1, bd = 0.045
    cur.forEach((p, k) => {
      const d = Math.hypot(p.x - x, (p.y - y) * 0.6)
      if (d < bd) { bd = d; pi = k }
    })
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    if (e.detail >= 2) { // double click: add or remove
      if (pi >= 0 && cur.length > 2) {
        const next = cur.filter((_, k) => k !== pi)
        setLocalPts(next)
        commitPts(next)
      } else if (pi < 0) {
        const next = [...cur, { x: snap(x, cfg.gridX), y: snap(y, cfg.gridY), curve: 0 }].sort((a, b) => a.x - b.x)
        setLocalPts(next)
        commitPts(next)
      }
      return
    }
    if (pi >= 0) {
      dragIdx.current = { kind: 'point', idx: pi }
      setLocalPts(cur)
    } else {
      // drag on a segment: adjust its curve
      let si = 0
      for (let s = 0; s < cur.length - 1; s++) if (x >= cur[s].x && x <= cur[s + 1].x) { si = s; break }
      dragIdx.current = { kind: 'curve', idx: si, startY: e.clientY, startCurve: cur[si].curve }
      setLocalPts(cur)
    }
  }
  const onMove = (e: React.PointerEvent) => {
    const d = dragIdx.current
    if (!d || !localPts) return
    const next = [...localPts]
    if (d.kind === 'point') {
      const { x, y } = canvasPos(e)
      const p = { ...next[d.idx] }
      const first = d.idx === 0, last = d.idx === next.length - 1
      p.x = first ? 0 : last ? 1 : snap(x, cfg.gridX)
      p.y = snap(y, cfg.gridY)
      next[d.idx] = p
      next.sort((a, b) => a.x - b.x)
    } else {
      const dy = ((d.startY || 0) - e.clientY) / 120
      next[d.idx] = { ...next[d.idx], curve: Math.min(1, Math.max(-1, (d.startCurve || 0) + dy)) }
    }
    setLocalPts(next)
  }
  const onUp = () => {
    if (!dragIdx.current || !localPts) { dragIdx.current = null; return }
    dragIdx.current = null
    commitPts(localPts)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
        {Array.from({ length: visible }, (_, k) => (
          <button key={k} onClick={() => { setSel(k); setLocalPts(null); scopeHist.current = [] }}
            style={{
              width: 24, height: 20, borderRadius: 5, fontSize: 9, fontWeight: 700, cursor: 'pointer',
              background: k === sel ? 'var(--accent)' : 'var(--bg-surface)',
              color: k === sel ? '#fff' : 'var(--text-secondary)',
              border: '1px solid ' + (k === sel ? 'var(--accent)' : 'var(--border)'),
            }}>{k + 1}</button>
        ))}
        <button
          onClick={() => {
            const n = 3 + Math.floor(Math.random() * 5)
            const pts = Array.from({ length: n }, (_, k) => ({
              x: k / (n - 1),
              y: Math.random(),
              curve: (Math.random() - 0.5) * 1.2,
            }))
            commitPts(pts)
            ctx.update(p => { p.lfos[sel].syncRate = [7, 9, 11, 13][Math.floor(Math.random() * 4)] })
          }}
          data-learn="Dice"
          title="Roll the dice — random shape and rate for this LFO"
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, padding: '0 2px', lineHeight: 1, opacity: 0.7 }}
        >🎲</button>
        {onAdd && visible < 10 && (
          <button onClick={onAdd} title="Another LFO"
            style={{ width: 24, height: 20, borderRadius: 5, fontSize: 11, fontWeight: 800, cursor: 'pointer', background: 'var(--bg-surface)', color: 'var(--text-secondary)', border: '1px dashed var(--border)' }}>+</button>
        )}
        <Sel width={72} value={cfg.mode} options={[
          { value: 'normal', label: 'Normal' }, { value: 'path', label: 'Path' }, { value: 'chaos', label: 'Chaos' },
        ]} onChange={v => { setLocalPts(null); ctx.update(p => { p.lfos[sel].mode = v as typeof cfg.mode }) }} />
        {cfg.mode === 'chaos' && (
          <Sel width={76} value={cfg.chaosType} options={[
            { value: 'lorenz', label: 'Lorenz' }, { value: 'rossler', label: 'Rossler' }, { value: 'sh', label: 'S & H' },
          ]} onChange={v => ctx.update(p => { p.lfos[sel].chaosType = v as ChaosType })} />
        )}
      </div>
      {cfg.mode === 'chaos'
        ? <canvas ref={scopeRef} style={{ width: '100%', height: 110, display: 'block', borderRadius: 8 }} />
        : (
          <>
            <canvas
              ref={canvasRef}
              onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}
              style={{ width: '100%', height: 110, display: 'block', borderRadius: 8, cursor: 'crosshair', touchAction: 'none' }}
              title="Drag points • double-click adds/removes • drag a segment to curve it"
            />
            {isPath && <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>Path mode: this curve is the X output (LFO {sel + 1}); its mirrored Y is available as source “LFO {sel + 1} Y”.</div>}
          </>
        )}
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
        {SHAPES.map(s => (
          <button key={s.label} onClick={() => commitPts(s.pts.map(p => ({ ...p })))}
            style={{ background: 'var(--bg-surface)', color: 'var(--text-secondary)', border: '1px solid var(--border)', borderRadius: 5, padding: '2px 6px', fontSize: 9, cursor: 'pointer' }}>{s.label}</button>
        ))}
        <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>Grid</span>
        <Sel width={44} value={String(cfg.gridX)} options={GRID_OPTS.map(gx => ({ value: String(gx), label: `${gx}` }))} onChange={v => ctx.update(p => { p.lfos[sel].gridX = Number(v) })} />
        <Sel width={44} value={String(cfg.gridY)} options={GRID_OPTS.map(gy => ({ value: String(gy), label: `${gy}` }))} onChange={v => ctx.update(p => { p.lfos[sel].gridY = Number(v) })} />
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <ToggleBtn on={cfg.sync} label="BPM" onClick={() => ctx.update(p => { p.lfos[sel].sync = !p.lfos[sel].sync })} />
        {cfg.sync
          ? <Sel width={70} value={String(cfg.syncRate)} options={SYNC_RATES.map((r, k) => ({ value: String(k), label: r.label }))} onChange={v => ctx.update(p => { p.lfos[sel].syncRate = Number(v) })} />
          : <Knob path={`lfo${sel + 1}.rate`} label="Rate" size={34} log />}
        <Sel width={72} value={cfg.trigMode} options={[
          { value: 'trig', label: 'Trig' }, { value: 'env', label: 'Env' },
          { value: 'off', label: 'Free' }, { value: 'loopHold', label: 'Hold' },
        ]} onChange={v => ctx.update(p => { p.lfos[sel].trigMode = v as LfoTrigMode })} />
        <Knob label="Rise" size={32} min={0} max={5} def={0} value={cfg.rise}
          onChange={v => { ctx.update(p => { p.lfos[sel].rise = v }) }} />
        <Knob label="Delay" size={32} min={0} max={5} def={0} value={cfg.delay}
          onChange={v => { ctx.update(p => { p.lfos[sel].delay = v }) }} />
        <Knob label="Smooth" size={32} min={0} max={1} def={0} value={cfg.smooth}
          onChange={v => { ctx.update(p => { p.lfos[sel].smooth = v }) }} />
        <Knob label="Swing" size={32} min={0} max={1} def={0} value={cfg.swing}
          onChange={v => { ctx.update(p => { p.lfos[sel].swing = v }) }} />
        <Knob label="Phase" size={32} min={0} max={1} def={0} value={cfg.phase ?? 0}
          onChange={v => { ctx.update(p => { p.lfos[sel].phase = v }) }} />
        <ToggleBtn on={cfg.bipolar} label="Bipolar" title="Source outputs -1..1 in the matrix" onClick={() => ctx.update(p => { p.lfos[sel].bipolar = !p.lfos[sel].bipolar })} />
      </div>
    </div>
  )
}
