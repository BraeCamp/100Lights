'use client'
// One oscillator strip (A/B/C tabs): engine selector, common voicing
// controls, and the per-engine editor view.

import React, { useCallback, useEffect, useRef } from 'react'
import { useApollo, Knob, Sel, Section, ToggleBtn, UI } from './ApolloContext'
import { WARP_MODES, OscEngine, UnisonMode, SourceDest, BusDest, WarpMode , SpecWarpMode } from '@/lib/apollo/patch'
import { FACTORY_TABLE_IDS, FACTORY_TABLE_NAMES, frameHarmonics, warpHarmonics } from '@/lib/apollo/tables'
import WavetableView, { getTableData } from './WavetableView'
import SampleView from './SampleView'
import GranularView from './GranularView'
import SpectralView from './SpectralView'
import MultisamplePanel from './MultisamplePanel'
import { CurveEditor } from './ModMatrixPanel'

const ENGINE_OPTS = [
  { value: 'wavetable', label: 'Wavetable' }, { value: 'sample', label: 'Sample' },
  { value: 'multisample', label: 'Multisample' }, { value: 'granular', label: 'Granular' },
  { value: 'spectral', label: 'Spectral' },
]
const UNI_MODES = [
  { value: 'classic', label: 'Classic' }, { value: 'harmonic', label: 'Harmonic' },
  { value: 'ratio', label: 'Ratio' }, { value: 'semitone', label: 'Semitone' }, { value: 'step', label: 'Step' },
]
const DEST_OPTS = [
  { value: 'f1', label: '→ F1' }, { value: 'f2', label: '→ F2' },
  { value: 'both', label: '→ F1+F2' }, { value: 'bypass', label: 'Bypass' },
]
const BUS_OPTS = [
  { value: 'main', label: 'Main' }, { value: 'bus1', label: 'Bus 1' },
  { value: 'bus2', label: 'Bus 2' }, { value: 'direct', label: 'Direct' },
]

const stepBtn: React.CSSProperties = {
  background: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--border)',
  borderRadius: 4, width: 18, height: 18, fontSize: 11, cursor: 'pointer', lineHeight: 1, padding: 0,
}

