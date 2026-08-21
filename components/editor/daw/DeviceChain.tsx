'use client'

import { useState, useRef, useEffect, createContext, useContext } from 'react'
import nextDynamic from 'next/dynamic'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useDaw } from '@/lib/daw-state'
import { useMidiLearn } from '@/lib/midi-learn'
import type {
  TrackEffect, Eq3Params, CompressorParams, ReverbParams,
  DelayParams, FilterParams, SaturatorParams, ReduxParams, AutoPanParams, UtilityParams, LfoParams, EffectType,
  NoiseGateParams, DeEsserParams, ChorusParams, TransientShaperParams, MultibandCompParams, LimiterParams, DynEqParams,
  MidiEffect, MidiEffectType, VelocityMidiParams, ScaleMidiParams, ChordMidiParams, ArpMidiParams,
} from '@/lib/daw-types'
import {
  defaultEq3, defaultCompressor, defaultReverb, defaultDelay, defaultFilter,
  defaultSaturator, defaultRedux, defaultAutoPan, defaultUtility, defaultLfo,
  defaultNoiseGate, defaultDeEsser, defaultChorus, defaultTransientShaper, defaultMultibandComp, defaultLimiter, defaultDynEq,
  voiceChainEffects,
} from '@/lib/daw-types'

// ── Label map ──────────────────────────────────────────────────────────────────


const EFFECT_LABELS: Record<EffectType, string> = {
  helios:         'Apollo FX',
  eq3:            'EQ3',
  compressor:     'Compressor',
  reverb:         'Reverb',
  delay:          'Delay',
  filter:         'Filter',
  saturator:      'Saturator',
  redux:          'Redux',
  autopan:        'Auto Pan',
  utility:        'Utility',
  lfo:            'LFO',
  noisegate:      'Noise Gate',
  deesser:        'De-esser',
  chorus:         'Chorus/Flanger',
  transientshaper:'Transient Shaper',
  multibandcomp:  'Multiband Comp',
  limiter:        'Limiter',
  dyneq:          'Dynamic EQ',
}

// ── Shared micro-components ────────────────────────────────────────────────────

// `learnKey` overrides the label used for the MIDI-learn binding id when the
// visible label isn't unique within an effect (e.g. per-band "Threshold" rows).
function CtrlRow({ label, learnKey, children }: { label: string; learnKey?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
      <span style={{
        color: 'var(--text-muted)', fontSize: 10, width: 52,
        flexShrink: 0, textAlign: 'right', lineHeight: 1,
      }}>
        {label}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <CtrlLabelCtx.Provider value={learnKey ?? label}>{children}</CtrlLabelCtx.Provider>
      </div>
    </div>
  )
}

// Effect id + control label flow down through context so every RangeCtrl gets a
// stable MIDI-learn id (`<effectId>:<label>`) with zero per-slider wiring.
const EffectLearnCtx = createContext<string>('')
const CtrlLabelCtx = createContext<string>('')

function RangeCtrl({ value, min, max, step = 0.01, onChange }: {
  value: number; min: number; max: number; step?: number
  onChange: (v: number) => void
}) {
  const eid = useContext(EffectLearnCtx)
  const label = useContext(CtrlLabelCtx)
  const learnId = eid && label ? `${eid}:${label}` : ''
  // A CC (0..1) maps across the control's own range.
  const midi = useMidiLearn(learnId, v01 => onChange(min + v01 * (max - min)))
  return (
    <div style={{ position: 'relative' }} onContextMenu={learnId ? e => { e.preventDefault(); midi.arm() } : undefined}
      title={!learnId ? undefined : midi.armed ? 'Move a knob/fader to bind it…' : midi.cc != null ? `Bound to CC ${midi.cc} — right-click to rebind` : 'Right-click to MIDI-learn a knob'}>
      <input
        type="range"
        min={min} max={max} step={step} value={value}
        style={{ width: '100%', accentColor: midi.armed ? '#f59e0b' : midi.cc != null ? '#22c55e' : 'var(--accent)', cursor: 'pointer', display: 'block' }}
        onChange={e => { e.stopPropagation(); onChange(parseFloat(e.target.value)) }}
        onKeyDown={e => e.stopPropagation()}
        onClick={e => e.stopPropagation()}
      />
      {(midi.armed || midi.cc != null) && (
        <button onClick={e => { e.stopPropagation(); midi.armed ? midi.arm() : midi.clear() }}
          title={midi.armed ? 'Cancel learning' : 'Unbind'}
          style={{ position: 'absolute', top: -1, right: 0, fontSize: 7, fontWeight: 700, lineHeight: 1, padding: '1px 3px', borderRadius: 2, cursor: 'pointer', border: 'none', background: midi.armed ? '#f59e0b' : 'rgba(34,197,94,0.9)', color: '#000' }}>
          {midi.armed ? 'LEARN' : `CC${midi.cc}`}
        </button>
      )}
    </div>
  )
}

function NumCtrl({ value, min, max, step = 1, onChange }: {
  value: number; min: number; max: number; step?: number
  onChange: (v: number) => void
}) {
  return (
    <input
      type="number"
      min={min} max={max} step={step} value={value}
      style={{
        width: '100%', background: 'var(--bg-surface)', border: '1px solid var(--border)',
        color: 'var(--text-primary)', fontSize: 10, padding: '1px 3px', borderRadius: 2,
        outline: 'none', boxSizing: 'border-box',
      }}
      onChange={e => { e.stopPropagation(); const v = parseFloat(e.target.value); if (!isNaN(v)) onChange(v) }}
      onKeyDown={e => e.stopPropagation()}
      onClick={e => e.stopPropagation()}
    />
  )
}

// ── EQ3 controls ───────────────────────────────────────────────────────────────

function Eq3Controls({ effect, trackId, returnId }: { effect: TrackEffect; trackId: string; returnId?: string }) {
  const { dispatch } = useDaw()
  const p = effect.params as Eq3Params
  const up = (changes: Partial<Eq3Params>) => returnId
    ? dispatch({ type: 'UPDATE_RETURN_EFFECT', returnId, effectId: effect.id, patch: { params: { ...p, ...changes } } })
    : dispatch({ type: 'UPDATE_EFFECT', trackId, effectId: effect.id, patch: { params: { ...p, ...changes } } })

  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const c = canvas.getContext('2d')
    if (!c) return
    const W = canvas.width
    const H = canvas.height

    c.fillStyle = '#0d1117'
    c.fillRect(0, 0, W, H)

    // 0 dB center line
    c.strokeStyle = '#2a2a3a'
    c.lineWidth = 1
    c.beginPath(); c.moveTo(0, H / 2); c.lineTo(W, H / 2); c.stroke()

    function computeDb(freq: number): number {
      const lowRatio = freq / p.lowFreq
      const lowContrib = p.lowGain / (1 + Math.pow(lowRatio, 4))
      const midRatio = freq / p.midFreq
      const midBell = 1 / (1 + Math.pow((midRatio - 1 / midRatio), 2))
      const midContrib = p.midGain * midBell
      const highRatio = p.highFreq / freq
      const highContrib = p.highGain / (1 + Math.pow(highRatio, 4))
      return lowContrib + midContrib + highContrib
    }

    // Fill below curve
    c.beginPath()
    for (let x = 0; x < W; x++) {
      const freq = 20 * Math.pow(1000, x / (W - 1))
      const db = computeDb(freq)
      const y = H / 2 - (db / 12) * (H / 2 - 2)
      if (x === 0) c.moveTo(x, y); else c.lineTo(x, y)
    }
    c.lineTo(W - 1, H / 2); c.lineTo(0, H / 2); c.closePath()
    c.fillStyle = 'rgba(61,143,239,0.13)'
    c.fill()

    // Curve line
    c.beginPath()
    for (let x = 0; x < W; x++) {
      const freq = 20 * Math.pow(1000, x / (W - 1))
      const db = computeDb(freq)
      const y = H / 2 - (db / 12) * (H / 2 - 2)
      if (x === 0) c.moveTo(x, y); else c.lineTo(x, y)
    }
    c.strokeStyle = '#3d8fef'
    c.lineWidth = 1.5
    c.stroke()
  }, [p.lowGain, p.midGain, p.highGain, p.lowFreq, p.midFreq, p.highFreq])

  return (
    <>
      <canvas ref={canvasRef} width={168} height={56} style={{ display: 'block', width: '100%', height: 56, borderRadius: 2, marginBottom: 6 }} />
      <CtrlRow label="Low">
        <RangeCtrl value={p.lowGain} min={-12} max={12} step={0.1} onChange={v => up({ lowGain: v })} />
      </CtrlRow>
      <CtrlRow label="Low Hz">
        <NumCtrl value={p.lowFreq} min={20} max={500} onChange={v => up({ lowFreq: v })} />
      </CtrlRow>
      <CtrlRow label="Mid">
        <RangeCtrl value={p.midGain} min={-12} max={12} step={0.1} onChange={v => up({ midGain: v })} />
      </CtrlRow>
      <CtrlRow label="Mid Hz">
        <NumCtrl value={p.midFreq} min={200} max={5000} onChange={v => up({ midFreq: v })} />
      </CtrlRow>
      <CtrlRow label="High">
        <RangeCtrl value={p.highGain} min={-12} max={12} step={0.1} onChange={v => up({ highGain: v })} />
      </CtrlRow>
      <CtrlRow label="High Hz">
        <NumCtrl value={p.highFreq} min={2000} max={20000} onChange={v => up({ highFreq: v })} />
      </CtrlRow>
    </>
  )
}

// ── Compressor controls ────────────────────────────────────────────────────────

