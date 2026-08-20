'use client'
// Dual filter section: 30+ filter types, serial/parallel routing,
// per-source routing buttons (S A B C N).

import React, { useCallback, useEffect, useRef } from 'react'
import { useApollo, Knob, Sel, Section, ToggleBtn, UI } from './ApolloContext'
import { FILTER_TYPES, FilterType, SourceDest, BusDest } from '@/lib/apollo/patch'

// ── Filter response display (Serum/Vital-style): approximate magnitude curve
// with a live output-spectrum underlay. Dragging ON the curve edits this
// filter — x = cutoff, y = resonance — via the same params the knobs use.
const SLOPES: Partial<Record<FilterType, number>> = {
  lp6: 6, lp12: 12, lp18: 18, lp24: 24, hp6: 6, hp12: 12, hp24: 24,
  bp12: 12, bp24: 24, notch12: 12, peak12: 12,
  ladder12: 12, ladder24: 24, germanLP: 24, frenchLP: 24,
}
function responseDb(type: FilterType, x: number, cutoff: number, res: number, fat: number): number {
  const OCT_SPAN = 10 // display axis ≈ 10 octaves
  const d = (x - cutoff) * OCT_SPAN
  const slope = SLOPES[type] ?? 12
  const peak = res * 24 * Math.exp(-(d * d) / (2 * 0.18 * 0.18))
  const lp = (dd: number) => (dd > 0 ? -slope * dd : 0)
  const hp = (dd: number) => (dd < 0 ? slope * dd : 0)
  if (type.startsWith('lp') || type.startsWith('ladder') || type === 'germanLP' || type === 'frenchLP') return lp(d) + peak
  if (type.startsWith('hp')) return hp(d) + peak
  if (type.startsWith('bp')) return -Math.abs(d) * slope + peak
  if (type === 'notch12') return -res * 30 * Math.exp(-(d * d) / (2 * 0.12 * 0.12))
  if (type === 'peak12') return peak
  if (type === 'multiLBH' || type === 'multiLNH' || type === 'morphSVF') {
    // morph LP → (band/notch) → HP by fat
    const a = fat * 2
    if (a <= 1) return lp(d) * (1 - a) + (-Math.abs(d) * slope) * a + peak
    return (-Math.abs(d) * slope) * (2 - a) + hp(d) * (a - 1) + peak
  }
  if (type === 'formant') {
    const centers = [cutoff - 0.12 + fat * 0.05, cutoff + 0.08 + fat * 0.1]
    let out = -14
    for (const c of centers) {
      const dd = (x - c) * OCT_SPAN
      out = Math.max(out, (10 + res * 14) * Math.exp(-(dd * dd) / (2 * 0.12 * 0.12)) - 14)
    }
    return out
  }
  if (type.startsWith('comb') || type.startsWith('flange') || type.startsWith('phase')) {
    return Math.cos((x - cutoff) * 46) * (4 + res * 14) - 2
  }
  return -Math.abs(d) * 4 // stylized fallback for the exotic types
}