function Stepper({ value, min, max, label, onChange }: { value: number; min: number; max: number; label: string; onChange: (v: number) => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        <button style={stepBtn} onClick={() => onChange(Math.max(min, value - 1))}>−</button>
        <span style={{ fontSize: 11, color: 'var(--text-primary)', width: 22, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>{value}</span>
        <button style={stepBtn} onClick={() => onChange(Math.min(max, value + 1))}>+</button>
      </div>
      <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>{label}</span>
    </div>
  )
}

// ── Spectral bands: the current frame's harmonics as bars, with the spectral
// warp's reshaping previewed live (dim = original, bright = after the warp).
function SpectralBands({ oscIndex }: { oscIndex: number }) {
  const ctx = useApollo()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const W = 300, H = 54

  const draw = useCallback(() => {
    const cv = canvasRef.current
    if (!cv) return
    const cfg = ctx.patch.oscs[oscIndex]
    const tbl = getTableData(ctx.patch, cfg.wt.tableId)
    const dpr = window.devicePixelRatio || 1
    if (cv.width !== W * dpr) { cv.width = W * dpr; cv.height = H * dpr }
    const g = cv.getContext('2d')
    if (!g) return
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, W, H)
    g.fillStyle = 'rgba(0,0,0,0.28)'
    g.fillRect(0, 0, W, H)
    if (!tbl) return
    const BINS = 96
    const framePos = cfg.wt.pos * (tbl.frames - 1)
    const base = frameHarmonics(tbl.data, tbl.frames, framePos, BINS)
    const sw = cfg.wt.specWarp
    const warped = sw && sw.mode !== 'off' && sw.amount > 0 ? warpHarmonics(base, sw.mode, sw.amount) : null
    const bw = W / BINS
    for (let k = 0; k < BINS; k++) {
      const hb = Math.pow(base[k], 0.6) * (H - 4)
      g.fillStyle = warped ? 'rgba(255,255,255,0.14)' : 'rgba(124,159,212,0.55)'
      g.fillRect(k * bw + 0.5, H - hb, bw - 1, hb)
      if (warped) {
        const hw = Math.pow(Math.min(1, warped[k]), 0.6) * (H - 4)
        g.fillStyle = 'rgba(224,179,85,0.85)'
        g.fillRect(k * bw + 0.5, H - hw, bw - 1, hw)
      }
    }
  }, [ctx, oscIndex])

  // redraw on structural changes + while knobs drag (meters tick ~90 Hz, but
  // only while audio runs — also listen cheaply during silent editing)
  useEffect(() => {
    draw()
    const eng = ctx.engine
    let last = ''
    const onMeters = () => {
      const cfg = ctx.patch.oscs[oscIndex]
      const key = `${cfg.wt.tableId}|${cfg.wt.pos.toFixed(3)}|${cfg.wt.specWarp?.mode}|${(cfg.wt.specWarp?.amount ?? 0).toFixed(3)}`
      if (key !== last) { last = key; draw() }
    }
    eng.addEventListener('meters', onMeters)
    return () => eng.removeEventListener('meters', onMeters)
  }, [draw, ctx.version, ctx.engine, oscIndex])

  return (
    <canvas
      ref={canvasRef}
      data-learn="Spectral bands"
      title="The frame's harmonics — amber shows how the spectral warp reshapes them"
      style={{ width: '100%', height: H, borderRadius: 6, border: '1px solid var(--border)' }}
    />
  )
}

// `osc` (optional — Apollo 2's voice chain renders one panel per oscillator):
// pin the panel to a specific oscillator instead of the shared selection, and
// hide the A/B/C switcher (each osc has its own chain segment there).
export default function OscPanel({ osc: oscProp }: { osc?: number } = {}) {
  const ctx = useApollo()
  const i = oscProp ?? ctx.selectedOsc
  const osc = ctx.patch.oscs[i]
  const isFmWarp = (m: WarpMode) => m === 'fm' || m === 'am' || m === 'rm'

  const tableOpts = [
    ...FACTORY_TABLE_IDS.map(id => ({ value: id, label: FACTORY_TABLE_NAMES[id] || id, group: 'Factory' })),
    ...Object.entries(ctx.patch.userTables).map(([id, t]) => ({ value: id, label: t.name, group: 'User' })),
  ]

  return (
    <Section
      title={`Oscillator ${'ABC'[i]}`}
      right={oscProp != null ? undefined : (
        <div style={{ display: 'flex', gap: 4 }}>
          {[0, 1, 2].map(oi => (
            <button
              key={oi}
              onClick={() => ctx.setSelectedOsc(oi)}
              style={{
                display: 'flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 6,
                background: oi === i ? 'var(--accent)' : 'var(--bg-surface)',
                color: oi === i ? '#fff' : 'var(--text-secondary)',
                border: '1px solid ' + (oi === i ? 'var(--accent)' : 'var(--border)'),
                fontSize: 10, fontWeight: 700, cursor: 'pointer',
              }}
            >
              <span
                onClick={e => { e.stopPropagation(); ctx.update(p => { p.oscs[oi].enabled = !p.oscs[oi].enabled }) }}
                title={ctx.patch.oscs[oi].enabled ? 'Disable' : 'Enable'}
                style={{
                  width: 7, height: 7, borderRadius: '50%',
                  background: ctx.patch.oscs[oi].enabled ? UI.green : 'var(--border-light)',
                  display: 'inline-block', cursor: 'pointer',
                }}
              />
              {'ABC'[oi]}
            </button>
          ))}
        </div>
      )}
    >
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <Sel width={104} value={osc.engine} options={ENGINE_OPTS} onChange={v => {
          ctx.update(p => { p.oscs[i].engine = v as OscEngine })
          const cfg = ctx.patch.oscs[i]
          if (v === 'spectral' && cfg.spec.sampleId) void ctx.engine.ensureSpectral(cfg.spec.sampleId)
        }} />
        <Stepper label="Octave" value={osc.octave} min={-4} max={4} onChange={v => ctx.update(p => { p.oscs[i].octave = v })} />
        <Knob path={`osc${i}.semi`} label="Semi" bipolar size={34} />
        <Knob path={`osc${i}.fine`} label="Fine" bipolar size={34} />
        <Stepper label="Unison" value={osc.unison} min={1} max={16} onChange={v => ctx.update(p => { p.oscs[i].unison = v })} />
        <Knob path={`osc${i}.detune`} label="Detune" size={34} />
        <Knob path={`osc${i}.blend`} label="Blend" size={34} />
        <Knob path={`osc${i}.width`} label="Width" size={34} />
        <Sel width={86} title="Unison tuning mode" value={osc.unisonMode} options={UNI_MODES} onChange={v => ctx.update(p => { p.oscs[i].unisonMode = v as UnisonMode })} />
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <Knob path={`osc${i}.level`} label="Level" size={38} />
        <Knob path={`osc${i}.pan`} label="Pan" bipolar size={34} />
        <Knob path={`osc${i}.phase`} label="Phase" size={34} />
        <Knob label="Rand" size={34} min={0} max={1} def={1} value={osc.rand}
          onChange={v => ctx.setParam(`osc${i}.rand`, v)} onCommit={() => ctx.commit()} />
        <ToggleBtn on={!osc.keytrackPitch} label="Const Pitch" title="Ignore the played key's pitch"
          onClick={() => ctx.update(p => { p.oscs[i].keytrackPitch = !p.oscs[i].keytrackPitch })} />
        <Sel width={82} title="Filter routing" value={osc.dest} options={DEST_OPTS} onChange={v => ctx.update(p => { p.oscs[i].dest = v as SourceDest })} />
        <Sel width={68} title="Output bus" value={osc.bus} options={BUS_OPTS} onChange={v => ctx.update(p => { p.oscs[i].bus = v as BusDest })} />
      </div>

      {osc.engine === 'wavetable' && (
        <>
          <WavetableView />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <Sel width={130} value={osc.wt.tableId} options={tableOpts} onChange={v => {
              ctx.engine.ensureTable(v, ctx.patch)
              ctx.update(p => { p.oscs[i].wt.tableId = v })
            }} />
            <Knob path={`osc${i}.wt.pos`} label="WT Pos" size={40} />
            <Sel width={86} title="Frame interpolation" value={osc.wt.interp} options={[
              { value: 'smooth', label: 'Smooth' }, { value: 'crossfade', label: 'Crossfade' }, { value: 'off', label: 'Stepped' },
            ]} onChange={v => ctx.update(p => { p.oscs[i].wt.interp = v as typeof osc.wt.interp })} />
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {([1, 2] as const).map(w => {
              const slot = w === 1 ? osc.wt.warp1 : osc.wt.warp2
              return (
                <div key={w} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 700 }}>WARP {w}</span>
                  <Sel width={96} value={slot.mode} options={WARP_MODES.map(m => ({ value: m.id, label: m.label }))}
                    onChange={v => ctx.update(p => { (w === 1 ? p.oscs[i].wt.warp1 : p.oscs[i].wt.warp2).mode = v as WarpMode })} />
                  <Knob path={`osc${i}.wt.warp${w}.amount`} label="Amount" size={34} />
                </div>
              )
            })}
            {(isFmWarp(osc.wt.warp1.mode) || isFmWarp(osc.wt.warp2.mode)) && (
              <Sel width={90} title="Modulator oscillator" value={String(osc.wt.fmSource)} options={[0, 1, 2].filter(s => s !== i).map(s => ({ value: String(s), label: `From Osc ${'ABC'[s]}` }))}
                onChange={v => ctx.update(p => { p.oscs[i].wt.fmSource = Number(v) as 0 | 1 | 2 })} />
            )}
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 700 }}>SPECTRAL</span>
              <Sel width={96} title="Spectral warp — reshapes the frame's harmonics" value={osc.wt.specWarp?.mode ?? 'off'} options={[
                { value: 'off', label: 'Off' }, { value: 'stretch', label: 'Stretch' }, { value: 'shift', label: 'Shift' },
                { value: 'smear', label: 'Smear' }, { value: 'lowpass', label: 'Spec LP' }, { value: 'evenodd', label: 'Even/Odd' },
                { value: 'inharm', label: 'Inharmonic' },
              ]} onChange={v => ctx.update(p => { p.oscs[i].wt.specWarp = { mode: v as SpecWarpMode, amount: p.oscs[i].wt.specWarp?.amount ?? 0 } })} />
              <Knob path={`osc${i}.wt.specWarp.amount`} label="Amount" size={34} />
            </div>
          </div>
          <SpectralBands oscIndex={i} />
          {(osc.wt.warp1.mode === 'remap' || osc.wt.warp2.mode === 'remap') && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 700 }}>REMAP</span>
              <CurveEditor
                curve={osc.wt.remapCurve}
                onCommit={c => {
                  ctx.update(p => { p.oscs[i].wt.remapCurve = c })
                  if (c) ctx.engine.sendOscRemapLut(`osc${i}`, c)
                }}
              />
            </div>
          )}
        </>
      )}
      {osc.engine === 'sample' && <SampleView />}
      {osc.engine === 'granular' && <GranularView />}
      {osc.engine === 'spectral' && <SpectralView />}
      {osc.engine === 'multisample' && <MultisamplePanel />}
    </Section>
  )
}