function DynEqControls({ effect, trackId, returnId }: { effect: TrackEffect; trackId: string; returnId?: string }) {
  const { dispatch } = useDaw()
  const p = effect.params as DynEqParams
  const up = (changes: Partial<DynEqParams>) => returnId
    ? dispatch({ type: 'UPDATE_RETURN_EFFECT', returnId, effectId: effect.id, patch: { params: { ...p, ...changes } } })
    : dispatch({ type: 'UPDATE_EFFECT', trackId, effectId: effect.id, patch: { params: { ...p, ...changes } } })
  return (
    <>
      <CtrlRow label="Freq">
        <RangeCtrl value={p.freq} min={20} max={20000} step={1} onChange={v => up({ freq: v })} />
      </CtrlRow>
      <CtrlRow label="Q">
        <RangeCtrl value={p.q} min={0.3} max={12} step={0.1} onChange={v => up({ q: v })} />
      </CtrlRow>
      <CtrlRow label="Threshold">
        <RangeCtrl value={p.thresholdDb} min={-60} max={0} step={0.5} onChange={v => up({ thresholdDb: v })} />
      </CtrlRow>
      <CtrlRow label="Range">
        <RangeCtrl value={p.rangeDb} min={-18} max={18} step={0.5} onChange={v => up({ rangeDb: v })} />
      </CtrlRow>
      <CtrlRow label="Attack">
        <RangeCtrl value={p.attack} min={0.001} max={0.5} step={0.001} onChange={v => up({ attack: v })} />
      </CtrlRow>
      <CtrlRow label="Release">
        <RangeCtrl value={p.release} min={0.01} max={1} step={0.005} onChange={v => up({ release: v })} />
      </CtrlRow>
    </>
  )
}

function LimiterControls({ effect, trackId, returnId }: { effect: TrackEffect; trackId: string; returnId?: string }) {
  const { dispatch } = useDaw()
  const p = effect.params as LimiterParams
  const up = (changes: Partial<LimiterParams>) => returnId
    ? dispatch({ type: 'UPDATE_RETURN_EFFECT', returnId, effectId: effect.id, patch: { params: { ...p, ...changes } } })
    : dispatch({ type: 'UPDATE_EFFECT', trackId, effectId: effect.id, patch: { params: { ...p, ...changes } } })
  return (
    <>
      <CtrlRow label="Drive">
        <RangeCtrl value={p.gainDb} min={0} max={24} step={0.1} onChange={v => up({ gainDb: v })} />
      </CtrlRow>
      <CtrlRow label="Ceiling">
        <RangeCtrl value={p.ceilingDb} min={-12} max={0} step={0.1} onChange={v => up({ ceilingDb: v })} />
      </CtrlRow>
      <CtrlRow label="Release">
        <RangeCtrl value={p.release} min={0.005} max={1} step={0.005} onChange={v => up({ release: v })} />
      </CtrlRow>
    </>
  )
}

