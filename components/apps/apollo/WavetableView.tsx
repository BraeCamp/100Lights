'use client'
// Stacked-frame wavetable preview (Serum-style oblique stack). Vertical drag
// scrubs the WT position of the selected oscillator.

import React, { useEffect, useRef } from 'react'
import { useApollo, UI } from '@/components/apps/apollo/ApolloContext'
import type { ApolloPatch } from '@/lib/apollo/patch'
import { generateFactoryTable, tableFromBase64, WT_LEN } from '@/lib/apollo/tables'

const tableCache = new Map<string, { frames: number; data: Float32Array }>()

export function getTableData(patch: ApolloPatch, tableId: string): { frames: number; data: Float32Array } | null {
  const user = patch.userTables?.[tableId]
  if (user) {
    const key = `user:${tableId}:${user.data.length}`
    let hit = tableCache.get(key)
    if (!hit) {
      hit = { frames: user.frames, data: tableFromBase64(user.data) }
      tableCache.set(key, hit)
    }
    return hit
  }
  let hit = tableCache.get(tableId)
  if (!hit) {
    const t = generateFactoryTable(tableId)
    if (!t) return null
    hit = { frames: t.frames, data: t.data }
    tableCache.set(tableId, hit)
  }
  return hit
}

export default function WavetableView() {
  const ctx = useApollo()
  const i = ctx.selectedOsc
  const cfg = ctx.patch.oscs[i]
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const dragRef = useRef<{ y: number; pos: number } | null>(null)
  const posRef = useRef(cfg.wt.pos)
  posRef.current = cfg.wt.pos

  useEffect(() => {
    const c = canvasRef.current
    if (!c) return
    const draw = (livePos?: number) => {
      const dpr = window.devicePixelRatio || 1
      const w = c.clientWidth, h = c.clientHeight
      if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr) }
      const g = c.getContext('2d')
      if (!g) return
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.clearRect(0, 0, w, h)
      const tbl = getTableData(ctx.patch, cfg.wt.tableId)
      if (!tbl) {
        g.fillStyle = 'var(--text-muted)'
        g.font = '11px sans-serif'
        g.fillText('no table', 10, h / 2)
        return
      }
      const pos = livePos ?? posRef.current
      const stack = Math.min(12, tbl.frames)
      const ox = w * 0.22, oy = h * 0.5
      const waveW = w - ox - 8, waveH = h * 0.32
      const stepX = stack > 1 ? (ox - 8) / (stack - 1) : 0
      const stepY = stack > 1 ? (h * 0.42) / (stack - 1) : 0
      const curFrame = pos * (tbl.frames - 1)
      const style = getComputedStyle(c)
      // Serum-style: dim green frame stack, bright yellow current frame
      const accent = UI.yellow
      const dim = 'rgba(120, 200, 110, 0.32)'
      for (let s = stack - 1; s >= 0; s--) {
        const frame = stack > 1 ? Math.round((s / (stack - 1)) * (tbl.frames - 1)) : 0
        const isCur = Math.abs(frame - curFrame) <= (tbl.frames - 1) / Math.max(1, (stack - 1) * 2) + 0.001
        const x0 = ox - s * stepX
        const y0 = oy + (h * 0.44) - s * stepY - waveH / 2
        g.beginPath()
        const base = frame * WT_LEN
        for (let px = 0; px <= waveW; px += 2) {
          const idx = base + Math.floor((px / waveW) * (WT_LEN - 1))
          const v = tbl.data[idx]
          const x = x0 + px, y = y0 - v * waveH / 2
          if (px === 0) g.moveTo(x, y); else g.lineTo(x, y)
        }
        g.strokeStyle = isCur ? accent : dim
        g.lineWidth = isCur ? 1.8 : 0.8
        g.globalAlpha = isCur ? 1 : 0.75
        g.stroke()
        g.globalAlpha = 1
      }
      // exact interpolated current frame, bold on top
      const f0 = Math.floor(curFrame), ff = curFrame - f0
      g.beginPath()
      for (let px = 0; px <= waveW; px += 1) {
        const ii = Math.floor((px / waveW) * (WT_LEN - 1))
        const a = tbl.data[f0 * WT_LEN + ii]
        const b = tbl.data[Math.min(tbl.frames - 1, f0 + 1) * WT_LEN + ii]
        const v = a + (b - a) * ff
        const x = ox + px, y = oy + h * 0.44 - waveH / 2 - v * waveH / 2
        if (px === 0) g.moveTo(x, y); else g.lineTo(x, y)
      }
      g.strokeStyle = accent
      g.lineWidth = 2.2
      g.shadowColor = accent
      g.shadowBlur = 6
      g.stroke()
      g.shadowBlur = 0
      g.fillStyle = style.getPropertyValue('--text-muted').trim() || '#888'
      g.font = '9px sans-serif'
      g.fillText(`frame ${Math.round(curFrame) + 1}/${tbl.frames}`, 6, 12)
    }
    draw()
    const c2 = c
    const onDown = (e: PointerEvent) => {
      e.preventDefault()
      c2.setPointerCapture(e.pointerId)
      dragRef.current = { y: e.clientY, pos: posRef.current }
    }
    const onMove = (e: PointerEvent) => {
      if (!dragRef.current) return
      const dy = dragRef.current.y - e.clientY
      const next = Math.min(1, Math.max(0, dragRef.current.pos + dy / 160))
      posRef.current = next
      ctx.setParam(`osc${i}.wt.pos`, next)
      draw(next)
    }
    const onUp = () => {
      if (!dragRef.current) return
      dragRef.current = null
      ctx.commit()
    }
    c2.addEventListener('pointerdown', onDown)
    c2.addEventListener('pointermove', onMove)
    c2.addEventListener('pointerup', onUp)
    return () => {
      c2.removeEventListener('pointerdown', onDown)
      c2.removeEventListener('pointermove', onMove)
      c2.removeEventListener('pointerup', onUp)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.version, cfg.wt.tableId, i])

  return (
    <canvas
      ref={canvasRef}
      style={{ width: '100%', height: 150, display: 'block', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'ns-resize', touchAction: 'none' }}
      title="Drag vertically to scrub wavetable position"
    />
  )
}