function FilterResponse({ fi }: { fi: 0 | 1 }) {
  const ctx = useApollo()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const dragging = useRef(false)
  const W = 300, H = 64

  const draw = useCallback(() => {
    const cv = canvasRef.current
    if (!cv) return
    const cfg = ctx.patch.filters[fi]
    const dpr = window.devicePixelRatio || 1
    if (cv.width !== W * dpr) { cv.width = W * dpr; cv.height = H * dpr }
    const g = cv.getContext('2d')
    if (!g) return
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, W, H)
    g.fillStyle = 'rgba(0,0,0,0.28)'
    g.fillRect(0, 0, W, H)
    const an = ctx.engine.analyser
    if (an && ctx.engine.meters.peak > 0.001) {
      const bins = new Uint8Array(an.frequencyBinCount)
      an.getByteFrequencyData(bins)
      const sr = ctx.engine.ctx?.sampleRate ?? 48000
      g.fillStyle = 'rgba(111,208,140,0.15)'
      for (let px = 0; px < W; px += 2) {
        const fHz = 20 * Math.pow(1000, px / W)
        const bin = Math.min(bins.length - 1, Math.round(fHz / (sr / 2) * bins.length))
        const h = (bins[bin] / 255) * (H - 4)
        g.fillRect(px, H - h, 2, h)
      }
    }
    g.strokeStyle = cfg.enabled ? UI.blue : 'rgba(255,255,255,0.2)'
    g.lineWidth = 1.6
    g.beginPath()
    for (let px = 0; px <= W; px++) {
      const db = responseDb(cfg.type, px / W, cfg.cutoff, cfg.res, cfg.fat)
      const y = Math.min(H - 2, Math.max(2, H * 0.32 - (db / 36) * H * 0.6))
      if (px === 0) g.moveTo(px, y); else g.lineTo(px, y)
    }
    g.stroke()
    // cutoff handle
    const hx = cfg.cutoff * W
    const hy = Math.min(H - 4, Math.max(4, H * 0.32 - (responseDb(cfg.type, cfg.cutoff, cfg.cutoff, cfg.res, cfg.fat) / 36) * H * 0.6))
    g.fillStyle = cfg.enabled ? UI.blue : 'rgba(255,255,255,0.3)'
    g.beginPath(); g.arc(hx, hy, 4, 0, Math.PI * 2); g.fill()
  }, [ctx, fi])

  useEffect(() => {
    draw()
    const eng = ctx.engine
    const onMeters = () => { if (eng.meters.peak > 0.001 || dragging.current) draw() }
    eng.addEventListener('meters', onMeters)
    return () => eng.removeEventListener('meters', onMeters)
  }, [draw, ctx.version, ctx.engine])

  const apply = (e: React.PointerEvent) => {
    if (!dragging.current) return
    if (e.type === 'pointermove' && e.buttons === 0) { dragging.current = false; ctx.commit(); return }
    const r = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect()
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
    const y = Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height))
    ctx.setParam(`f${fi + 1}.cutoff`, x)
    ctx.setParam(`f${fi + 1}.res`, y)
    draw()
  }
  return (
    <canvas
      ref={canvasRef}
      data-learn="Filter display"
      title="The filter's frequency response — drag: left/right = cutoff, up/down = resonance"
      style={{ width: '100%', height: H, borderRadius: 6, touchAction: 'none', cursor: 'crosshair' }}
      onPointerDown={e => { dragging.current = true; e.currentTarget.setPointerCapture?.(e.pointerId); apply(e) }}
      onPointerMove={apply}
      onPointerUp={() => { if (dragging.current) { dragging.current = false; ctx.commit() } }}
      onPointerCancel={() => { if (dragging.current) { dragging.current = false; ctx.commit() } }}
    />
  )
}

// toggle whether a source feeds filter `fi`, preserving its other-filter routing
function toggleDest(dest: SourceDest, fi: 0 | 1): SourceDest {
  const mine: SourceDest = fi === 0 ? 'f1' : 'f2'
  const other: SourceDest = fi === 0 ? 'f2' : 'f1'
  const feeds = dest === mine || dest === 'both'
  if (feeds) return dest === 'both' ? other : 'bypass'
  return dest === other ? 'both' : mine
}

function SourceButtons({ fi }: { fi: 0 | 1 }) {
  const ctx = useApollo()
  const p = ctx.patch
  const mine: SourceDest = fi === 0 ? 'f1' : 'f2'
  const feeds = (d: SourceDest) => d === mine || d === 'both'
  const items: { label: string; on: boolean; toggle: () => void }[] = [
    { label: 'S', on: feeds(p.sub.dest), toggle: () => ctx.update(pp => { pp.sub.dest = toggleDest(pp.sub.dest, fi) }) },
    ...([0, 1, 2] as const).map(oi => ({
      label: 'ABC'[oi], on: feeds(p.oscs[oi].dest),
      toggle: () => ctx.update(pp => { pp.oscs[oi].dest = toggleDest(pp.oscs[oi].dest, fi) }),
    })),
    { label: 'N', on: feeds(p.noise.dest), toggle: () => ctx.update(pp => { pp.noise.dest = toggleDest(pp.noise.dest, fi) }) },
  ]
  return (
    <div style={{ display: 'flex', gap: 2 }} title="Which sources feed this filter">
      {items.map(it => (
        <button
          key={it.label}
          onClick={it.toggle}
          style={{
            width: 20, height: 18, borderRadius: 4, fontSize: 9, fontWeight: 800, cursor: 'pointer',
            background: it.on ? UI.blue : '#14181e',
            color: it.on ? '#0b0d10' : UI.dim,
            border: `1px solid ${it.on ? UI.blue : UI.border}`,
            padding: 0, transition: 'background 100ms',
          }}
        >{it.label}</button>
      ))}
    </div>
  )
}

