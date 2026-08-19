'use client'
// Spectral-engine editor: spectrogram, drawable spectral filter curve,
// playhead, warp knobs.

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useApollo, useMeters, Knob, ToggleBtn } from './ApolloContext'
import SamplePicker from './SamplePicker'

export default function SpectralView() {
  const ctx = useApollo()
  const meters = useMeters()
  const i = ctx.selectedOsc
  const cfg = ctx.patch.oscs[i].spec
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const specImgRef = useRef<HTMLCanvasElement | null>(null)
  const specImgId = useRef<string>('')
  const [progress, setProgress] = useState<number | null>(null)
  const drawingRef = useRef(false)
  const curveRef = useRef<number[] | null>(null)
  const analysis = cfg.sampleId ? ctx.engine.getSpectral(cfg.sampleId) : null

  // kick off analysis when a sample is set but not analyzed
  useEffect(() => {
    const id = cfg.sampleId
    if (!id || ctx.engine.getSpectral(id) || !ctx.engine.samples.has(id)) return
    let cancelled = false
    setProgress(0)
    void ctx.engine.ensureSpectral(id, p => { if (!cancelled) setProgress(p) }).then(() => {
      if (!cancelled) { setProgress(null); specImgId.current = ''; drawAll() }
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg.sampleId, ctx.version])

  const buildSpectrogram = useCallback(() => {
    if (!analysis || !cfg.sampleId) return null
    if (specImgId.current === cfg.sampleId && specImgRef.current) return specImgRef.current
    const W = 512, H = 256
    const off = document.createElement('canvas')
    off.width = W; off.height = H
    const g = off.getContext('2d')
    if (!g) return null
    const img = g.createImageData(W, H)
    let mx = 1e-6
    for (let k = 0; k < analysis.mags.length; k += 7) mx = Math.max(mx, analysis.mags[k])
    for (let x = 0; x < W; x++) {
      const f = Math.floor((x / W) * analysis.frames)
      for (let y = 0; y < H; y++) {
        // log-frequency vertical axis, low at bottom
        const bin = Math.floor(Math.pow((H - 1 - y) / H, 2.2) * (analysis.bins - 2)) + 1
        const m = analysis.mags[f * analysis.bins + bin] / mx
        const v = Math.pow(Math.min(1, m * 4), 0.4)
        const idx = (y * W + x) * 4
        img.data[idx] = 20 + v * 60
        img.data[idx + 1] = 25 + v * 140
        img.data[idx + 2] = 40 + v * 215
        img.data[idx + 3] = 255
      }
    }
    g.putImageData(img, 0, 0)
    specImgRef.current = off
    specImgId.current = cfg.sampleId
    return off
  }, [analysis, cfg.sampleId])

  const drawAll = useCallback(() => {
    const cv = canvasRef.current
    if (!cv) return
    const dpr = window.devicePixelRatio || 1
    const w = cv.clientWidth, h = cv.clientHeight
    if (cv.width !== w * dpr) { cv.width = w * dpr; cv.height = h * dpr }
    const g = cv.getContext('2d')
    if (!g) return
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.fillStyle = '#0c0e12'
    g.fillRect(0, 0, w, h)
    const img = buildSpectrogram()
    if (img) g.drawImage(img, 0, 0, w, h)
    else {
      g.fillStyle = '#666'; g.font = '11px system-ui'; g.textAlign = 'center'
      g.fillText(cfg.sampleId ? (progress != null ? `Analyzing… ${Math.round(progress * 100)}%` : 'No analysis') : 'Load a sample below', w / 2, h / 2)
    }
    // filter curve overlay (index 0 = low freq at bottom)
    const curve = curveRef.current || cfg.filterCurve
    g.strokeStyle = '#e8b849'
    g.lineWidth = 1.5
    g.beginPath()
    for (let x = 0; x <= 63; x++) {
      const px = (x / 63) * w
      const py = h - curve[x] * (h - 4) - 2
      if (x === 0) g.moveTo(px, py)
      else g.lineTo(px, py)
    }
    g.stroke()
    // playhead
    if (analysis) {
      const ph = meters.spec[i] || cfg.pos
      g.strokeStyle = '#7de07d'
      g.lineWidth = 1.5
      g.beginPath()
      g.moveTo(ph * w, 0)
      g.lineTo(ph * w, h)
      g.stroke()
    }
  }, [buildSpectrogram, cfg, analysis, progress, meters.spec, i])

  useEffect(() => { drawAll() }, [drawAll, ctx.version, meters])

  const paint = (e: React.PointerEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
    const y = Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height))
    const curve = curveRef.current || [...cfg.filterCurve]
    curveRef.current = curve
    const xi = Math.round(x * 63)
    curve[xi] = y
    // smooth neighbors slightly for continuous strokes
    if (xi > 0) curve[xi - 1] = (curve[xi - 1] + y) / 2
    if (xi < 63) curve[xi + 1] = (curve[xi + 1] + y) / 2
    drawAll()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <canvas
        ref={canvasRef}
        onPointerDown={e => {
          drawingRef.current = true
          ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
          paint(e)
        }}
        onPointerMove={e => { if (drawingRef.current) paint(e) }}
        onPointerUp={() => {
          drawingRef.current = false
          if (curveRef.current) {
            const c = curveRef.current
            curveRef.current = null
            ctx.update(p => { p.oscs[i].spec.filterCurve = c })
          }
        }}
        style={{ width: '100%', height: 140, display: 'block', borderRadius: 8, border: '1px solid var(--border)', cursor: 'crosshair', touchAction: 'none' }}
        title="Draw the spectral filter curve"
      />
      <SamplePicker oscIndex={i} target="spec" />
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <Knob path={`osc${i}.spec.speed`} label="Speed" bipolar size={36} />
        <Knob path={`osc${i}.spec.pos`} label="Pos" size={36} />
        <Knob path={`osc${i}.spec.smear`} label="Smear" size={36} />
        <Knob path={`osc${i}.spec.shift`} label="Shift" bipolar size={36} />
        <Knob path={`osc${i}.spec.pitchShift`} label="Pitch" bipolar size={36} />
        <Knob path={`osc${i}.spec.formant`} label="Formant" bipolar size={36} />
        <Knob path={`osc${i}.spec.spread`} label="Spread" size={36} />
        <Knob path={`osc${i}.spec.gate`} label="Gate" size={36} />
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <ToggleBtn on={cfg.freeze} label="Freeze" onClick={() => ctx.update(p => { p.oscs[i].spec.freeze = !p.oscs[i].spec.freeze })} />
        <ToggleBtn on={cfg.keytrack} label="Keytrack" onClick={() => ctx.update(p => { p.oscs[i].spec.keytrack = !p.oscs[i].spec.keytrack })} />
        <label style={{ fontSize: 10, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
          Transients
          <input
            type="range" min={0} max={1} step={0.01} value={cfg.transients} className="cf-slider"
            onChange={e => ctx.update(p => { p.oscs[i].spec.transients = Number(e.target.value) })}
            style={{ width: 80 }}
          />
        </label>
        <label style={{ fontSize: 10, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
          Root
          <input
            type="number" min={0} max={127} value={cfg.rootKey}
            onChange={e => ctx.update(p => { p.oscs[i].spec.rootKey = Number(e.target.value) })}
            style={{ width: 46, background: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 6, padding: '2px 4px', fontSize: 11 }}
          />
        </label>
        <ToggleBtn on={false} label="Reset Curve" onClick={() => ctx.update(p => { p.oscs[i].spec.filterCurve = Array(64).fill(1) })} />
      </div>
    </div>
  )
}