function CompressorControls({ effect, trackId, returnId }: { effect: TrackEffect; trackId: string; returnId?: string }) {
  const { dispatch, project } = useDaw()
  const p = effect.params as CompressorParams
  const up = (changes: Partial<CompressorParams>) => returnId
    ? dispatch({ type: 'UPDATE_RETURN_EFFECT', returnId, effectId: effect.id, patch: { params: { ...p, ...changes } } })
    : dispatch({ type: 'UPDATE_EFFECT', trackId, effectId: effect.id, patch: { params: { ...p, ...changes } } })

  return (
    <>
      <CtrlRow label="Threshold">
        <RangeCtrl value={p.threshold} min={-60} max={0} step={0.5} onChange={v => up({ threshold: v })} />
      </CtrlRow>
      <CtrlRow label="Ratio">
        <RangeCtrl value={p.ratio} min={1} max={20} step={0.1} onChange={v => up({ ratio: v })} />
      </CtrlRow>
      <CtrlRow label="Attack">
        <RangeCtrl value={p.attack} min={0} max={1} step={0.001} onChange={v => up({ attack: v })} />
      </CtrlRow>
      <CtrlRow label="Release">
        <RangeCtrl value={p.release} min={0} max={1} step={0.001} onChange={v => up({ release: v })} />
      </CtrlRow>
      <CtrlRow label="Makeup">
        <RangeCtrl value={p.makeupGain} min={0} max={24} step={0.1} onChange={v => up({ makeupGain: v })} />
      </CtrlRow>
      <CtrlRow label="Sidechain">
        <select
          value={p.sidechainTrackId ?? ''}
          style={{ width: '100%', background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 10, padding: '1px 2px', borderRadius: 2, outline: 'none', cursor: 'pointer', boxSizing: 'border-box' }}
          onChange={e => { e.stopPropagation(); up({ sidechainTrackId: e.target.value || null }) }}
          onKeyDown={e => e.stopPropagation()}
          onClick={e => e.stopPropagation()}
        >
          <option value="">Off</option>
          {project.tracks.filter(t => t.id !== trackId).map(t => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      </CtrlRow>
    </>
  )
}

// ── Reverb controls ────────────────────────────────────────────────────────────

function ReverbControls({ effect, trackId, returnId }: { effect: TrackEffect; trackId: string; returnId?: string }) {
  const { dispatch } = useDaw()
  const p = effect.params as ReverbParams
  const up = (changes: Partial<ReverbParams>) => returnId
    ? dispatch({ type: 'UPDATE_RETURN_EFFECT', returnId, effectId: effect.id, patch: { params: { ...p, ...changes } } })
    : dispatch({ type: 'UPDATE_EFFECT', trackId, effectId: effect.id, patch: { params: { ...p, ...changes } } })

  const padRef = useRef<HTMLDivElement>(null)
  const irFileRef = useRef<HTMLInputElement>(null)
  const PRE_MAX   = 0.1
  const DECAY_MIN = 0.1
  const DECAY_MAX = 10

  function applyPosition(clientX: number, clientY: number) {
    if (!padRef.current) return
    const rect = padRef.current.getBoundingClientRect()
    const rx = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    const ry = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height))
    const preDelay = rx * PRE_MAX
    const decay = Math.exp(Math.log(DECAY_MIN) + (1 - ry) * (Math.log(DECAY_MAX) - Math.log(DECAY_MIN)))
    up({ preDelay: Math.round(preDelay * 1000) / 1000, decay: Math.round(decay * 10) / 10 })
  }

  const dotX = (p.preDelay / PRE_MAX) * 100
  const dotY = (1 - (Math.log(Math.max(DECAY_MIN, p.decay)) - Math.log(DECAY_MIN)) / (Math.log(DECAY_MAX) - Math.log(DECAY_MIN))) * 100

  return (
    <>
      {/* XY Pad: X = pre-delay, Y = decay */}
      <div
        ref={padRef}
        style={{
          position: 'relative', width: '100%', height: 68,
          background: 'linear-gradient(to top right, #0d1520, #1a1030)',
          border: '1px solid var(--border)', borderRadius: 3,
          cursor: 'crosshair', marginBottom: 2, userSelect: 'none', overflow: 'hidden',
        }}
        onPointerDown={e => {
          e.stopPropagation()
          ;(e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId)
          applyPosition(e.clientX, e.clientY)
        }}
        onPointerMove={e => { if (e.buttons === 0) return; e.stopPropagation(); applyPosition(e.clientX, e.clientY) }}
      >
        <span style={{ position: 'absolute', bottom: 2, left: 4, fontSize: 8, color: 'rgba(255,255,255,0.28)', pointerEvents: 'none' }}>Pre-delay →</span>
        <span style={{ position: 'absolute', top: 4, right: 4, fontSize: 8, color: 'rgba(255,255,255,0.28)', pointerEvents: 'none' }}>Decay ↑</span>
        <div style={{
          position: 'absolute',
          left: `calc(${dotX}% - 5px)`, top: `calc(${dotY}% - 5px)`,
          width: 10, height: 10, borderRadius: '50%',
          background: 'var(--accent)', boxShadow: '0 0 6px var(--accent)',
          pointerEvents: 'none',
        }} />
      </div>
      {/* Numeric readouts for XY axes */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 8, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
          Pre: {Math.round(p.preDelay * 1000)}ms
        </span>
        <span style={{ fontSize: 8, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
          Decay: {p.decay.toFixed(1)}s
        </span>
      </div>
      <CtrlRow label="Wet">
        <RangeCtrl value={p.wet} min={0} max={1} step={0.01} onChange={v => up({ wet: v })} />
      </CtrlRow>
      <CtrlRow label="IR">
        <div style={{ display: 'flex', gap: 4, alignItems: 'center', width: '100%' }}>
          <input ref={irFileRef} type="file" accept="audio/*" style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (!f) return; const r = new FileReader(); r.onload = () => up({ irData: r.result as string, irName: f.name.replace(/\.[^.]+$/, '') }); r.readAsDataURL(f) }} />
          <button onClick={e => { e.stopPropagation(); irFileRef.current?.click() }} title="Load your own impulse response — a real hall, plate, room, or cabinet"
            style={{ flex: 1, minWidth: 0, fontSize: 9, padding: '2px 5px', borderRadius: 3, border: `1px solid ${p.irData ? 'var(--accent)' : 'var(--border)'}`, background: p.irData ? 'rgb(var(--accent-rgb) / 0.12)' : 'var(--bg-surface)', color: p.irData ? 'var(--accent)' : 'var(--text-secondary)', cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {p.irName || 'Load IR…'}
          </button>
          {p.irData && <button onClick={e => { e.stopPropagation(); up({ irData: undefined, irName: undefined }) }} title="Use the built-in reverb"
            style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1, padding: '2px 5px', borderRadius: 3, border: '1px solid var(--border)', background: 'var(--bg-surface)', color: 'var(--text-muted)', cursor: 'pointer' }}><X size={11} /></button>}
        </div>
      </CtrlRow>
    </>
  )
}

// ── Delay controls ─────────────────────────────────────────────────────────────

function DelayControls({ effect, trackId, returnId }: { effect: TrackEffect; trackId: string; returnId?: string }) {
  const { dispatch } = useDaw()
  const p = effect.params as DelayParams
  const up = (changes: Partial<DelayParams>) => returnId
    ? dispatch({ type: 'UPDATE_RETURN_EFFECT', returnId, effectId: effect.id, patch: { params: { ...p, ...changes } } })
    : dispatch({ type: 'UPDATE_EFFECT', trackId, effectId: effect.id, patch: { params: { ...p, ...changes } } })

  return (
    <>
      <CtrlRow label="Wet">
        <RangeCtrl value={p.wet} min={0} max={1} step={0.01} onChange={v => up({ wet: v })} />
      </CtrlRow>
      <CtrlRow label="Time">
        <RangeCtrl value={p.time} min={0} max={2} step={0.001} onChange={v => up({ time: v })} />
      </CtrlRow>
      <CtrlRow label="Feedback">
        <RangeCtrl value={p.feedback} min={0} max={0.95} step={0.01} onChange={v => up({ feedback: v })} />
      </CtrlRow>
      <CtrlRow label="Sync">
        <input
          type="checkbox"
          checked={p.syncToTempo}
          style={{ accentColor: 'var(--accent)', cursor: 'pointer' }}
          onChange={e => { e.stopPropagation(); up({ syncToTempo: e.target.checked }) }}
          onKeyDown={e => e.stopPropagation()}
          onClick={e => e.stopPropagation()}
        />
      </CtrlRow>
    </>
  )
}

// ── Filter controls ────────────────────────────────────────────────────────────

function FilterControls({ effect, trackId, returnId }: { effect: TrackEffect; trackId: string; returnId?: string }) {
  const { dispatch } = useDaw()
  const p = effect.params as FilterParams
  const up = (changes: Partial<FilterParams>) => returnId
    ? dispatch({ type: 'UPDATE_RETURN_EFFECT', returnId, effectId: effect.id, patch: { params: { ...p, ...changes } } })
    : dispatch({ type: 'UPDATE_EFFECT', trackId, effectId: effect.id, patch: { params: { ...p, ...changes } } })

  return (
    <>
      <CtrlRow label="Type">
        <select
          value={p.type}
          style={{
            width: '100%', background: 'var(--bg-surface)', border: '1px solid var(--border)',
            color: 'var(--text-primary)', fontSize: 10, padding: '1px 2px', borderRadius: 2,
            outline: 'none', cursor: 'pointer', boxSizing: 'border-box',
          }}
          onChange={e => { e.stopPropagation(); up({ type: e.target.value as FilterParams['type'] }) }}
          onKeyDown={e => e.stopPropagation()}
          onClick={e => e.stopPropagation()}
        >
          <option value="lowpass">Low Pass</option>
          <option value="highpass">High Pass</option>
          <option value="bandpass">Band Pass</option>
          <option value="notch">Notch</option>
        </select>
      </CtrlRow>
      <CtrlRow label="Freq">
        <RangeCtrl value={p.frequency} min={20} max={20000} step={1} onChange={v => up({ frequency: v })} />
      </CtrlRow>
      <CtrlRow label="Q">
        <RangeCtrl value={p.q} min={0.1} max={20} step={0.01} onChange={v => up({ q: v })} />
      </CtrlRow>
    </>
  )
}

// ── Saturator controls ─────────────────────────────────────────────────────────

function SaturatorControls({ effect, trackId, returnId }: { effect: TrackEffect; trackId: string; returnId?: string }) {
  const { dispatch } = useDaw()
  const p = effect.params as SaturatorParams
  const up = (changes: Partial<SaturatorParams>) => returnId
    ? dispatch({ type: 'UPDATE_RETURN_EFFECT', returnId, effectId: effect.id, patch: { params: { ...p, ...changes } } })
    : dispatch({ type: 'UPDATE_EFFECT', trackId, effectId: effect.id, patch: { params: { ...p, ...changes } } })
  return (
    <>
      <CtrlRow label="Drive"><RangeCtrl value={p.drive} min={0} max={1} step={0.01} onChange={v => up({ drive: v })} /></CtrlRow>
      <CtrlRow label="Color"><RangeCtrl value={p.color} min={0} max={1} step={0.01} onChange={v => up({ color: v })} /></CtrlRow>
      <CtrlRow label="Output"><RangeCtrl value={p.output} min={-12} max={6} step={0.1} onChange={v => up({ output: v })} /></CtrlRow>
    </>
  )
}

// ── Redux controls ─────────────────────────────────────────────────────────────

function ReduxControls({ effect, trackId, returnId }: { effect: TrackEffect; trackId: string; returnId?: string }) {
  const { dispatch } = useDaw()
  const p = effect.params as ReduxParams
  const up = (changes: Partial<ReduxParams>) => returnId
    ? dispatch({ type: 'UPDATE_RETURN_EFFECT', returnId, effectId: effect.id, patch: { params: { ...p, ...changes } } })
    : dispatch({ type: 'UPDATE_EFFECT', trackId, effectId: effect.id, patch: { params: { ...p, ...changes } } })
  return (
    <>
      <CtrlRow label="Bit Depth"><RangeCtrl value={p.bitDepth} min={1} max={16} step={1} onChange={v => up({ bitDepth: v })} /></CtrlRow>
      <CtrlRow label="Sample Rate"><RangeCtrl value={p.sampleRate} min={100} max={44100} step={100} onChange={v => up({ sampleRate: v })} /></CtrlRow>
    </>
  )
}

// ── Auto Pan controls ──────────────────────────────────────────────────────────

function AutoPanControls({ effect, trackId, returnId }: { effect: TrackEffect; trackId: string; returnId?: string }) {
  const { dispatch } = useDaw()
  const p = effect.params as AutoPanParams
  const up = (changes: Partial<AutoPanParams>) => returnId
    ? dispatch({ type: 'UPDATE_RETURN_EFFECT', returnId, effectId: effect.id, patch: { params: { ...p, ...changes } } })
    : dispatch({ type: 'UPDATE_EFFECT', trackId, effectId: effect.id, patch: { params: { ...p, ...changes } } })
  return (
    <>
      <CtrlRow label="Rate"><RangeCtrl value={p.rate} min={0.01} max={10} step={0.01} onChange={v => up({ rate: v })} /></CtrlRow>
      <CtrlRow label="Depth"><RangeCtrl value={p.depth} min={0} max={1} step={0.01} onChange={v => up({ depth: v })} /></CtrlRow>
      <CtrlRow label="Shape">
        <select value={p.waveform} style={{ width: '100%', background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 10, padding: '1px 2px', borderRadius: 2 }}
          onChange={e => { e.stopPropagation(); up({ waveform: e.target.value as AutoPanParams['waveform'] }) }}
          onKeyDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
          <option value="sine">Sine</option>
          <option value="triangle">Triangle</option>
          <option value="square">Square</option>
        </select>
      </CtrlRow>
    </>
  )
}

// ── Utility controls ───────────────────────────────────────────────────────────

function UtilityControls({ effect, trackId, returnId }: { effect: TrackEffect; trackId: string; returnId?: string }) {
  const { dispatch } = useDaw()
  const p = effect.params as UtilityParams
  const up = (changes: Partial<UtilityParams>) => returnId
    ? dispatch({ type: 'UPDATE_RETURN_EFFECT', returnId, effectId: effect.id, patch: { params: { ...p, ...changes } } })
    : dispatch({ type: 'UPDATE_EFFECT', trackId, effectId: effect.id, patch: { params: { ...p, ...changes } } })
  return (
    <>
      <CtrlRow label="Gain dB"><RangeCtrl value={p.gain} min={-12} max={12} step={0.1} onChange={v => up({ gain: v })} /></CtrlRow>
      <CtrlRow label="Width"><RangeCtrl value={p.width} min={0} max={2} step={0.01} onChange={v => up({ width: v })} /></CtrlRow>
      <CtrlRow label="">
        <div style={{ display: 'flex', gap: 4 }}>
          {(['mono', 'muteL', 'muteR'] as const).map(k => (
            <button key={k} onClick={() => up({ [k]: !p[k] })} style={{ fontSize: 9, padding: '2px 5px', borderRadius: 2, cursor: 'pointer', border: `1px solid ${p[k] ? 'var(--accent)' : 'var(--border)'}`, background: p[k] ? 'rgb(var(--accent-rgb) / 0.18)' : 'var(--bg-surface)', color: p[k] ? 'var(--accent)' : 'var(--text-muted)' }}>
              {k === 'mono' ? 'Mono' : k === 'muteL' ? 'M-L' : 'M-R'}
            </button>
          ))}
        </div>
      </CtrlRow>
    </>
  )
}

// ── LFO controls ───────────────────────────────────────────────────────────────

function LfoControls({ effect, trackId, returnId }: { effect: TrackEffect; trackId: string; returnId?: string }) {
  const { dispatch } = useDaw()
  const p = effect.params as LfoParams
  const up = (changes: Partial<LfoParams>) => returnId
    ? dispatch({ type: 'UPDATE_RETURN_EFFECT', returnId, effectId: effect.id, patch: { params: { ...p, ...changes } } })
    : dispatch({ type: 'UPDATE_EFFECT', trackId, effectId: effect.id, patch: { params: { ...p, ...changes } } })
  const selectStyle = { width: '100%', background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 10, padding: '1px 2px', borderRadius: 2 }
  return (
    <>
      <CtrlRow label="Rate"><RangeCtrl value={p.rate} min={0.01} max={20} step={0.01} onChange={v => up({ rate: v })} /></CtrlRow>
      <CtrlRow label="Depth"><RangeCtrl value={p.depth} min={0} max={1} step={0.01} onChange={v => up({ depth: v })} /></CtrlRow>
      <CtrlRow label="Target">
        <select value={p.target} style={selectStyle} onChange={e => { e.stopPropagation(); up({ target: e.target.value as LfoParams['target'] }) }} onKeyDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
          <option value="pan">Pan</option>
          <option value="volume">Volume</option>
          <option value="filter">Filter</option>
        </select>
      </CtrlRow>
      <CtrlRow label="Shape">
        <select value={p.waveform} style={selectStyle} onChange={e => { e.stopPropagation(); up({ waveform: e.target.value as LfoParams['waveform'] }) }} onKeyDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
          <option value="sine">Sine</option>
          <option value="triangle">Triangle</option>
          <option value="sawtooth">Sawtooth</option>
          <option value="square">Square</option>
        </select>
      </CtrlRow>
      {p.target === 'filter' && <>
        <CtrlRow label="F Min"><RangeCtrl value={p.filterFreqMin} min={20} max={20000} step={1} onChange={v => up({ filterFreqMin: v })} /></CtrlRow>
        <CtrlRow label="F Max"><RangeCtrl value={p.filterFreqMax} min={20} max={20000} step={1} onChange={v => up({ filterFreqMax: v })} /></CtrlRow>
      </>}
    </>
  )
}

// ── Noise Gate controls ───────────────────────────────────────────────────────

function NoiseGateControls({ effect, trackId, returnId }: { effect: TrackEffect; trackId: string; returnId?: string }) {
  const { dispatch } = useDaw()
  const p = effect.params as NoiseGateParams
  const up = (changes: Partial<NoiseGateParams>) => returnId
    ? dispatch({ type: 'UPDATE_RETURN_EFFECT', returnId, effectId: effect.id, patch: { params: { ...p, ...changes } } })
    : dispatch({ type: 'UPDATE_EFFECT', trackId, effectId: effect.id, patch: { params: { ...p, ...changes } } })
  return (
    <>
      <CtrlRow label="Threshold"><RangeCtrl value={p.threshold} min={-80} max={0} step={0.5} onChange={v => up({ threshold: v })} /></CtrlRow>
      <CtrlRow label="Attack"><RangeCtrl value={p.attack} min={0} max={0.5} step={0.001} onChange={v => up({ attack: v })} /></CtrlRow>
      <CtrlRow label="Hold"><RangeCtrl value={p.hold} min={0} max={0.5} step={0.001} onChange={v => up({ hold: v })} /></CtrlRow>
      <CtrlRow label="Release"><RangeCtrl value={p.release} min={0} max={2} step={0.01} onChange={v => up({ release: v })} /></CtrlRow>
      <CtrlRow label="Reduction"><RangeCtrl value={p.reduction} min={-80} max={-20} step={0.5} onChange={v => up({ reduction: v })} /></CtrlRow>
    </>
  )
}

// ── De-esser controls ─────────────────────────────────────────────────────────

function DeEsserControls({ effect, trackId, returnId }: { effect: TrackEffect; trackId: string; returnId?: string }) {
  const { dispatch } = useDaw()
  const p = effect.params as DeEsserParams
  const up = (changes: Partial<DeEsserParams>) => returnId
    ? dispatch({ type: 'UPDATE_RETURN_EFFECT', returnId, effectId: effect.id, patch: { params: { ...p, ...changes } } })
    : dispatch({ type: 'UPDATE_EFFECT', trackId, effectId: effect.id, patch: { params: { ...p, ...changes } } })
  return (
    <>
      <CtrlRow label="Freq Hz"><RangeCtrl value={p.frequency} min={4000} max={16000} step={100} onChange={v => up({ frequency: v })} /></CtrlRow>
      <CtrlRow label="Bandwidth"><RangeCtrl value={p.bandwidth} min={0.5} max={3} step={0.1} onChange={v => up({ bandwidth: v })} /></CtrlRow>
      <CtrlRow label="Threshold"><RangeCtrl value={p.threshold} min={-60} max={0} step={0.5} onChange={v => up({ threshold: v })} /></CtrlRow>
      <CtrlRow label="Reduction"><RangeCtrl value={p.reduction} min={0} max={24} step={0.5} onChange={v => up({ reduction: v })} /></CtrlRow>
    </>
  )
}

// ── Chorus/Flanger/Phaser controls ────────────────────────────────────────────

function ChorusControls({ effect, trackId, returnId }: { effect: TrackEffect; trackId: string; returnId?: string }) {
  const { dispatch } = useDaw()
  const p = effect.params as ChorusParams
  const up = (changes: Partial<ChorusParams>) => returnId
    ? dispatch({ type: 'UPDATE_RETURN_EFFECT', returnId, effectId: effect.id, patch: { params: { ...p, ...changes } } })
    : dispatch({ type: 'UPDATE_EFFECT', trackId, effectId: effect.id, patch: { params: { ...p, ...changes } } })
  return (
    <>
      <CtrlRow label="Mode">
        <div style={{ display: 'flex', gap: 3 }}>
          {(['chorus', 'flanger', 'phaser'] as const).map(t => (
            <button
              key={t}
              onClick={e => { e.stopPropagation(); up({ type: t }) }}
              style={{ fontSize: 8, padding: '2px 5px', borderRadius: 2, cursor: 'pointer', border: `1px solid ${p.type === t ? 'var(--accent)' : 'var(--border)'}`, background: p.type === t ? 'rgb(var(--accent-rgb) / 0.18)' : 'var(--bg-surface)', color: p.type === t ? 'var(--accent)' : 'var(--text-muted)' }}
            >
              {t === 'chorus' ? 'Chr' : t === 'flanger' ? 'Flg' : 'Phs'}
            </button>
          ))}
        </div>
      </CtrlRow>
      <CtrlRow label="Rate"><RangeCtrl value={p.rate} min={0.1} max={10} step={0.01} onChange={v => up({ rate: v })} /></CtrlRow>
      <CtrlRow label="Depth"><RangeCtrl value={p.depth} min={0} max={1} step={0.01} onChange={v => up({ depth: v })} /></CtrlRow>
      <CtrlRow label="Feedback"><RangeCtrl value={p.feedback} min={0} max={0.9} step={0.01} onChange={v => up({ feedback: v })} /></CtrlRow>
      <CtrlRow label="Mix"><RangeCtrl value={p.mix} min={0} max={1} step={0.01} onChange={v => up({ mix: v })} /></CtrlRow>
      {p.type === 'phaser' && (
        <CtrlRow label="Stages"><RangeCtrl value={p.stages} min={2} max={12} step={2} onChange={v => up({ stages: v })} /></CtrlRow>
      )}
    </>
  )
}

// ── Transient Shaper controls ─────────────────────────────────────────────────

function TransientShaperControls({ effect, trackId, returnId }: { effect: TrackEffect; trackId: string; returnId?: string }) {
  const { dispatch } = useDaw()
  const p = effect.params as TransientShaperParams
  const up = (changes: Partial<TransientShaperParams>) => returnId
    ? dispatch({ type: 'UPDATE_RETURN_EFFECT', returnId, effectId: effect.id, patch: { params: { ...p, ...changes } } })
    : dispatch({ type: 'UPDATE_EFFECT', trackId, effectId: effect.id, patch: { params: { ...p, ...changes } } })
  const valStyle = { minWidth: 30, textAlign: 'right' as const, fontSize: 9, color: 'var(--text-muted)', flexShrink: 0 }
  return (
    <>
      <CtrlRow label="Attack">
        <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          <RangeCtrl value={p.attack} min={-12} max={12} step={0.1} onChange={v => up({ attack: v })} />
          <span style={valStyle}>{p.attack >= 0 ? '+' : ''}{p.attack.toFixed(1)}</span>
        </div>
      </CtrlRow>
      <CtrlRow label="Sustain">
        <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          <RangeCtrl value={p.sustain} min={-12} max={12} step={0.1} onChange={v => up({ sustain: v })} />
          <span style={valStyle}>{p.sustain >= 0 ? '+' : ''}{p.sustain.toFixed(1)}</span>
        </div>
      </CtrlRow>
      <CtrlRow label="Out dB">
        <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          <RangeCtrl value={p.gain} min={-6} max={6} step={0.1} onChange={v => up({ gain: v })} />
          <span style={valStyle}>{p.gain >= 0 ? '+' : ''}{p.gain.toFixed(1)}</span>
        </div>
      </CtrlRow>
    </>
  )
}

// ── Multiband Comp controls ───────────────────────────────────────────────────

function MultibandCompControls({ effect, trackId, returnId }: { effect: TrackEffect; trackId: string; returnId?: string }) {
  const { dispatch } = useDaw()
  const p = effect.params as MultibandCompParams
  const up = (changes: Partial<MultibandCompParams>) => returnId
    ? dispatch({ type: 'UPDATE_RETURN_EFFECT', returnId, effectId: effect.id, patch: { params: { ...p, ...changes } } })
    : dispatch({ type: 'UPDATE_EFFECT', trackId, effectId: effect.id, patch: { params: { ...p, ...changes } } })
  const bandLabel = (color: string, text: string) => (
    <div style={{ fontSize: 8, fontWeight: 700, color, letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 2, marginTop: 4 }}>{text}</div>
  )
  return (
    <>
      {bandLabel('#818cf8', 'Crossovers')}
      <CtrlRow label="Low↔Mid"><RangeCtrl value={p.lowMid} min={50} max={2000} step={1} onChange={v => up({ lowMid: v })} /></CtrlRow>
      <CtrlRow label="Mid↔High"><RangeCtrl value={p.midHigh} min={1000} max={16000} step={1} onChange={v => up({ midHigh: v })} /></CtrlRow>
      {bandLabel('#60a5fa', 'Low')}
      <CtrlRow label="Threshold" learnKey="Low Threshold"><RangeCtrl value={p.lowThreshold} min={-60} max={0} step={0.5} onChange={v => up({ lowThreshold: v })} /></CtrlRow>
      <CtrlRow label="Ratio" learnKey="Low Ratio"><RangeCtrl value={p.lowRatio} min={1} max={20} step={0.1} onChange={v => up({ lowRatio: v })} /></CtrlRow>
      <CtrlRow label="Gain dB" learnKey="Low Gain"><RangeCtrl value={p.lowGain} min={-12} max={12} step={0.1} onChange={v => up({ lowGain: v })} /></CtrlRow>
      {bandLabel('#4ade80', 'Mid')}
      <CtrlRow label="Threshold" learnKey="Mid Threshold"><RangeCtrl value={p.midThreshold} min={-60} max={0} step={0.5} onChange={v => up({ midThreshold: v })} /></CtrlRow>
      <CtrlRow label="Ratio" learnKey="Mid Ratio"><RangeCtrl value={p.midRatio} min={1} max={20} step={0.1} onChange={v => up({ midRatio: v })} /></CtrlRow>
      <CtrlRow label="Gain dB" learnKey="Mid Gain"><RangeCtrl value={p.midGain} min={-12} max={12} step={0.1} onChange={v => up({ midGain: v })} /></CtrlRow>
      {bandLabel('#f87171', 'High')}
      <CtrlRow label="Threshold" learnKey="High Threshold"><RangeCtrl value={p.highThreshold} min={-60} max={0} step={0.5} onChange={v => up({ highThreshold: v })} /></CtrlRow>
      <CtrlRow label="Ratio" learnKey="High Ratio"><RangeCtrl value={p.highRatio} min={1} max={20} step={0.1} onChange={v => up({ highRatio: v })} /></CtrlRow>
      <CtrlRow label="Gain dB" learnKey="High Gain"><RangeCtrl value={p.highGain} min={-12} max={12} step={0.1} onChange={v => up({ highGain: v })} /></CtrlRow>
    </>
  )
}

// ── Device card ────────────────────────────────────────────────────────────────

function EffectDevice({ effect, trackId, returnId }: { effect: TrackEffect; trackId: string; returnId?: string }) {
  const { dispatch } = useDaw()
  const enabled = effect.params.enabled
  const [autoGain, setAutoGain] = useState(false)

  function toggleBypass() {
    returnId
      ? dispatch({ type: 'UPDATE_RETURN_EFFECT', returnId, effectId: effect.id, patch: { params: { ...effect.params, enabled: !enabled } as typeof effect.params } })
      : dispatch({ type: 'UPDATE_EFFECT', trackId, effectId: effect.id, patch: { params: { ...effect.params, enabled: !enabled } as typeof effect.params } })
  }

  function remove() {
    returnId
      ? dispatch({ type: 'REMOVE_RETURN_EFFECT', returnId, effectId: effect.id })
      : dispatch({ type: 'REMOVE_EFFECT', trackId, effectId: effect.id })
  }

  return (
    <div style={{
      width: 180,
      minHeight: 160,
      background: 'var(--bg-card)',
      borderRight: '1px solid var(--border)',   // shared seam, Apollo-plate style
      display: 'flex',
      flexDirection: 'column',
      flexShrink: 0,
      opacity: enabled ? 1 : 0.55,
      transition: 'opacity 0.1s',
    }}>
      {/* Header — Apollo Section-bar look */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '5px 8px 4px',
        background: 'var(--bg-surface)',
        borderBottom: '1px solid var(--border)',
        minHeight: 26,
      }}>
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <span style={{
            color: 'var(--text-primary)', fontSize: 10, fontWeight: 800,
            letterSpacing: 1.2, textTransform: 'uppercase', fontStretch: 'condensed', display: 'block',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {EFFECT_LABELS[effect.type]}
          </span>
          {effect.type === 'eq3' && (
            <span style={{ fontSize: 8, color: 'var(--text-muted)', display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              Precision EQ — insert on device chain
            </span>
          )}
        </div>
        {/* Bypass LED */}
        <button
          title={enabled ? 'Bypass' : 'Enable'}
          onClick={e => { e.stopPropagation(); toggleBypass() }}
          style={{
            width: 10, height: 10, borderRadius: '50%', border: 'none',
            background: enabled ? 'var(--accent)' : '#3a3a3a',
            boxShadow: enabled ? '0 0 5px var(--accent)' : 'none',
            cursor: 'pointer', flexShrink: 0, padding: 0,
            transition: 'background 0.1s, box-shadow 0.1s',
          }}
        />
        {/* Remove */}
        <button
          title="Remove device"
          onClick={e => { e.stopPropagation(); remove() }}
          style={{
            width: 14, height: 14, border: 'none', borderRadius: 2,
            background: 'transparent', color: 'var(--text-muted)',
            cursor: 'pointer', fontSize: 14, lineHeight: 1,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0, padding: 0,
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-primary)' }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-muted)' }}
        >
          <X size={13} />
        </button>
      </div>
      {/* Controls */}
      <EffectLearnCtx.Provider value={effect.id}>
      <div style={{ padding: '8px 6px', flex: 1 }}>
        {(effect.type === 'filter' || effect.type === 'eq3') && <div style={{ padding: '6px 8px 0' }}><ResponseCurve effect={effect} /></div>}
        {['compressor', 'noisegate', 'deesser', 'dyneq', 'multibandcomp', 'limiter'].includes(effect.type) && !returnId && (
          <GrStrip trackId={trackId} effectId={effect.id} />
        )}
        {effect.type === 'helios'         && <HeliosDeviceBody       effect={effect} />}
        {effect.type === 'eq3'            && <Eq3Controls             effect={effect} trackId={trackId} returnId={returnId} />}
        {effect.type === 'compressor'     && <CompressorControls      effect={effect} trackId={trackId} returnId={returnId} />}
        {effect.type === 'limiter'        && <LimiterControls         effect={effect} trackId={trackId} returnId={returnId} />}
        {effect.type === 'dyneq'          && <DynEqControls           effect={effect} trackId={trackId} returnId={returnId} />}
        {effect.type === 'reverb'         && <ReverbControls          effect={effect} trackId={trackId} returnId={returnId} />}
        {effect.type === 'delay'          && <DelayControls           effect={effect} trackId={trackId} returnId={returnId} />}
        {effect.type === 'filter'         && <FilterControls          effect={effect} trackId={trackId} returnId={returnId} />}
        {effect.type === 'saturator'      && <SaturatorControls       effect={effect} trackId={trackId} returnId={returnId} />}
        {effect.type === 'redux'          && <ReduxControls           effect={effect} trackId={trackId} returnId={returnId} />}
        {effect.type === 'autopan'        && <AutoPanControls         effect={effect} trackId={trackId} returnId={returnId} />}
        {effect.type === 'utility'        && <UtilityControls         effect={effect} trackId={trackId} returnId={returnId} />}
        {effect.type === 'lfo'            && <LfoControls             effect={effect} trackId={trackId} returnId={returnId} />}
        {effect.type === 'noisegate'      && <NoiseGateControls       effect={effect} trackId={trackId} returnId={returnId} />}
        {effect.type === 'deesser'        && <DeEsserControls         effect={effect} trackId={trackId} returnId={returnId} />}
        {effect.type === 'chorus'         && <ChorusControls          effect={effect} trackId={trackId} returnId={returnId} />}
        {effect.type === 'transientshaper' && <TransientShaperControls effect={effect} trackId={trackId} returnId={returnId} />}
        {effect.type === 'multibandcomp'  && <MultibandCompControls   effect={effect} trackId={trackId} returnId={returnId} />}
        {/* Honest bypass */}
        <div style={{ borderTop: '1px solid var(--border)', marginTop: 6, paddingTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
          <input
            type="checkbox"
            id={`ag-${effect.id}`}
            checked={autoGain}
            onChange={e => { e.stopPropagation(); setAutoGain(e.target.checked) }}
            onClick={e => e.stopPropagation()}
            style={{ accentColor: 'var(--accent)', cursor: 'pointer', margin: 0 }}
            title="Matches output level to input when bypassed, for fair A/B comparison"
          />
          <label
            htmlFor={`ag-${effect.id}`}
            style={{ fontSize: 9, color: 'var(--text-muted)', cursor: 'pointer', userSelect: 'none' }}
            title="Matches output level to input when bypassed, for fair A/B comparison"
          >
            Honest bypass
          </label>
        </div>
      </div>
      </EffectLearnCtx.Provider>
    </div>
  )
}

// ── Add device button + dropdown ───────────────────────────────────────────────

const ADD_OPTIONS: { type: EffectType; label: string }[] = [
  { type: 'eq3',            label: 'EQ3' },
  { type: 'compressor',     label: 'Compressor' },
  { type: 'reverb',         label: 'Reverb' },
  { type: 'delay',          label: 'Delay' },
  { type: 'filter',         label: 'Filter' },
  { type: 'saturator',      label: 'Saturator' },
  { type: 'redux',          label: 'Redux (Bit Crush)' },
  { type: 'autopan',        label: 'Auto Pan' },
  { type: 'utility',        label: 'Utility' },
  { type: 'lfo',            label: 'LFO' },
  { type: 'noisegate',      label: 'Noise Gate' },
  { type: 'deesser',        label: 'De-esser' },
  { type: 'chorus',         label: 'Chorus/Flanger' },
  { type: 'transientshaper',label: 'Transient Shaper' },
  { type: 'multibandcomp',  label: 'Multiband Comp' },
  { type: 'limiter',        label: 'Limiter' },
  { type: 'dyneq',          label: 'Dynamic EQ' },
]

function makeDefaultParams(type: EffectType) {
  switch (type) {
    case 'eq3':            return defaultEq3()
    case 'compressor':     return defaultCompressor()
    case 'reverb':         return defaultReverb()
    case 'delay':          return defaultDelay()
    case 'filter':         return defaultFilter()
    case 'saturator':      return defaultSaturator()
    case 'redux':          return defaultRedux()
    case 'autopan':        return defaultAutoPan()
    case 'utility':        return defaultUtility()
    case 'lfo':            return defaultLfo()
    case 'noisegate':      return defaultNoiseGate()
    case 'deesser':        return defaultDeEsser()
    case 'chorus':         return defaultChorus()
    case 'transientshaper':return defaultTransientShaper()
    case 'multibandcomp':  return defaultMultibandComp()
    case 'limiter':        return defaultLimiter()
    case 'dyneq':          return defaultDynEq()
    default:               return defaultEq3()
  }
}

function VoiceChainButton({ trackId }: { trackId: string }) {
  const { dispatch, project } = useDaw()
  const track = project.tracks.find(t => t.id === trackId)
  if (!track || track.type !== 'audio') return null

  function apply() {
    if (track!.effects.length > 0) {
      if (!window.confirm('Replace existing effects with Voice Chain?')) return
    }
    dispatch({ type: 'UPDATE_TRACK', trackId, patch: { effects: voiceChainEffects() } })
  }

  return (
    <button
      onClick={e => { e.stopPropagation(); apply() }}
      title="Apply voice preset for podcast/voice recording"
      style={{
        alignSelf: 'flex-start', flexShrink: 0,
        background: 'rgba(249,115,22,0.10)',
        border: '1px solid rgba(249,115,22,0.35)',
        color: '#f97316', fontSize: 11, cursor: 'pointer',
        borderRadius: 4, padding: '6px 10px', whiteSpace: 'nowrap',
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(249,115,22,0.22)' }}
      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(249,115,22,0.10)' }}
    >
      Voice Chain
    </button>
  )
}

function AddDeviceButton({ trackId, returnId }: { trackId: string; returnId?: string }) {
  const { dispatch } = useDaw()
  const [open, setOpen] = useState(false)
  const [dropPos, setDropPos] = useState({ top: 0, left: 0 })
  const btnRef  = useRef<HTMLButtonElement>(null)
  const dropRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onMouseDown(e: MouseEvent) {
      if (dropRef.current?.contains(e.target as Node)) return
      if (btnRef.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  function handleOpen(e: React.MouseEvent) {
    e.stopPropagation()
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      setDropPos({ top: r.top, left: r.left })
    }
    setOpen(o => !o)
  }

  function add(type: EffectType) {
    const effect: TrackEffect = {
      id: crypto.randomUUID(),
      type,
      params: makeDefaultParams(type),
    }
    returnId
      ? dispatch({ type: 'ADD_RETURN_EFFECT', returnId, effect })
      : dispatch({ type: 'ADD_EFFECT', trackId, effect })
    setOpen(false)
  }

  return (
    <>
      <button
        ref={btnRef}
        onClick={handleOpen}
        title="Add device"
        data-help-id="add-device"
        style={{
          alignSelf: 'flex-start', flexShrink: 0,
          background: 'var(--bg-card)', border: '1px dashed var(--border)',
          color: 'var(--text-muted)', fontSize: 11, cursor: 'pointer',
          borderRadius: 4, padding: '6px 10px', whiteSpace: 'nowrap',
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-primary)' }}
        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-muted)' }}
      >
        + Add Device
      </button>
      {open && createPortal(
        <div ref={dropRef} style={{
          position: 'fixed',
          bottom: `calc(100vh - ${dropPos.top}px + 4px)`,
          left: dropPos.left,
          zIndex: 1000,
          background: 'var(--bg-surface)', border: '1px solid var(--border)',
          borderRadius: 4, overflow: 'hidden', minWidth: 130,
          boxShadow: '0 -4px 16px rgba(0,0,0,0.55)',
        }}>
          {ADD_OPTIONS.map(opt => (
            <button
              key={opt.type}
              onClick={e => { e.stopPropagation(); add(opt.type) }}
              style={{
                display: 'block', width: '100%', textAlign: 'left',
                padding: '7px 12px', background: 'transparent',
                border: 'none', color: 'var(--text-primary)', fontSize: 12,
                cursor: 'pointer',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgb(var(--accent-rgb) / 0.18)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent' }}
            >
              {opt.label}
            </button>
          ))}
        </div>,
        document.body
      )}
    </>
  )
}

// ── MIDI effect cards ──────────────────────────────────────────────────────────

const MIDI_EFFECT_LABELS: Record<MidiEffectType, string> = {
  velocity: 'Velocity',
  scale:    'Scale',
  chord:    'Chord',
  arp:      'Arpeggiator',
}

const MIDI_ADD_OPTIONS: { type: MidiEffectType; label: string }[] = [
  { type: 'velocity', label: 'Velocity' },
  { type: 'scale',    label: 'Scale' },
  { type: 'chord',    label: 'Chord' },
  { type: 'arp',      label: 'Arpeggiator' },
]

function makeMidiDefault(type: MidiEffectType): MidiEffect['params'] {
  switch (type) {
    case 'velocity': return { enabled: true, outMin: 0, outMax: 127, random: 0 }
    case 'scale':    return { enabled: true, root: 0, scale: 'major' }
    case 'chord':    return { enabled: true, intervals: [4, 7] }
    case 'arp':      return { enabled: true, style: 'up', rate: 0.25, octaves: 1, gate: 0.9 }
  }
}

function MidiEffectCard({ effect, trackId }: { effect: MidiEffect; trackId: string }) {
  const { dispatch } = useDaw()
  const p = effect.params
  const up = (changes: Partial<typeof p>) =>
    dispatch({ type: 'UPDATE_MIDI_EFFECT', trackId, effectId: effect.id, patch: { params: { ...p, ...changes } as typeof p } })
  const selStyle: React.CSSProperties = { width: '100%', background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 10, padding: '1px 2px', borderRadius: 2 }

  return (
    <div style={{ width: 160, minHeight: 120, background: 'rgb(var(--accent-rgb) / 0.08)', border: '1px solid rgb(var(--accent-rgb) / 0.3)', borderRadius: 4, display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 6px', borderBottom: '1px solid rgb(var(--accent-rgb) / 0.2)', background: 'rgb(var(--accent-rgb) / 0.12)' }}>
        <button
          onClick={() => up({ enabled: !p.enabled })}
          style={{ width: 12, height: 12, borderRadius: 2, border: 'none', background: p.enabled ? 'var(--accent-light)' : '#333', cursor: 'pointer', padding: 0, flexShrink: 0 }}
        />
        <span style={{ flex: 1, fontSize: 10, fontWeight: 700, color: 'var(--accent-light)', letterSpacing: '0.04em' }}>{MIDI_EFFECT_LABELS[effect.type]}</span>
        <button onClick={() => dispatch({ type: 'REMOVE_MIDI_EFFECT', trackId, effectId: effect.id })}
          style={{ width: 14, height: 14, border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}><X size={13} /></button>
      </div>
      <div style={{ padding: '8px 6px', flex: 1 }}>
        {effect.type === 'velocity' && (() => {
          const vp = p as VelocityMidiParams
          return <>
            <CtrlRow label="Min"><RangeCtrl value={vp.outMin} min={0} max={127} step={1} onChange={v => up({ outMin: v })} /></CtrlRow>
            <CtrlRow label="Max"><RangeCtrl value={vp.outMax} min={0} max={127} step={1} onChange={v => up({ outMax: v })} /></CtrlRow>
            <CtrlRow label="Rand"><RangeCtrl value={vp.random} min={0} max={1} step={0.01} onChange={v => up({ random: v })} /></CtrlRow>
          </>
        })()}
        {effect.type === 'scale' && (() => {
          const sp = p as ScaleMidiParams
          return <>
            <CtrlRow label="Root">
              <select value={sp.root} style={selStyle} onChange={e => { e.stopPropagation(); up({ root: parseInt(e.target.value) }) }} onClick={e => e.stopPropagation()}>
                {['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'].map((n,i) => <option key={i} value={i}>{n}</option>)}
              </select>
            </CtrlRow>
            <CtrlRow label="Scale">
              <select value={sp.scale} style={selStyle} onChange={e => { e.stopPropagation(); up({ scale: e.target.value as ScaleMidiParams['scale'] }) }} onClick={e => e.stopPropagation()}>
                {['major','minor','penta-maj','penta-min','dorian','chromatic'].map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </CtrlRow>
          </>
        })()}
        {effect.type === 'chord' && (() => {
          const cp = p as ChordMidiParams
          return <>
            <CtrlRow label="Intervals">
              <input
                type="text"
                defaultValue={cp.intervals.join(', ')}
                onBlur={e => {
                  const parsed = e.target.value.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n))
                  if (parsed.length > 0) up({ intervals: parsed })
                }}
                onKeyDown={e => e.stopPropagation()}
                onClick={e => e.stopPropagation()}
                style={{ width: '100%', background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 10, padding: '1px 3px', borderRadius: 2 }}
                title="Semitone intervals (e.g. 4, 7 for major chord)"
              />
            </CtrlRow>
          </>
        })()}
        {effect.type === 'arp' && (() => {
          const ap = p as ArpMidiParams
          return <>
            <CtrlRow label="Style">
              <select value={ap.style} style={selStyle} onChange={e => { e.stopPropagation(); up({ style: e.target.value as ArpMidiParams['style'] }) }} onClick={e => e.stopPropagation()}>
                <option value="up">Up</option>
                <option value="down">Down</option>
                <option value="updown">Up-Down</option>
                <option value="random">Random</option>
              </select>
            </CtrlRow>
            <CtrlRow label="Rate"><RangeCtrl value={ap.rate} min={0.0625} max={1} step={0.0625} onChange={v => up({ rate: v })} /></CtrlRow>
            <CtrlRow label="Oct"><RangeCtrl value={ap.octaves} min={1} max={3} step={1} onChange={v => up({ octaves: v })} /></CtrlRow>
            <CtrlRow label="Gate"><RangeCtrl value={ap.gate} min={0.05} max={1} step={0.01} onChange={v => up({ gate: v })} /></CtrlRow>
          </>
        })()}
      </div>
    </div>
  )
}

function AddMidiEffectButton({ trackId }: { trackId: string }) {
  const { dispatch } = useDaw()
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const dropRef = useRef<HTMLDivElement>(null)
  const [dropPos, setDropPos] = useState({ top: 0, left: 0 })

  useEffect(() => {
    if (!open) return
    function onMouseDown(e: MouseEvent) {
      if (dropRef.current?.contains(e.target as Node)) return
      if (btnRef.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => {
          if (btnRef.current) {
            const r = btnRef.current.getBoundingClientRect()
            setDropPos({ top: r.top, left: r.left })
          }
          setOpen(v => !v)
        }}
        style={{ width: 28, height: 28, borderRadius: 4, border: '1px dashed rgb(var(--accent-rgb) / 0.4)', background: 'transparent', color: 'rgb(var(--accent-rgb) / 0.6)', cursor: 'pointer', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
        title="Add MIDI effect"
      >+</button>
      {open && typeof document !== 'undefined' && createPortal(
        <div ref={dropRef} style={{ position: 'fixed', bottom: `calc(100vh - ${dropPos.top}px + 4px)`, left: dropPos.left, zIndex: 9999, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 4, padding: 4, boxShadow: '0 -4px 20px rgba(0,0,0,0.6)', minWidth: 140 }}>
          {MIDI_ADD_OPTIONS.map(opt => (
            <button
              key={opt.type}
              onClick={() => {
                dispatch({ type: 'ADD_MIDI_EFFECT', trackId, effect: { id: `mfx-${Date.now()}`, type: opt.type, params: makeMidiDefault(opt.type) } })
                setOpen(false)
              }}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '5px 10px', background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 11, borderRadius: 2 }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-surface)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-primary)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-secondary)' }}
            >{opt.label}</button>
          ))}
        </div>,
        document.body
      )}
    </>
  )
}

// ── Main export ────────────────────────────────────────────────────────────────

// Live gain-reduction strip for dynamics devices on the Helios path
function GrStrip({ trackId, effectId }: { trackId: string; effectId: string }) {
  const { engine } = useDaw()
  const [gr, setGr] = useState<number | null>(null)
  useEffect(() => {
    let raf = 0
    const tick = () => {
      const m = (engine as unknown as { getHeliosFxMeters?: (id: string) => Record<string, number[]> })?.getHeliosFxMeters?.(trackId)
      const vals = m?.[effectId] ?? m?.[`${effectId}_lim`]
      setGr(vals && vals.length ? Math.min(...vals) : null)
      raf = window.setTimeout(tick, 120)
    }
    tick()
    return () => window.clearTimeout(raf)
  }, [engine, trackId, effectId])
  if (gr == null) return null
  const pct = Math.min(100, Math.max(0, (-gr / 24) * 100))
  return (
    <div title={`Gain reduction: ${gr.toFixed(1)} dB`} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '0 8px 6px' }}>
      <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: 0.6, color: 'var(--text-muted)' }}>GR</span>
      <div style={{ flex: 1, height: 5, borderRadius: 3, background: 'rgba(0,0,0,0.35)', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: pct > 60 ? '#e0a555' : 'var(--accent)', transition: 'width 100ms linear' }} />
      </div>
      <span style={{ fontSize: 8.5, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums', minWidth: 34, textAlign: 'right' }}>{gr.toFixed(1)}dB</span>
    </div>
  )
}

// Frequency-response curve for filter/EQ devices (biquad math, standalone)
function ResponseCurve({ effect }: { effect: TrackEffect }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const g = cv.getContext('2d')
    if (!g) return
    const W = cv.width = 164 * 2, H = cv.height = 44 * 2
    g.clearRect(0, 0, W, H)
    const sr = 44100
    // gather biquad stages from the device's settings
    const stages: { type: string; f: number; q: number; gain: number }[] = []
    if (effect.type === 'filter') {
      const p = effect.params as FilterParams
      stages.push({ type: p.type, f: p.frequency, q: p.q, gain: 0 })
    } else if (effect.type === 'eq3') {
      const p = effect.params as Eq3Params
      stages.push({ type: 'lowshelf', f: p.lowFreq, q: 0.9, gain: p.lowGain })
      stages.push({ type: 'peaking', f: p.midFreq, q: 1, gain: p.midGain })
      stages.push({ type: 'highshelf', f: p.highFreq, q: 0.9, gain: p.highGain })
    }
    const mag = (freq: number) => {
      let db = 0
      for (const st2 of stages) {
        const w0 = 2 * Math.PI * st2.f / sr, cw = Math.cos(w0), sw = Math.sin(w0)
        const A = Math.pow(10, st2.gain / 40), alpha = sw / (2 * st2.q)
        let b0 = 1, b1 = 0, b2 = 0, a0 = 1, a1 = 0, a2 = 0
        if (st2.type === 'lowpass') { b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha }
        else if (st2.type === 'highpass') { b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha }
        else if (st2.type === 'bandpass') { b0 = alpha; b1 = 0; b2 = -alpha; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha }
        else if (st2.type === 'notch') { b0 = 1; b1 = -2 * cw; b2 = 1; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha }
        else if (st2.type === 'peaking') { b0 = 1 + alpha * A; b1 = -2 * cw; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * cw; a2 = 1 - alpha / A }
        else if (st2.type === 'lowshelf' || st2.type === 'highshelf') {
          const s2 = st2.type === 'lowshelf' ? 1 : -1
          const beta = 2 * Math.sqrt(A) * alpha
          b0 = A * ((A + 1) - s2 * (A - 1) * cw + beta); b1 = s2 * 2 * A * ((A - 1) - s2 * (A + 1) * cw); b2 = A * ((A + 1) - s2 * (A - 1) * cw - beta)
          a0 = (A + 1) + s2 * (A - 1) * cw + beta; a1 = s2 * -2 * ((A - 1) + s2 * (A + 1) * cw); a2 = (A + 1) + s2 * (A - 1) * cw - beta
        }
        const w = 2 * Math.PI * freq / sr
        const cos1 = Math.cos(w), cos2 = Math.cos(2 * w), sin1 = Math.sin(w), sin2 = Math.sin(2 * w)
        const nr = b0 + b1 * cos1 + b2 * cos2, ni = -(b1 * sin1 + b2 * sin2)
        const dr = a0 + a1 * cos1 + a2 * cos2, di = -(a1 * sin1 + a2 * sin2)
        const num = Math.sqrt(nr * nr + ni * ni), den = Math.sqrt(dr * dr + di * di)
        db += 20 * Math.log10(Math.max(1e-6, num / Math.max(1e-9, den)))
      }
      return db
    }
    g.strokeStyle = getComputedStyle(cv).getPropertyValue('--accent').trim() || '#4aa9ff'
    g.lineWidth = 2.5
    g.beginPath()
    for (let x = 0; x < W; x++) {
      const f = 20 * Math.pow(1000, x / W)
      const db = Math.max(-24, Math.min(24, mag(f)))
      const y = H / 2 - (db / 24) * (H / 2 - 4)
      if (x === 0) g.moveTo(x, y); else g.lineTo(x, y)
    }
    g.stroke()
    g.strokeStyle = 'rgba(128,140,160,0.25)'
    g.lineWidth = 1
    g.beginPath(); g.moveTo(0, H / 2); g.lineTo(W, H / 2); g.stroke()
  }, [effect])
  return <canvas ref={ref} style={{ width: '100%', height: 44, display: 'block', background: 'rgba(0,0,0,0.25)', borderRadius: 6, margin: '0 0 2px' }} />
}

// Apollo-native device: compact face — the real editing surface is the
// Apollo Rack card (open it from the chain header).
function HeliosDeviceBody({ effect }: { effect: TrackEffect }) {
  const p = effect.params as import('@/lib/daw-types').HeliosFxParams
  const u = p.unit
  return (
    <div style={{ padding: '10px 10px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontSize: 16, textAlign: 'center' }}>☀︎</div>
      <div style={{ fontSize: 11, fontWeight: 700, textAlign: 'center', color: 'var(--text-primary)', textTransform: 'capitalize' }}>{u?.type ?? 'unit'}</div>
      <div style={{ fontSize: 9, textAlign: 'center', color: 'var(--text-muted)', lineHeight: 1.5 }}>
        Apollo-native device · mix {Math.round((u?.mix ?? 1) * 100)}%<br />edit via Apollo Rack ↗ in the chain header
      </div>
    </div>
  )
}

export default function DeviceChain({ trackId }: { trackId: string }) {
  const { project } = useDaw()
  const track = project.tracks.find(t => t.id === trackId)
  if (!track) return null

  const midiEffects = track.midiEffects ?? []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      <ApolloRackLauncher trackId={trackId} />
      {/* Audio FX row — Apollo-style plate: devices share edges (seams, not
          gutters), one rounded border around the whole chain */}
      <div style={{ display: 'flex', flexDirection: 'row', overflowX: 'auto', padding: 8, alignItems: 'flex-start', gap: 8 }}>
        {track.effects.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'stretch', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', flexShrink: 0 }}>
            {track.effects.map(effect => (
              <EffectDevice key={effect.id} effect={effect} trackId={trackId} />
            ))}
          </div>
        )}
        <HeliosFxChip trackId={trackId} />
        <VoiceChainButton trackId={trackId} />
        <AddDeviceButton trackId={trackId} />
      </div>
      {/* MIDI FX row */}
      {(midiEffects.length > 0 || track.instrument) && (
        <div style={{ borderTop: '1px solid rgb(var(--accent-rgb) / 0.2)', padding: '4px 8px 4px', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 8, color: 'rgb(var(--accent-rgb) / 0.7)', letterSpacing: '0.1em', fontWeight: 700, flexShrink: 0 }}>MIDI FX</span>
          <div style={{ display: 'flex', flexDirection: 'row', gap: 6, overflowX: 'auto', alignItems: 'flex-start' }}>
            {midiEffects.map(mfx => (
              <MidiEffectCard key={mfx.id} effect={mfx} trackId={trackId} />
            ))}
            <AddMidiEffectButton trackId={trackId} />
          </div>
        </div>
      )}
    </div>
  )
}

// "Open in Apollo": hosts the track's FX chain inside the real Apollo Rack
// card. Editing a device there converts it to an Apollo-native device
// (helios wrapper); untouched devices keep their Beacon form.
const ApolloCardLazy = nextDynamic(() => import('@/components/apps/apollo/ApolloCard'), { ssr: false })

// Shared rack presets: the SAME factory + saved racks as Apollo's Racks ▾
// (apollo_fx_racks_v1). Loading a rack replaces the chain with Apollo-native
// wrapper devices; Save stores the current chain's translation.
function BeaconRacksMenu({ trackId }: { trackId: string }) {
  const { project, dispatch } = useDaw()
  const [open, setOpen] = useState(false)
  const [saved, setSaved] = useState<{ name: string; units: { id: string; type: string; enabled: boolean; mix: number; params: Record<string, number> }[] }[]>([])
  const menuRef = useRef<HTMLDivElement>(null)
  const track = project.tracks.find(t => t.id === trackId)
  useEffect(() => {
    if (!open) return
    try { setSaved(JSON.parse(localStorage.getItem('apollo_fx_racks_v1') || '[]')) } catch { setSaved([]) }
    const onDown = (e: PointerEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false) }
    window.addEventListener('pointerdown', onDown)
    return () => window.removeEventListener('pointerdown', onDown)
  }, [open])
  if (!track) return null
  const loadUnits = (units: { id: string; type: string; enabled: boolean; mix: number; params: Record<string, number> }[]) => {
    const effects = units.map(u => ({
      id: crypto.randomUUID(),
      type: 'helios' as const,
      params: { enabled: true, unit: { ...u, id: crypto.randomUUID() } },
    }))
    dispatch({ type: 'SET_TRACK_EFFECTS', trackId, effects: effects as never })
    setOpen(false)
  }
  const item: React.CSSProperties = { display: 'block', width: '100%', textAlign: 'left', padding: '4px 8px', borderRadius: 5, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-primary)', fontSize: 10.5 }
  const head: React.CSSProperties = { fontSize: 8.5, fontWeight: 800, letterSpacing: 1, color: 'var(--text-muted)', textTransform: 'uppercase', padding: '3px 8px 1px' }
  return (
    <div ref={menuRef} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        title="Load a rack — the same factory and saved racks as Apollo's Effects page"
        style={{ height: 22, padding: '0 10px', borderRadius: 5, cursor: 'pointer', fontSize: 9, fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase', background: open ? 'var(--accent)' : 'transparent', color: open ? '#0b0d10' : 'var(--text-muted)', border: '1px solid ' + (open ? 'var(--accent)' : 'var(--border)') }}
      >Racks ▾</button>
      {open && (
        <div style={{ position: 'absolute', top: '110%', right: 0, zIndex: 260, minWidth: 190, maxHeight: 260, overflowY: 'auto', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: 5, boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}>
          <div style={head}>Factory racks</div>
          <FactoryRackItems onPick={loadUnits} itemStyle={item} />
          {saved.length > 0 && <div style={head}>Saved racks (Apollo)</div>}
          {saved.map(r => (
            <button key={r.name} style={item} onClick={() => loadUnits(r.units)}>{r.name}</button>
          ))}
          <div style={head}>This chain</div>
          <button style={item} onClick={() => {
            void import('@/lib/apollo/daw-fx').then(({ translateChain }) => {
              const units = translateChain(track.effects, project.tempo)
              if (!units) return
              const name = window.prompt('Rack name:')?.trim()
              if (!name) return
              try {
                const list = JSON.parse(localStorage.getItem('apollo_fx_racks_v1') || '[]') as { name: string }[]
                const next = [...list.filter(x => x.name !== name), { name, units }]
                localStorage.setItem('apollo_fx_racks_v1', JSON.stringify(next))
                setSaved(next as never)
              } catch { /* quota */ }
            })
          }}>Save as rack…</button>
        </div>
      )}
    </div>
  )
}

function FactoryRackItems({ onPick, itemStyle }: { onPick: (units: never) => void; itemStyle: React.CSSProperties }) {
  const [racks, setRacks] = useState<{ name: string; make: () => unknown[] }[]>([])
  useEffect(() => {
    void import('@/components/apps/apollo/FxRack').then(m => {
      const f = (m as unknown as { FACTORY_RACKS?: { name: string; make: () => unknown[] }[] }).FACTORY_RACKS
      if (f) setRacks(f)
    })
  }, [])
  return <>{racks.map(r => <button key={r.name} style={itemStyle} onClick={() => onPick(r.make() as never)}>{r.name}</button>)}</>
}

function ApolloRackLauncher({ trackId }: { trackId: string }) {
  const { project, dispatch } = useDaw()
  const [open, setOpen] = useState(false)
  const [seed, setSeed] = useState<object | null>(null)
  const track = project.tracks.find(t => t.id === trackId)
  if (!track || track.heliosFx === false) return null
  const openRack = async () => {
    const { translateChain } = await import('@/lib/apollo/daw-fx')
    const { initPatch } = await import('@/lib/apollo/patch')
    const units = translateChain(track.effects, project.tempo)
    if (!units) return
    const p = initPatch()
    for (const o of p.oscs) o.enabled = false
    p.sub.enabled = false; p.noise.enabled = false
    p.matrix = []; p.fxMain = units; p.fxBus1 = []; p.fxBus2 = []
    setSeed(p)
    setOpen(true)
  }
  return (
    <>
      <div style={{ padding: '6px 8px 0', display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
        <BeaconRacksMenu trackId={trackId} />
        <button
          onClick={() => { void openRack() }}
          title="Open this chain in the Apollo Rack — full Apollo editing; edited devices become Apollo-native"
          style={{
            height: 22, padding: '0 12px', borderRadius: 5, cursor: 'pointer',
            fontSize: 9, fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase',
            background: 'var(--accent)', color: '#0b0d10', border: '1px solid var(--accent)',
          }}
        >☀︎ Apollo Rack</button>
      </div>
      {open && seed && (
        <ApolloCardLazy
          patch={seed as never}
          fxOnly
          title={`${track.name} — FX`}
          onChange={(next: { fxMain: unknown[] }) => {
            void import('@/lib/apollo/daw-fx').then(({ applyRackEdit }) => {
              const eff = applyRackEdit(track.effects, next.fxMain as never)
              dispatch({ type: 'SET_TRACK_EFFECTS', trackId, effects: eff })
            })
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

// Per-track engine chip: Helios (Apollo's engine renders the chain) is the
// default; the chip drops a track back to the legacy WebAudio path. Chains
// Helios can't translate yet (sidechain, custom IRs, gate/de-esser/…) fall
// back automatically regardless.
function HeliosFxChip({ trackId }: { trackId: string }) {
  const { project, dispatch } = useDaw()
  const track = project.tracks.find(t => t.id === trackId)
  if (!track || track.effects.length === 0) return null
  const on = track.heliosFx !== false
  return (
    <button
      onClick={() => dispatch({ type: 'SET_TRACK_HELIOS_FX', trackId, on: !on })}
      title={on
        ? 'FX render on the Helios engine (Apollo) — click for the legacy per-node path'
        : 'FX render on the legacy WebAudio path — click for the Helios engine'}
      style={{
        alignSelf: 'flex-start', flexShrink: 0, height: 22, padding: '0 9px', borderRadius: 5,
        fontSize: 9, fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase', cursor: 'pointer',
        background: on ? 'var(--accent)' : 'transparent',
        color: on ? '#0b0d10' : 'var(--text-muted)',
        border: '1px solid ' + (on ? 'var(--accent)' : 'var(--border)'),
      }}
    >{on ? 'Helios' : 'Legacy'}</button>
  )
}

export function ReturnDeviceChain({ returnId }: { returnId: string }) {
  const { project } = useDaw()
  const rt = project.returnTracks.find(r => r.id === returnId)
  if (!rt) return null

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'row',
      gap: 8,
      overflowX: 'auto',
      padding: 8,
      alignItems: 'flex-start',
    }}>
      {rt.effects.map(effect => (
        <EffectDevice key={effect.id} effect={effect} trackId={returnId} returnId={returnId} />
      ))}
      <AddDeviceButton trackId={returnId} returnId={returnId} />
    </div>
  )
}
