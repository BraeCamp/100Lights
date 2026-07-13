'use client'

import { useState, useRef, useEffect } from 'react'
import { useDaw } from '@/lib/daw-state'
import type { ClipEffect, AutoPoint } from '@/lib/daw-types'
import {
  CLIP_EFFECT_PARAM_META,
  sampleAutomation,
  normToParam,
  paramToNorm,
} from '@/lib/clip-effect-utils'

export const EDITOR_H = 160
const PT_R  = 5
const HDL_R = 3

const EFFECT_COLORS: Record<string, string> = {
  volume: '#22c55e', reverb: '#3b82f6', delay: '#06b6d4',
  filter: '#eab308', tremolo: '#a855f7', distortion: '#ef4444', pitch: '#f97316',
}

export default function EffectEditor({
  effect, beatW, scrollLeft, onClose,
}: {
  effect: ClipEffect
  beatW: number
  scrollLeft: number
  onClose: () => void
}) {
  const { dispatch } = useDaw()
  const meta  = CLIP_EFFECT_PARAM_META[effect.type]
  const color = EFFECT_COLORS[effect.type] ?? '#3d8fef'

  const pointsRef   = useRef<AutoPoint[]>(effect.automation?.points ?? [])
  const selectedRef = useRef<string | null>(null)
  const dragging    = useRef<{
    kind: 'point' | 'h1' | 'h2'
    id: string
    startX: number; startY: number
    startT: number; startV: number
    startH: [number, number]
  } | null>(null)
  const canvasRef   = useRef<HTMLCanvasElement>(null)
  const [, forceRender] = useState(0)

  const effStart = effect.startBeat
  const effEnd   = effStart + effect.durationBeats

  function toX(beat: number): number { return beat * beatW - scrollLeft }
  function toY(v: number, H: number): number { return H - v * (H - 16) - 8 }
  function fromX(cx: number): number { return (cx + scrollLeft) / beatW }
  function fromY(cy: number, H: number): number { return Math.max(0, Math.min(1, 1 - (cy - 8) / (H - 16))) }

  function commit(pts: AutoPoint[]) {
    pointsRef.current = pts
    forceRender(n => n + 1)
    dispatch({ type: 'UPDATE_CLIP_EFFECT', effectId: effect.id, patch: {
      automation: { param: meta.key, points: pts },
    }})
  }

  // ── Drawing ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    const W   = canvas.offsetWidth, H = EDITOR_H
    if (!W) return
    canvas.width = W * dpr; canvas.height = H * dpr
    const ctx = canvas.getContext('2d')!
    ctx.scale(dpr, dpr)

    const sorted   = [...pointsRef.current].sort((a, b) => a.t - b.t)
    const regionL  = toX(effStart), regionR = toX(effEnd)

    ctx.fillStyle = '#0a0a12'; ctx.fillRect(0, 0, W, H)

    ctx.fillStyle = 'rgba(255,255,255,0.025)'
    const rl = Math.max(0, regionL), rr = Math.min(W, regionR)
    ctx.fillRect(rl, 0, rr - rl, H)

    ctx.lineWidth = 1
    for (let v = 0; v <= 1; v += 0.25) {
      const y = toY(v, H)
      ctx.strokeStyle = v === 0.5 ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.03)'
      ctx.setLineDash([]); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke()
    }

    for (let b = Math.floor(fromX(0)); b <= Math.ceil(fromX(W)); b++) {
      const x = toX(b); if (x < 0 || x > W) continue
      ctx.strokeStyle = 'rgba(255,255,255,0.04)'; ctx.setLineDash([])
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke()
    }

    // Ghost shapeEnvelope (volume only — stretched to fill clip region visually)
    if (effect.type === 'volume' && effect.params.shapeEnvelope?.length) {
      const env = effect.params.shapeEnvelope
      ctx.strokeStyle = `${color}22`; ctx.lineWidth = 1.5; ctx.setLineDash([])
      ctx.beginPath()
      for (let i = 0; i < env.length; i++) {
        const x = rl + (i / (env.length - 1)) * (rr - rl)
        const y = toY(env[i], H)
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
      }
      ctx.stroke()
    }

    // Automation curve
    ctx.setLineDash([]); ctx.lineWidth = 2
    if (sorted.length === 0) {
      const rawVal = (effect.params as Record<string, number>)[meta.key] ?? meta.min
      const normVal = Math.max(0, Math.min(1, paramToNorm(rawVal, meta)))
      const y = toY(normVal, H)
      ctx.strokeStyle = `${color}40`; ctx.setLineDash([5, 5])
      ctx.beginPath(); ctx.moveTo(rl, y); ctx.lineTo(rr, y); ctx.stroke()
      ctx.setLineDash([])
    } else {
      ctx.strokeStyle = color; ctx.setLineDash([])
      ctx.beginPath()
      ctx.moveTo(rl, toY(sorted[0].v, H))
      ctx.lineTo(toX(effStart + sorted[0].t), toY(sorted[0].v, H))
      for (let i = 0; i < sorted.length - 1; i++) {
        const p = sorted[i], q = sorted[i + 1]
        const qx = toX(effStart + q.t), qy = toY(q.v, H)
        if (p.smooth || q.smooth) {
          // Control x clamped inside the segment so the curve can't run
          // backwards in time (matches the engine's evaluation)
          const c1t = Math.min(q.t, Math.max(p.t, p.t + (p.smooth ? p.h2[0] : 0)))
          const c2t = Math.min(q.t, Math.max(p.t, q.t + (q.smooth ? q.h1[0] : 0)))
          ctx.bezierCurveTo(
            toX(effStart + c1t), toY(p.v + (p.smooth ? p.h2[1] : 0), H),
            toX(effStart + c2t), toY(q.v + (q.smooth ? q.h1[1] : 0), H),
            qx, qy,
          )
        } else {
          ctx.lineTo(qx, qy)
        }
      }
      const last = sorted[sorted.length - 1]
      ctx.lineTo(rr, toY(last.v, H))
      ctx.stroke()
    }

    // Points and handles
    for (const pt of sorted) {
      const px = toX(effStart + pt.t), py = toY(pt.v, H)
      const isSel = selectedRef.current === pt.id

      if (isSel && pt.smooth) {
        const h1x = toX(effStart + pt.t + pt.h1[0]), h1y = toY(pt.v + pt.h1[1], H)
        const h2x = toX(effStart + pt.t + pt.h2[0]), h2y = toY(pt.v + pt.h2[1], H)
        ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1; ctx.setLineDash([])
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(h1x, h1y); ctx.stroke()
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(h2x, h2y); ctx.stroke()
        ctx.fillStyle = '#f59e0b'
        for (const [hx, hy] of [[h1x, h1y], [h2x, h2y]]) {
          ctx.beginPath(); ctx.arc(hx as number, hy as number, HDL_R, 0, Math.PI * 2); ctx.fill()
        }
      }

      ctx.lineWidth = 1.5; ctx.setLineDash([])
      ctx.fillStyle   = isSel ? '#fff' : color
      ctx.strokeStyle = isSel ? color : 'rgba(255,255,255,0.35)'
      ctx.beginPath(); ctx.arc(px, py, PT_R, 0, Math.PI * 2)
      ctx.fill(); ctx.stroke()
    }

    // Labels
    ctx.fillStyle = `${color}90`; ctx.font = '9px monospace'; ctx.textAlign = 'left'
    ctx.fillText(meta.label.toUpperCase(), 5, 12)
    ctx.fillStyle = 'rgba(255,255,255,0.18)'
    ctx.fillText('click: add  drag: move  dbl-click pt: smooth  right-click pt: delete  dbl-click empty: close', 5, H - 5)
  })

  // ── Hit test ─────────────────────────────────────────────────────────────
  function hitTest(cx: number, cy: number): { kind: 'point' | 'h1' | 'h2'; id: string } | null {
    const selId = selectedRef.current
    const sel   = selId ? pointsRef.current.find(p => p.id === selId) : undefined
    if (sel?.smooth) {
      const h1x = toX(effStart + sel.t + sel.h1[0]), h1y = toY(sel.v + sel.h1[1], EDITOR_H)
      const h2x = toX(effStart + sel.t + sel.h2[0]), h2y = toY(sel.v + sel.h2[1], EDITOR_H)
      if (Math.hypot(cx - h1x, cy - h1y) <= HDL_R + 5) return { kind: 'h1', id: sel.id }
      if (Math.hypot(cx - h2x, cy - h2y) <= HDL_R + 5) return { kind: 'h2', id: sel.id }
    }
    for (const pt of [...pointsRef.current].sort((a, b) => a.t - b.t)) {
      const px = toX(effStart + pt.t), py = toY(pt.v, EDITOR_H)
      if (Math.hypot(cx - px, cy - py) <= PT_R + 5) return { kind: 'point', id: pt.id }
    }
    return null
  }

  // ── Mouse ─────────────────────────────────────────────────────────────────
  function onMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    if (e.button !== 0) return
    e.stopPropagation()
    const rect = e.currentTarget.getBoundingClientRect()
    const cx = e.clientX - rect.left, cy = e.clientY - rect.top
    const hit = hitTest(cx, cy)

    if (hit) {
      selectedRef.current = hit.id
      forceRender(n => n + 1)
      const pt = pointsRef.current.find(p => p.id === hit.id)!
      dragging.current = {
        kind: hit.kind, id: hit.id,
        startX: e.clientX, startY: e.clientY,
        startT: pt.t, startV: pt.v,
        startH: hit.kind === 'h1' ? [...pt.h1] as [number, number] : [...pt.h2] as [number, number],
      }
    } else {
      const t = fromX(cx) - effStart
      const v = fromY(cy, EDITOR_H)
      if (t < 0 || t > effect.durationBeats) return
      const newPt: AutoPoint = {
        id: crypto.randomUUID(), t, v, smooth: false,
        h1: [-0.5, 0], h2: [0.5, 0],
      }
      const next = [...pointsRef.current, newPt].sort((a, b) => a.t - b.t)
      commit(next)
      selectedRef.current = newPt.id
      dragging.current = {
        kind: 'point', id: newPt.id,
        startX: e.clientX, startY: e.clientY,
        startT: t, startV: v, startH: [0, 0],
      }
    }

    function mm(ev: MouseEvent) {
      if (!dragging.current) return
      const dx    = ev.clientX - dragging.current.startX
      const dy    = ev.clientY - dragging.current.startY
      const dt    = dx / beatW
      const dv    = -dy / (EDITOR_H - 16)

      pointsRef.current = pointsRef.current.map(p => {
        if (p.id !== dragging.current!.id) return p
        const { kind, startT, startV, startH } = dragging.current!
        if (kind === 'point') {
          const siblings = pointsRef.current.filter(q => q.id !== p.id)
          const prevT = siblings.filter(q => q.t < startT).reduce((m, q) => Math.max(m, q.t), -Infinity)
          const nextT = siblings.filter(q => q.t > startT).reduce((m, q) => Math.min(m, q.t), Infinity)
          const tMin = isFinite(prevT) ? prevT + 0.01 : 0
          const tMax = isFinite(nextT) ? nextT - 0.01 : effect.durationBeats
          return { ...p,
            t: Math.max(tMin, Math.min(tMax, startT + dt)),
            v: Math.max(0, Math.min(1, startV + dv)),
          }
        }
        const clampHandle = (hStart: [number, number], side: 'h1' | 'h2'): [number, number] => {
          const absT  = Math.max(0, Math.min(effect.durationBeats, p.t + hStart[0] + dt))
          const absV  = Math.max(0, Math.min(1, p.v + hStart[1] + dv))
          const offT  = absT - p.t
          // h1 must point left (≤0), h2 must point right (≥0) — prevents S-curve crossing
          const offTC = side === 'h1' ? Math.min(0, offT) : Math.max(0, offT)
          return [offTC, absV - p.v]
        }
        if (kind === 'h2') return { ...p, h2: clampHandle(startH, 'h2'), smooth: true }
        return { ...p, h1: clampHandle(startH, 'h1'), smooth: true }
      })
      forceRender(n => n + 1)
    }

    function mu() {
      if (!dragging.current) return
      const sorted = [...pointsRef.current].sort((a, b) => a.t - b.t)
      commit(sorted)
      dragging.current = null
      document.removeEventListener('mousemove', mm)
      document.removeEventListener('mouseup', mu)
    }

    document.addEventListener('mousemove', mm)
    document.addEventListener('mouseup', mu)
  }

  function onDoubleClick(e: React.MouseEvent<HTMLCanvasElement>) {
    e.stopPropagation()
    const rect = e.currentTarget.getBoundingClientRect()
    const hit  = hitTest(e.clientX - rect.left, e.clientY - rect.top)
    if (hit?.kind === 'point') {
      commit(pointsRef.current.map(p => p.id === hit.id ? { ...p, smooth: !p.smooth } : p))
    } else if (!hit) {
      onClose()
    }
  }

  function onContextMenu(e: React.MouseEvent<HTMLCanvasElement>) {
    e.preventDefault(); e.stopPropagation()
    const rect = e.currentTarget.getBoundingClientRect()
    const hit  = hitTest(e.clientX - rect.left, e.clientY - rect.top)
    if (hit?.kind === 'point') {
      if (selectedRef.current === hit.id) { selectedRef.current = null }
      commit(pointsRef.current.filter(p => p.id !== hit.id))
    }
  }

  return (
    <div
      style={{ height: EDITOR_H, flexShrink: 0, borderTop: `1px solid ${color}28` }}
      onContextMenu={e => e.stopPropagation()}
    >
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: EDITOR_H, display: 'block', cursor: 'crosshair' }}
        onMouseDown={onMouseDown}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContextMenu}
      />
    </div>
  )
}
