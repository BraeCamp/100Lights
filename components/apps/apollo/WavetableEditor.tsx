'use client'
// Wavetable editor modal: frame strip, pencil/line/step drawing, harmonic
// bin editing, formula generator, audio import, morph, export.

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useApollo, ToggleBtn, UI } from './ApolloContext'
import { WT_LEN, tableFromFormula, tableFromAudio, exportWavetableWav, tableToBase64, generateFactoryTable } from '@/lib/apollo/tables'
import { getTableData } from './WavetableView'
import { decodeFileAudio } from '@/lib/media-import'

type Tool = 'pencil' | 'line' | 'step'
const NUM_HARM = 64

function dftHarmonics(frame: Float32Array): Float32Array {
  const mags = new Float32Array(NUM_HARM)
  for (let h = 1; h <= NUM_HARM; h++) {
    let re = 0, im = 0
    for (let i = 0; i < WT_LEN; i += 4) { // stride-4 is plenty for 64 harmonics
      const ph = (2 * Math.PI * h * i) / WT_LEN
      re += frame[i] * Math.cos(ph)
      im += frame[i] * Math.sin(ph)
    }
    mags[h - 1] = (2 * Math.hypot(re, im)) / (WT_LEN / 4)
  }
  return mags
}

function resynthesize(mags: Float32Array): Float32Array {
  const out = new Float32Array(WT_LEN)
  for (let h = 1; h <= NUM_HARM; h++) {
    const m = mags[h - 1]
    if (m < 1e-4) continue
    for (let i = 0; i < WT_LEN; i++) out[i] += m * Math.sin((2 * Math.PI * h * i) / WT_LEN)
  }
  let mx = 0
  for (let i = 0; i < WT_LEN; i++) mx = Math.max(mx, Math.abs(out[i]))
  if (mx > 1e-6) for (let i = 0; i < WT_LEN; i++) out[i] /= mx
  return out
}

