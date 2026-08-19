'use client'
// Apollo envelope editor: 4 envelopes, canvas ADSR with draggable handles +
// per-stage curve drag, live output overlay, knob row below.

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useApollo, useMeters, Knob, ToggleBtn, Section } from '@/components/apps/apollo/ApolloContext'
import { EnvConfig } from '@/lib/apollo/patch'

const W = 480
const H = 150
const PAD = 10
const T_MIN = 0.001
const T_MAX = 20

const logNorm = (t: number): number => (t <= T_MIN ? 0 : Math.min(1, Math.log(t / T_MIN) / Math.log(T_MAX / T_MIN)))
const invLogNorm = (n: number): number => Math.min(T_MAX, Math.max(T_MIN, T_MIN * Math.pow(T_MAX / T_MIN, Math.min(1, Math.max(0, n)))))
const curveShape = (t: number, c: number): number => {
  if (c === 0) return t
  const k = Math.pow(4, Math.abs(c) * 2)
  return c > 0 ? Math.pow(t, k) : 1 - Math.pow(1 - t, k)
}
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))
const fmtTime = (v: number): string => (v < 1 ? `${(v * 1000).toFixed(0)}ms` : `${v.toFixed(2)}s`)

type DragMode = 'a' | 'd' | 's' | 'r' | 'ca' | 'cd' | 'cr' | null

interface Layout {
  xA0: number; xA1: number; xH1: number; xD1: number; xS1: number; xR1: number; ySus: number
}

function layoutOf(env: EnvConfig): Layout {
  const span = W - 2 * PAD
  const wA = (0.04 + 0.21 * logNorm(env.attack)) * span
  const wH = env.hold > 0 ? (0.015 + 0.07 * logNorm(env.hold)) * span : 0
  const wD = (0.04 + 0.21 * logNorm(env.decay)) * span
  const wS = 0.13 * span
  const wR = (0.04 + 0.21 * logNorm(env.release)) * span
  const xA0 = PAD
  const xA1 = xA0 + wA
  const xH1 = xA1 + wH
  const xD1 = xH1 + wD
  const xS1 = xD1 + wS
  const xR1 = Math.min(W - PAD, xS1 + wR)
  const ySus = PAD + (1 - env.sustain) * (H - 2 * PAD)
  return { xA0, xA1, xH1, xD1, xS1, xR1, ySus }
}

