'use client'
// Sample-engine editor: waveform with draggable start/end/loop markers,
// slicing (auto transient + manual), loop modes, rate / tails controls.

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useApollo, Knob, Sel, ToggleBtn, UI } from './ApolloContext'
import SamplePicker from './SamplePicker'

type Marker = 'start' | 'end' | 'loopStart' | 'loopEnd' | null

export default function SampleView() {
  const ctx = useApollo()
  const i = ctx.selectedOsc
  const cfg = ctx.patch.oscs[i].smp
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [drag, setDrag] = useState<Marker>(null)
  const dragRef = useRef<Marker>(null)
  const smp = cfg.sampleId ? ctx.engine.samples.get(cfg.sampleId) : null

  const draw = useCallback(() => {
    const cv = canvasRef.current
    if (!cv) return
    const dpr = window.devicePixelRatio || 1
    const w = cv.clientWidth, h = cv.clientHeight
    if (cv.width !== w * dpr) { cv.width = w * dpr; cv.height = h * dpr }
    const g = cv.getContext('2d')
    if (!g) return
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, w, h)
    g.fillStyle = 'var(--bg-surface)'
    g.fillStyle = UI.inset
    g.fillRect(0, 0, w, h)
    if (!smp) {
      g.fillStyle = '#666'
      g.font = '11px system-ui'
      g.textAlign = 'center'
      g.fillText('Load a sample below', w / 2, h / 2)
      return
    }
    const c = ctx.patch.oscs[i].smp
    // loop region shade
    if (c.loopMode !== 'off') {
      g.fillStyle = 'rgba(61,143,239,0.10)'
      g.fillRect(c.loopStart * w, 0, (c.loopEnd - c.loopStart) * w, h)
    }
    // out-of-range shade
    g.fillStyle = 'rgba(0,0,0,0.5)'
    g.fillRect(0, 0, c.start * w, h)
    g.fillRect(c.end * w, 0, w - c.end * w, h)
    // waveform peaks
    g.strokeStyle = UI.green
    g.lineWidth = 1
    g.beginPath()
    const step = Math.max(1, Math.floor(smp.len / w))
    for (let x = 0; x < w; x++) {
      const s0 = Math.floor((x / w) * smp.len)
      let mn = 1, mx = -1
      for (let s = s0; s < Math.min(s0 + step, smp.len); s++) {
        const v = smp.l[s]
        if (v < mn) mn = v
        if (v > mx) mx = v
      }
      g.moveTo(x + 0.5, (0.5 - mx * 0.48) * h)
      g.lineTo(x + 0.5, (0.5 - mn * 0.48) * h)
    }
    g.stroke()
    // slices
    g.strokeStyle = UI.yellow
    for (const sl of c.slices) {
      g.beginPath()
      g.moveTo(sl.pos * w, 0)
      g.lineTo(sl.pos * w, h)
      g.stroke()
      g.fillStyle = UI.yellow
      g.fillRect(sl.pos * w - 3, 0, 6, 5)
    }
    // markers
    const mark = (pos: number, color: string, lbl: string) => {
      g.strokeStyle = color
      g.lineWidth = 1.5
      g.beginPath()
      g.moveTo(pos * w, 0)
      g.lineTo(pos * w, h)
      g.stroke()
      g.fillStyle = color
      g.font = '8px system-ui'
      g.textAlign = 'left'
      g.fillText(lbl, pos * w + 2, 9)
    }
    mark(c.start, UI.green, 'S')
    mark(c.end, '#e07d7d', 'E')
    if (c.loopMode !== 'off') { mark(c.loopStart, UI.blue, 'L1'); mark(c.loopEnd, UI.blue, 'L2') }
  }, [smp, ctx.patch, i])

  useEffect(() => { draw() }, [draw, ctx.version])

  const posFromEvent = (e: React.PointerEvent): number => {
    const r = (e.target as HTMLElement).getBoundingClientRect()
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
  }

  const nearestMarker = (pos: number): Marker => {
    const c = ctx.patch.oscs[i].smp
    const cands: [Marker, number][] = [['start', c.start], ['end', c.end]]
    if (c.loopMode !== 'off') { cands.push(['loopStart', c.loopStart]); cands.push(['loopEnd', c.loopEnd]) }
    let best: Marker = null, bd = 0.02
    for (const [m, p] of cands) { const d = Math.abs(p - pos); if (d < bd) { bd = d; best = m } }
    return best
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (!smp) return
    const pos = posFromEvent(e)
    if (e.altKey) { // add slice
      ctx.update(p => { p.oscs[i].smp.slices = [...p.oscs[i].smp.slices, { pos }].sort((a, b) => a.pos - b.pos) })
      return
    }
    const m = nearestMarker(pos)
    if (m) {
      dragRef.current = m
      setDrag(m)
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const m = dragRef.current
    if (!m) return
    const pos = posFromEvent(e)
    ctx.setParam(`osc${i}.smp.${m}`, pos)
    draw()
  }
  const onPointerUp = () => {
    const m = dragRef.current
    if (!m) return
    dragRef.current = null
    setDrag(null)
    // snap the released marker to the nearest zero crossing (Serum "snap loop")
    if (smp) {
      const c = ctx.patch.oscs[i].smp
      const cur = c[m]
      let idx = Math.round(cur * smp.len)
      const span = Math.min(800, smp.len >> 2)
      let best = idx, bd = Infinity
      for (let d = 0; d < span; d++) {
        for (const cand of [idx - d, idx + d]) {
          if (cand < 1 || cand >= smp.len) continue
          if ((smp.l[cand - 1] <= 0 && smp.l[cand] >= 0) || (smp.l[cand - 1] >= 0 && smp.l[cand] <= 0)) {
            if (d < bd) { bd = d; best = cand }
            break
          }
        }
        if (bd < Infinity) break
      }
      if (bd < Infinity && best !== idx) ctx.setParam(`osc${i}.smp.${m}`, best / smp.len)
    }
    ctx.commit()
  }
  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    if (!smp) return
    const r = (e.target as HTMLElement).getBoundingClientRect()
    const pos = (e.clientX - r.left) / r.width
    const c = ctx.patch.oscs[i].smp
    const idx = c.slices.findIndex(s => Math.abs(s.pos - pos) < 0.015)
    if (idx >= 0) ctx.update(p => { p.oscs[i].smp.slices = p.oscs[i].smp.slices.filter((_, j) => j !== idx) })
  }

  const autoSlice = () => {
    if (!smp) return
    // simple energy-derivative transient detection
    const win = Math.max(64, Math.floor(smp.sr * 0.01))
    const hops = Math.floor(smp.len / win)
    const energy = new Float32Array(hops)
    for (let hI = 0; hI < hops; hI++) {
      let e = 0
      for (let s = hI * win; s < (hI + 1) * win; s++) e += smp.l[s] * smp.l[s]
      energy[hI] = Math.sqrt(e / win)
    }
    const slices: { pos: number }[] = []
    let lastSlice = -10
    for (let hI = 2; hI < hops; hI++) {
      const prev = (energy[hI - 1] + energy[hI - 2]) / 2
      if (energy[hI] > prev * 2 && energy[hI] > 0.02 && hI - lastSlice > 4) {
        slices.push({ pos: (hI * win) / smp.len })
        lastSlice = hI
      }
    }
    if (!slices.length || slices[0].pos > 0.01) slices.unshift({ pos: 0 })
    ctx.update(p => { p.oscs[i].smp.slices = slices.slice(0, 64) })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <canvas
        ref={canvasRef}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
        onContextMenu={onContextMenu}
        style={{ width: '100%', height: 120, display: 'block', borderRadius: 8, border: '1px solid var(--border)', cursor: drag ? 'ew-resize' : 'crosshair', touchAction: 'none' }}
        title="Drag markers • Alt-click adds slice • right-click removes slice"
      />
      <SamplePicker oscIndex={i} target="smp" />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <Sel width={92} value={cfg.loopMode} options={[
          { value: 'off', label: 'One-shot' }, { value: 'loop', label: 'Loop' },
          { value: 'pingpong', label: 'Ping-pong' }, { value: 'tails', label: 'Tails' },
        ]} onChange={v => ctx.update(p => { p.oscs[i].smp.loopMode = v as typeof cfg.loopMode })} />
        <Knob path={`osc${i}.smp.rate`} label="Rate" bipolar size={34} />
        <Knob label="Xfade" size={34} min={0} max={0.5} def={0.01} value={cfg.xfade}
          onChange={v => ctx.setParam(`osc${i}.smp.xfade`, v)} onCommit={() => ctx.commit()} />
        <ToggleBtn on={cfg.keytrack} label="Keytrack" onClick={() => ctx.update(p => { p.oscs[i].smp.keytrack = !p.oscs[i].smp.keytrack })} />
        <label style={{ fontSize: 10, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
          Root
          <input
            type="number" min={0} max={127} value={cfg.rootKey}
            onChange={e => ctx.update(p => { p.oscs[i].smp.rootKey = Number(e.target.value) })}
            style={{ width: 46, background: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 6, padding: '2px 4px', fontSize: 11 }}
          />
        </label>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <ToggleBtn on={false} label="Auto Slice" onClick={autoSlice} title="Detect transients" />
        <ToggleBtn on={false} label="Clear Slices" onClick={() => ctx.update(p => { p.oscs[i].smp.slices = [] })} />
        <ToggleBtn on={cfg.sliceMap === 'keys'} label="Slices → Keys" title="Map slices chromatically from C1"
          onClick={() => ctx.update(p => { p.oscs[i].smp.sliceMap = p.oscs[i].smp.sliceMap === 'keys' ? 'off' : 'keys' })} />
        <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>{cfg.slices.length} slices</span>
      </div>
    </div>
  )
}