export default function WavetableEditor({ onClose }: { onClose: () => void }) {
  const ctx = useApollo()
  const osc = ctx.patch.oscs[ctx.selectedOsc]
  const [working, setWorking] = useState<{ frames: number; data: Float32Array }>(() => {
    const t = getTableData(ctx.patch, osc.wt.tableId) || generateFactoryTable('basic-shapes')
    return t ? { frames: t.frames, data: new Float32Array(t.data) } : { frames: 1, data: new Float32Array(WT_LEN) }
  })
  const [frame, setFrame] = useState(0)
  const [tool, setTool] = useState<Tool>('pencil')
  const [view, setView] = useState<'wave' | 'harm'>('wave')
  const [formula, setFormula] = useState('sin(2*pi*x) * (1-t) + saw(x) * t')
  const [formulaErr, setFormulaErr] = useState('')
  const [name, setName] = useState('My Table')
  const [tick, setTick] = useState(0)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stripRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const lastPt = useRef<{ x: number; y: number } | null>(null)
  const lineStart = useRef<{ x: number; y: number } | null>(null)
  const harms = useRef<Float32Array | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const bump = () => setTick(t => t + 1)

  const frameData = useCallback((f: number) => working.data.subarray(f * WT_LEN, (f + 1) * WT_LEN), [working])

  // main canvas
  useEffect(() => {
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
    g.strokeStyle = 'rgba(255,255,255,0.08)'
    g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke()
    const fd = frameData(frame)
    if (view === 'wave') {
      g.strokeStyle = UI.blue
      g.lineWidth = 1.5
      g.beginPath()
      for (let x = 0; x < w; x++) {
        const v = fd[Math.floor((x / w) * WT_LEN)]
        const y = (0.5 - v * 0.47) * h
        if (x === 0) g.moveTo(x, y)
        else g.lineTo(x, y)
      }
      g.stroke()
    } else {
      const mags = harms.current || (harms.current = dftHarmonics(fd))
      const bw = w / NUM_HARM
      for (let hI = 0; hI < NUM_HARM; hI++) {
        const v = Math.min(1, mags[hI])
        g.fillStyle = hI % 2 ? UI.blue : '#5aa2f2'
        g.fillRect(hI * bw + 1, h - v * (h - 8) - 4, bw - 2, v * (h - 8))
      }
    }
  }, [frame, view, tick, frameData])

  // frame strip
  useEffect(() => {
    const cv = stripRef.current
    if (!cv) return
    const dpr = window.devicePixelRatio || 1
    const w = cv.clientWidth, h = cv.clientHeight
    if (cv.width !== w * dpr) { cv.width = w * dpr; cv.height = h * dpr }
    const g = cv.getContext('2d')
    if (!g) return
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.fillStyle = UI.inset
    g.fillRect(0, 0, w, h)
    const fw = w / working.frames
    for (let f = 0; f < working.frames; f++) {
      const fd = frameData(f)
      g.strokeStyle = f === frame ? UI.yellow : 'rgba(120,160,220,0.5)'
      g.lineWidth = f === frame ? 1.5 : 1
      g.beginPath()
      for (let x = 0; x < fw - 2; x++) {
        const v = fd[Math.floor((x / (fw - 2)) * WT_LEN)]
        const y = (0.5 - v * 0.42) * h
        if (x === 0) g.moveTo(f * fw + x + 1, y)
        else g.lineTo(f * fw + x + 1, y)
      }
      g.stroke()
    }
  }, [working, frame, tick, frameData])

  const canvasPos = (e: React.PointerEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    return {
      x: Math.min(0.9999, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(-1, (0.5 - (e.clientY - r.top) / r.height) / 0.47)),
    }
  }

  const paintWave = (from: { x: number; y: number }, to: { x: number; y: number }) => {
    const fd = frameData(frame)
    const i0 = Math.floor(from.x * WT_LEN), i1 = Math.floor(to.x * WT_LEN)
    const lo = Math.min(i0, i1), hi = Math.max(i0, i1)
    for (let i = lo; i <= hi; i++) {
      const t = hi === lo ? 0 : (i - lo) / (hi - lo)
      const v = i0 <= i1 ? from.y + (to.y - from.y) * t : to.y + (from.y - to.y) * t
      if (tool === 'step') {
        const stepStart = Math.floor(i / (WT_LEN / 16)) * (WT_LEN / 16)
        for (let s = stepStart; s < stepStart + WT_LEN / 16 && s < WT_LEN; s++) fd[s] = v
      } else fd[i] = v
    }
    harms.current = null
    bump()
  }

  const paintHarm = (e: React.PointerEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const x = Math.min(0.999, Math.max(0, (e.clientX - r.left) / r.width))
    const y = Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height))
    const mags = harms.current || (harms.current = dftHarmonics(frameData(frame)))
    mags[Math.floor(x * NUM_HARM)] = y
    bump()
  }

  const onDown = (e: React.PointerEvent) => {
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    drawing.current = true
    if (view === 'harm') { paintHarm(e); return }
    const p = canvasPos(e)
    if (tool === 'line') { lineStart.current = p; return }
    lastPt.current = p
    paintWave(p, p)
  }
  const onMove = (e: React.PointerEvent) => {
    if (!drawing.current) return
    if (view === 'harm') { paintHarm(e); return }
    const p = canvasPos(e)
    if (tool === 'line') {
      if (lineStart.current) {
        // live preview: repaint from a snapshot would be complex; just draw incrementally on release
      }
      return
    }
    if (lastPt.current) paintWave(lastPt.current, p)
    lastPt.current = p
  }
  const onUp = (e: React.PointerEvent) => {
    if (!drawing.current) return
    drawing.current = false
    if (view === 'harm') return
    const p = canvasPos(e)
    if (tool === 'line' && lineStart.current) {
      paintWave(lineStart.current, p)
      lineStart.current = null
    }
    lastPt.current = null
  }

  const mutateFrames = (fn: (w: { frames: number; data: Float32Array }) => { frames: number; data: Float32Array }) => {
    setWorking(prev => fn(prev))
    harms.current = null
    bump()
  }

  const addFrame = (dup: boolean) => mutateFrames(prev => {
    if (prev.frames >= 256) return prev
    const data = new Float32Array((prev.frames + 1) * WT_LEN)
    data.set(prev.data.subarray(0, (frame + 1) * WT_LEN), 0)
    const src = dup ? prev.data.subarray(frame * WT_LEN, (frame + 1) * WT_LEN) : new Float32Array(WT_LEN)
    data.set(src, (frame + 1) * WT_LEN)
    data.set(prev.data.subarray((frame + 1) * WT_LEN), (frame + 2) * WT_LEN)
    setFrame(frame + 1)
    return { frames: prev.frames + 1, data }
  })

  const deleteFrame = () => mutateFrames(prev => {
    if (prev.frames <= 1) return prev
    const data = new Float32Array((prev.frames - 1) * WT_LEN)
    data.set(prev.data.subarray(0, frame * WT_LEN), 0)
    data.set(prev.data.subarray((frame + 1) * WT_LEN), frame * WT_LEN)
    setFrame(Math.max(0, frame - 1))
    return { frames: prev.frames - 1, data }
  })

  const morph = () => mutateFrames(prev => {
    if (prev.frames < 3) return prev
    const data = new Float32Array(prev.data)
    const first = prev.data.subarray(0, WT_LEN)
    const last = prev.data.subarray((prev.frames - 1) * WT_LEN, prev.frames * WT_LEN)
    for (let f = 1; f < prev.frames - 1; f++) {
      const t = f / (prev.frames - 1)
      for (let i = 0; i < WT_LEN; i++) data[f * WT_LEN + i] = first[i] * (1 - t) + last[i] * t
    }
    return { frames: prev.frames, data }
  })

  const normalize = () => {
    const fd = frameData(frame)
    let mx = 0
    for (let i = 0; i < WT_LEN; i++) mx = Math.max(mx, Math.abs(fd[i]))
    if (mx > 1e-6) for (let i = 0; i < WT_LEN; i++) fd[i] /= mx
    harms.current = null
    bump()
  }

  const runFormula = () => {
    try {
      setFormulaErr('')
      const data = tableFromFormula(formula, working.frames)
      mutateFrames(() => ({ frames: working.frames, data }))
    } catch (e) {
      setFormulaErr(e instanceof Error ? e.message : 'Formula error')
    }
  }

  const applyHarms = () => {
    if (!harms.current) return
    const out = resynthesize(harms.current)
    frameData(frame).set(out)
    setView('wave')
    bump()
  }

  const useInOsc = () => {
    const id = 'user_' + Date.now().toString(36)
    const data = new Float32Array(working.data)
    ctx.engine.sendTable(id, working.frames, data)
    ctx.update(p => {
      p.userTables[id] = { name: name || 'My Table', frames: working.frames, data: tableToBase64(data) }
      p.oscs[ctx.selectedOsc].wt.tableId = id
      p.oscs[ctx.selectedOsc].engine = 'wavetable'
    })
    onClose()
  }

  const fromSample = async (f: File) => {
    try {
      const buf = await decodeFileAudio(f)
      const mono = buf.getChannelData(0)
      mutateFrames(prev => ({ frames: prev.frames, data: tableFromAudio(new Float32Array(mono), prev.frames) }))
    } catch { setFormulaErr('Could not decode audio') }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', zIndex: 400, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14, padding: 14, width: 'min(760px, 95vw)', maxHeight: '92vh', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-primary)' }}>Wavetable Editor</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 16 }}>✕</button>
        </div>
        <canvas
          ref={stripRef}
          onPointerDown={e => {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
            setFrame(Math.min(working.frames - 1, Math.floor(((e.clientX - r.left) / r.width) * working.frames)))
          }}
          style={{ width: '100%', height: 46, display: 'block', borderRadius: 8, border: '1px solid var(--border)', cursor: 'pointer' }}
          title="Click to select a frame"
        />
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>Frame {frame + 1}/{working.frames}</span>
          <ToggleBtn on={false} label="+ Blank" onClick={() => addFrame(false)} />
          <ToggleBtn on={false} label="⧉ Dup" onClick={() => addFrame(true)} />
          <ToggleBtn on={false} label="✕ Del" onClick={deleteFrame} />
          <ToggleBtn on={false} label="Morph 1→N" title="Interpolate all middle frames between first and last" onClick={morph} />
          <ToggleBtn on={false} label="Normalize" onClick={normalize} />
          <div style={{ flex: 1 }} />
          <ToggleBtn on={view === 'wave'} label="Wave" onClick={() => setView('wave')} />
          <ToggleBtn on={view === 'harm'} label="Harmonics" onClick={() => { harms.current = null; setView('harm') }} />
          {view === 'harm' && <ToggleBtn on={false} label="Apply" accent="var(--success)" onClick={applyHarms} />}
          {view === 'wave' && (['pencil', 'line', 'step'] as Tool[]).map(tl => (
            <ToggleBtn key={tl} on={tool === tl} label={tl} onClick={() => setTool(tl)} />
          ))}
        </div>
        <canvas
          ref={canvasRef}
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}
          style={{ width: '100%', height: 200, display: 'block', borderRadius: 8, border: '1px solid var(--border)', cursor: 'crosshair', touchAction: 'none' }}
        />
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700 }}>f(x,t) =</span>
          <input
            value={formula} onChange={e => setFormula(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') runFormula() }}
            spellCheck={false}
            style={{ flex: 1, minWidth: 180, background: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 8px', fontSize: 11, fontFamily: 'ui-monospace, monospace' }}
          />
          <ToggleBtn on={false} label="Run" onClick={runFormula} />
          {formulaErr && <span style={{ fontSize: 10, color: 'var(--error)' }}>{formulaErr}</span>}
        </div>
        <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>
          x = phase 0..1 · t = frame 0..1 · sin cos tan sqrt pow exp log abs floor min max sign tri(x) saw(x) sqr(x) noise() pi
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <ToggleBtn on={false} label="From Sample…" onClick={() => fileRef.current?.click()} />
          <input ref={fileRef} type="file" accept="audio/*" style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void fromSample(f) }} />
          <ToggleBtn on={false} label="Export .wav" title="Serum-compatible 2048-sample-per-frame wavetable" onClick={() => {
            const blob = exportWavetableWav(working.data)
            const a = document.createElement('a')
            a.href = URL.createObjectURL(blob)
            a.download = `${name || 'wavetable'}.wav`
            a.click()
            URL.revokeObjectURL(a.href)
          }} />
          <div style={{ flex: 1 }} />
          <input
            value={name} onChange={e => setName(e.target.value)} placeholder="Table name"
            style={{ width: 120, background: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 8px', fontSize: 11 }}
          />
          <ToggleBtn on label="Use in OSC" accent="var(--success)" onClick={useInOsc} />
        </div>
      </div>
    </div>
  )
}
