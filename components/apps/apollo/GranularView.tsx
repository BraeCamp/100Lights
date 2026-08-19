'use client'
// Granular-engine editor: waveform + scan playhead + spray region, grain
// parameter knobs, window shape preview.

import React, { useCallback, useEffect, useRef } from 'react'
import { useApollo, useMeters, Knob, Sel, ToggleBtn, UI } from './ApolloContext'
import SamplePicker from './SamplePicker'

function grainWindow(t: number, shape: number, skew: number, amount: number): number {
  let tt = t
  if (skew !== 0) {
    const peak = Math.min(0.95, Math.max(0.05, 0.5 + skew * 0.45))
    tt = t < peak ? (t / peak) * 0.5 : 0.5 + ((t - peak) / (1 - peak)) * 0.5
  }
  let w: number
  if (shape < 0.5) {
    const tri = 1 - Math.abs(tt * 2 - 1)
    const hann = 0.5 - 0.5 * Math.cos(2 * Math.PI * tt)
    w = tri + (hann - tri) * shape * 2
  } else {
    const hann = 0.5 - 0.5 * Math.cos(2 * Math.PI * tt)
    const gs = Math.exp(-Math.pow((tt - 0.5) * 5, 2))
    w = hann + (gs - hann) * (shape * 2 - 1)
  }
  return 1 + (w - 1) * amount
}

export default function GranularView() {
  const ctx = useApollo()
  const meters = useMeters()
  const i = ctx.selectedOsc
  const cfg = ctx.patch.oscs[i].gran
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const winRef = useRef<HTMLCanvasElement>(null)
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
    g.fillStyle = UI.inset
    g.fillRect(0, 0, w, h)
    if (!smp) {
      g.fillStyle = '#666'; g.font = '11px system-ui'; g.textAlign = 'center'
      g.fillText('Load a sample below', w / 2, h / 2)
      return
    }
    const c = ctx.patch.oscs[i].gran
    // spray region around pos
    const scan = meters.grain[i] || c.pos
    g.fillStyle = 'rgba(232,184,73,0.12)'
    const sprayW = c.spray * 0.25 * w
    g.fillRect((scan * w) - sprayW, 0, sprayW * 2, h)
    // waveform
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
    // playhead
    g.strokeStyle = UI.yellow
    g.lineWidth = 2
    g.beginPath()
    g.moveTo(scan * w, 0)
    g.lineTo(scan * w, h)
    g.stroke()
  }, [smp, ctx.patch, i, meters.grain])

  useEffect(() => { draw() }, [draw, ctx.version, meters])

  useEffect(() => {
    const cv = winRef.current
    if (!cv) return
    const dpr = window.devicePixelRatio || 1
    const w = cv.clientWidth, h = cv.clientHeight
    if (cv.width !== w * dpr) { cv.width = w * dpr; cv.height = h * dpr }
    const g = cv.getContext('2d')
    if (!g) return
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.fillStyle = UI.inset
    g.fillRect(0, 0, w, h)
    g.strokeStyle = 'var(--accent)'
    g.strokeStyle = UI.blue
    g.lineWidth = 1.5
    g.beginPath()
    for (let x = 0; x <= w; x++) {
      const y = grainWindow(x / w, cfg.windowShape, cfg.windowSkew, cfg.windowAmount)
      if (x === 0) g.moveTo(x, h - y * (h - 4) - 2)
      else g.lineTo(x, h - y * (h - 4) - 2)
    }
    g.stroke()
  }, [cfg.windowShape, cfg.windowSkew, cfg.windowAmount, ctx.version])

  const onCanvasDown = (e: React.PointerEvent) => {
    if (!smp) return
    const r = (e.target as HTMLElement).getBoundingClientRect()
    const pos = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
    ctx.setParam(`osc${i}.gran.pos`, pos)
    ctx.commit()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <canvas
        ref={canvasRef}
        onPointerDown={onCanvasDown}
        style={{ width: '100%', height: 110, display: 'block', borderRadius: 8, border: '1px solid var(--border)', cursor: 'crosshair', touchAction: 'none' }}
        title="Click to set grain position"
      />
      <SamplePicker oscIndex={i} target="gran" />
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <Knob path={`osc${i}.gran.density`} label="Density" size={36} />
        <Knob path={`osc${i}.gran.length`} label="Length" size={36} />
        <Knob path={`osc${i}.gran.scan`} label="Scan" bipolar size={36} />
        <Knob path={`osc${i}.gran.pos`} label="Pos" size={36} />
        <Knob path={`osc${i}.gran.spray`} label="Spray" size={36} />
        <Knob path={`osc${i}.gran.pitchRand`} label="Ptch Rnd" size={36} />
        <Knob path={`osc${i}.gran.panRand`} label="Pan Rnd" size={36} />
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <Knob path={`osc${i}.gran.windowShape`} label="Window" size={34} />
        <Knob label="Skew" size={34} min={-1} max={1} def={0} bipolar value={cfg.windowSkew}
          onChange={v => ctx.setParam(`osc${i}.gran.windowSkew`, v)} onCommit={() => ctx.commit()} />
        <Knob label="Win Amt" size={34} min={0} max={1} def={1} value={cfg.windowAmount}
          onChange={v => ctx.setParam(`osc${i}.gran.windowAmount`, v)} onCommit={() => ctx.commit()} />
        <canvas ref={winRef} style={{ width: 70, height: 36, borderRadius: 6, border: '1px solid var(--border)' }} />
        <Sel width={64} value={cfg.direction} options={[
          { value: 'fwd', label: 'Fwd' }, { value: 'rev', label: 'Rev' }, { value: 'alt', label: 'Alt' },
        ]} onChange={v => ctx.update(p => { p.oscs[i].gran.direction = v as typeof cfg.direction })} />
        <ToggleBtn on={cfg.loopGrains} label="Loop" onClick={() => ctx.update(p => { p.oscs[i].gran.loopGrains = !p.oscs[i].gran.loopGrains })} />
        <ToggleBtn on={cfg.manual} label="Manual" title="Playhead follows Pos knob only" onClick={() => ctx.update(p => { p.oscs[i].gran.manual = !p.oscs[i].gran.manual })} />
        <ToggleBtn on={cfg.keytrack} label="Keytrack" onClick={() => ctx.update(p => { p.oscs[i].gran.keytrack = !p.oscs[i].gran.keytrack })} />
        <label style={{ fontSize: 10, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
          Root
          <input
            type="number" min={0} max={127} value={cfg.rootKey}
            onChange={e => ctx.update(p => { p.oscs[i].gran.rootKey = Number(e.target.value) })}
            style={{ width: 46, background: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 6, padding: '2px 4px', fontSize: 11 }}
          />
        </label>
      </div>
    </div>
  )
}