const FAT_LABEL: Partial<Record<FilterType, string>> = {
  multiLBH: 'Morph', multiLNH: 'Morph', morphSVF: 'Morph', formant: 'Vowel', ringMod: 'Mix',
}

function FilterSlot({ fi }: { fi: 0 | 1 }) {
  const ctx = useApollo()
  const cfg = ctx.patch.filters[fi]
  const pfx = `f${fi + 1}`
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minWidth: 220, opacity: cfg.enabled ? 1 : 0.55 }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <ToggleBtn on={cfg.enabled} label={`FILTER ${fi + 1}`} onClick={() => ctx.update(p => { p.filters[fi].enabled = !p.filters[fi].enabled })} />
        <Sel
          value={cfg.type}
          options={FILTER_TYPES.map(t => ({ value: t.id, label: t.label, group: t.group }))}
          onChange={v => ctx.update(p => { p.filters[fi].type = v as FilterType })}
          width={120}
        />
        <SourceButtons fi={fi} />
        <Sel width={64} title="FX lane for this filter's output" value={cfg.bus || 'main'} options={[
          { value: 'main', label: 'Main' }, { value: 'bus1', label: 'Bus 1' },
          { value: 'bus2', label: 'Bus 2' }, { value: 'direct', label: 'Direct' },
        ]} onChange={v => ctx.update(p => { p.filters[fi].bus = v as BusDest })} />
      </div>
      <FilterResponse fi={fi} />
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
        <Knob path={`${pfx}.cutoff`} label="Cutoff" size={42} />
        <Knob path={`${pfx}.res`} label="Res" size={36} />
        <Knob path={`${pfx}.drive`} label="Drive" size={36} />
        <Knob path={`${pfx}.fat`} label={FAT_LABEL[cfg.type] || 'Fat'} size={36} />
        <Knob path={`${pfx}.mix`} label="Mix" size={36} />
        <Knob path={`${pfx}.pan`} label="Pan" bipolar size={36} />
        <Knob label="Key" size={36} min={0} max={1} def={0} value={cfg.keytrack}
          onChange={v => { ctx.update(p => { p.filters[fi].keytrack = v }) }} />
      </div>
    </div>
  )
}

export default function FilterPanel() {
  const ctx = useApollo()
  const dice = () => {
    const r = (a: number, b: number) => a + Math.random() * (b - a)
    const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)]
    const types: FilterType[] = ['lp12', 'lp24', 'ladder24', 'multiLBH', 'morphSVF', 'formant', 'combPlus', 'bp12', 'notch12']
    ctx.update(p => {
      p.filters[0].enabled = true
      p.filters[0].type = pick(types)
      p.filters[0].cutoff = r(0.25, 0.85)
      p.filters[0].res = r(0, 0.55)
      p.filters[0].drive = r(0, 0.4)
    })
  }
  return (
    <Section
      title="Filters"
      dice={dice}
      right={
        <div style={{ display: 'flex', gap: 4 }}>
          <ToggleBtn on={ctx.patch.filterRouting === 'serial'} label="Serial" onClick={() => ctx.update(p => { p.filterRouting = 'serial' })} />
          <ToggleBtn on={ctx.patch.filterRouting === 'parallel'} label="Parallel" onClick={() => ctx.update(p => { p.filterRouting = 'parallel' })} />
        </div>
      }
    >
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        <FilterSlot fi={0} />
        <FilterSlot fi={1} />
      </div>
    </Section>
  )
}