export default function EnvPanel() {
  const ctx = useApollo()
  const meters = useMeters()
  const [sel, setSel] = useState(0)
  const [env, setEnv] = useState<EnvConfig>({ ...ctx.patch.envs[0] })
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const dragRef = useRef<{ mode: DragMode; startY: number; startC: number } | null>(null)
  const envRef = useRef(env)
  envRef.current = env

  // sync local mirror from patch when tab or patch version changes
  useEffect(() => {
    setEnv({ ...ctx.patch.envs[sel] })
  }, [sel, ctx.version, ctx.patch])

  const commit = useCallback(() => {
    const cur = envRef.current
    ctx.update(p => { Object.assign(p.envs[sel], cur) })
  }, [ctx, sel])

  // ---- drawing ----
  useEffect(() => {
    const cv = canvasRef.current
    if (!cv) return
    const dpr = window.devicePixelRatio || 1
    if (cv.width !== W * dpr) { cv.width = W * dpr; cv.height = H * dpr }
    const g = cv.getContext('2d')
    if (!g) return
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, W, H)
    const st = getComputedStyle(cv)
    const accent = st.getPropertyValue('--accent').trim() || '#3d8fef'
    const border = st.getPropertyValue('--border').trim() || '#333'
    const textMuted = st.getPropertyValue('--text-muted').trim() || '#888'
    const L = layoutOf(env)
    const yTop = PAD
    const yBot = H - PAD
    // grid
    g.strokeStyle = border
    g.lineWidth = 1
    g.globalAlpha = 0.5
    for (let i = 1; i < 4; i++) {
      const y = PAD + (i / 4) * (H - 2 * PAD)
      g.beginPath(); g.moveTo(PAD, y); g.lineTo(W - PAD, y); g.stroke()
    }
    g.globalAlpha = 1
    // envelope path
    g.strokeStyle = accent
    g.lineWidth = 2
    g.beginPath()
    g.moveTo(L.xA0, yBot)
    const steps = 40
    for (let i = 1; i <= steps; i++) {
      const t = i / steps
      g.lineTo(L.xA0 + t * (L.xA1 - L.xA0), yBot - curveShape(t, env.aCurve) * (yBot - yTop))
    }
    g.lineTo(L.xH1, yTop)
    for (let i = 1; i <= steps; i++) {
      const t = i / steps
      const lvl = 1 - curveShape(t, env.dCurve) * (1 - env.sustain)
      g.lineTo(L.xH1 + t * (L.xD1 - L.xH1), yBot - lvl * (yBot - yTop))
    }
    g.lineTo(L.xS1, L.ySus)
    for (let i = 1; i <= steps; i++) {
      const t = i / steps
      const lvl = env.sustain * (1 - curveShape(t, env.rCurve))
      g.lineTo(L.xS1 + t * (L.xR1 - L.xS1), yBot - lvl * (yBot - yTop))
    }
    g.stroke()
    // fill under curve
    g.lineTo(L.xR1, yBot)
    g.lineTo(L.xA0, yBot)
    g.globalAlpha = 0.12
    g.fillStyle = accent
    g.fill()
    g.globalAlpha = 1
    // handles
    const handles: [number, number][] = [[L.xA1, yTop], [L.xD1, L.ySus], [(L.xD1 + L.xS1) / 2, L.ySus], [L.xR1, yBot]]
    for (const [hx, hy] of handles) {
      g.beginPath()
      g.arc(hx, hy, 4.5, 0, Math.PI * 2)
      g.fillStyle = '#fff'
      g.fill()
      g.strokeStyle = accent
      g.stroke()
    }
    // live env output
    const lvl = meters.env[sel] || 0
    if (lvl > 0.001) {
      const y = yBot - lvl * (yBot - yTop)
      g.globalAlpha = 0.35
      g.strokeStyle = textMuted
      g.beginPath(); g.moveTo(PAD, y); g.lineTo(W - PAD, y); g.stroke()
      g.globalAlpha = 1
      g.fillStyle = accent
      g.beginPath(); g.arc(PAD + 3, y, 3.5, 0, Math.PI * 2); g.fill()
    }
  }, [env, sel, meters.env])

  // ---- pointer editing ----
  const toLocal = (e: React.PointerEvent): [number, number] => {
    const cv = canvasRef.current
    if (!cv) return [0, 0]
    const r = cv.getBoundingClientRect()
    return [(e.clientX - r.left) * (W / r.width), (e.clientY - r.top) * (H / r.height)]
  }

  const onPointerDown = (e: React.PointerEvent) => {
    const [x, y] = toLocal(e)
    const L = layoutOf(envRef.current)
    const yTop = PAD, yBot = H - PAD
    const near = (hx: number, hy: number) => Math.hypot(x - hx, y - hy) < 11
    let mode: DragMode = null
    if (near(L.xA1, yTop)) mode = 'a'
    else if (near(L.xD1, L.ySus)) mode = 'd'
    else if (near((L.xD1 + L.xS1) / 2, L.ySus)) mode = 's'
    else if (near(L.xR1, yBot)) mode = 'r'
    else if (x >= L.xA0 && x <= L.xA1) mode = 'ca'
    else if (x >= L.xH1 && x <= L.xD1) mode = 'cd'
    else if (x >= L.xS1 && x <= L.xR1) mode = 'cr'
    if (!mode) return
    const startC = mode === 'ca' ? envRef.current.aCurve : mode === 'cd' ? envRef.current.dCurve : envRef.current.rCurve
    dragRef.current = { mode, startY: y, startC }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current
    if (!d) return
    const [x, y] = toLocal(e)
    const span = W - 2 * PAD
    const cur = { ...envRef.current }
    const L = layoutOf(cur)
    switch (d.mode) {
      case 'a': {
        const n = ((x - L.xA0) / span - 0.04) / 0.21
        cur.attack = invLogNorm(n)
        ctx.setParam(`env${sel + 1}.attack`, cur.attack)
        break
      }
      case 'd': {
        const n = ((x - L.xH1) / span - 0.04) / 0.21
        cur.decay = invLogNorm(n)
        ctx.setParam(`env${sel + 1}.decay`, cur.decay)
        break
      }
      case 's': {
        cur.sustain = clamp01(1 - (y - PAD) / (H - 2 * PAD))
        ctx.setParam(`env${sel + 1}.sustain`, cur.sustain)
        break
      }
      case 'r': {
        const n = ((x - L.xS1) / span - 0.04) / 0.21
        cur.release = invLogNorm(n)
        ctx.setParam(`env${sel + 1}.release`, cur.release)
        break
      }
      case 'ca': cur.aCurve = Math.min(1, Math.max(-1, d.startC + (y - d.startY) / 80)); break
      case 'cd': cur.dCurve = Math.min(1, Math.max(-1, d.startC + (d.startY - y) / 80)); break
      case 'cr': cur.rCurve = Math.min(1, Math.max(-1, d.startC + (d.startY - y) / 80)); break
    }
    setEnv(cur)
  }

  const onPointerUp = () => {
    if (!dragRef.current) return
    dragRef.current = null
    commit()
  }

  const n = sel + 1
  const knobCommit = (field: keyof EnvConfig) => (v: number) => {
    setEnv(prev => {
      const next = { ...prev, [field]: v }
      envRef.current = next
      return next
    })
  }

  return (
    <Section
      title="Envelopes"
      right={
        <div style={{ display: 'flex', gap: 4 }}>
          {[0, 1, 2, 3].map(i => (
            <ToggleBtn key={i} on={sel === i} label={i === 0 ? 'ENV 1 (amp)' : `ENV ${i + 1}`} onClick={() => setSel(i)} />
          ))}
        </div>
      }
    >
      <canvas
        ref={canvasRef}
        style={{ width: '100%', maxWidth: W, height: H, touchAction: 'none', cursor: 'crosshair', background: 'var(--bg-surface)', borderRadius: 8, border: '1px solid var(--border)' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      />
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <Knob path={`env${n}.attack`} min={0.001} label="Attack" format={fmtTime} log />
        <Knob
          value={env.hold} min={0} max={5} def={0} label="Hold" format={fmtTime}
          onChange={knobCommit('hold')} onCommit={commit}
        />
        <Knob path={`env${n}.decay`} min={0.001} label="Decay" format={fmtTime} log />
        <Knob path={`env${n}.sustain`} label="Sustain" format={v => `${(v * 100).toFixed(0)}%`} />
        <Knob path={`env${n}.release`} min={0.001} label="Release" format={fmtTime} log />
        <div style={{ width: 8 }} />
        <Knob value={env.aCurve} min={-1} max={1} def={-0.4} label="A Crv" bipolar onChange={knobCommit('aCurve')} onCommit={commit} />
        <Knob value={env.dCurve} min={-1} max={1} def={-0.5} label="D Crv" bipolar onChange={knobCommit('dCurve')} onCommit={commit} />
        <Knob value={env.rCurve} min={-1} max={1} def={-0.5} label="R Crv" bipolar onChange={knobCommit('rCurve')} onCommit={commit} />
        <div style={{ flex: 1 }} />
        <ToggleBtn
          on={env.bpmSync} label="BPM"
          onClick={() => { const next = { ...env, bpmSync: !env.bpmSync }; envRef.current = next; setEnv(next); commit() }}
          title="Times scale with tempo (authored at 120 BPM)"
        />
        <ToggleBtn
          on={env.legato} label="Legato"
          onClick={() => { const next = { ...env, legato: !env.legato }; envRef.current = next; setEnv(next); commit() }}
          title="In legato mode this envelope does not retrigger on overlapping notes"
        />
      </div>
    </Section>
  )
}
