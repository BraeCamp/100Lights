'use client'

import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useDaw } from '@/lib/daw-state'
import type {
  TrackEffect, Eq3Params, CompressorParams, ReverbParams,
  DelayParams, FilterParams, SaturatorParams, ReduxParams, AutoPanParams, UtilityParams, LfoParams, EffectType,
  NoiseGateParams, DeEsserParams, ChorusParams, TransientShaperParams, MultibandCompParams,
  MidiEffect, MidiEffectType, VelocityMidiParams, ScaleMidiParams, ChordMidiParams, ArpMidiParams,
} from '@/lib/daw-types'
import {
  defaultEq3, defaultCompressor, defaultReverb, defaultDelay, defaultFilter,
  defaultSaturator, defaultRedux, defaultAutoPan, defaultUtility, defaultLfo,
  defaultNoiseGate, defaultDeEsser, defaultChorus, defaultTransientShaper, defaultMultibandComp,
  voiceChainEffects,
} from '@/lib/daw-types'

// ── Label map ──────────────────────────────────────────────────────────────────

const EFFECT_LABELS: Record<EffectType, string> = {
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
}

// ── Shared micro-components ────────────────────────────────────────────────────

function CtrlRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
      <span style={{
        color: 'var(--text-muted)', fontSize: 10, width: 52,
        flexShrink: 0, textAlign: 'right', lineHeight: 1,
      }}>
        {label}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
    </div>
  )
}

function RangeCtrl({ value, min, max, step = 0.01, onChange }: {
  value: number; min: number; max: number; step?: number
  onChange: (v: number) => void
}) {
  return (
    <input
      type="range"
      min={min} max={max} step={step} value={value}
      style={{ width: '100%', accentColor: 'var(--accent)', cursor: 'pointer', display: 'block' }}
      onChange={e => { e.stopPropagation(); onChange(parseFloat(e.target.value)) }}
      onKeyDown={e => e.stopPropagation()}
      onClick={e => e.stopPropagation()}
    />
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
            <button key={k} onClick={() => up({ [k]: !p[k] })} style={{ fontSize: 9, padding: '2px 5px', borderRadius: 2, cursor: 'pointer', border: `1px solid ${p[k] ? 'var(--accent)' : 'var(--border)'}`, background: p[k] ? 'rgba(61,143,239,0.18)' : 'var(--bg-surface)', color: p[k] ? 'var(--accent)' : 'var(--text-muted)' }}>
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
              style={{ fontSize: 8, padding: '2px 5px', borderRadius: 2, cursor: 'pointer', border: `1px solid ${p.type === t ? 'var(--accent)' : 'var(--border)'}`, background: p.type === t ? 'rgba(61,143,239,0.18)' : 'var(--bg-surface)', color: p.type === t ? 'var(--accent)' : 'var(--text-muted)' }}
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
      <CtrlRow label="Threshold"><RangeCtrl value={p.lowThreshold} min={-60} max={0} step={0.5} onChange={v => up({ lowThreshold: v })} /></CtrlRow>
      <CtrlRow label="Ratio"><RangeCtrl value={p.lowRatio} min={1} max={20} step={0.1} onChange={v => up({ lowRatio: v })} /></CtrlRow>
      <CtrlRow label="Gain dB"><RangeCtrl value={p.lowGain} min={-12} max={12} step={0.1} onChange={v => up({ lowGain: v })} /></CtrlRow>
      {bandLabel('#4ade80', 'Mid')}
      <CtrlRow label="Threshold"><RangeCtrl value={p.midThreshold} min={-60} max={0} step={0.5} onChange={v => up({ midThreshold: v })} /></CtrlRow>
      <CtrlRow label="Ratio"><RangeCtrl value={p.midRatio} min={1} max={20} step={0.1} onChange={v => up({ midRatio: v })} /></CtrlRow>
      <CtrlRow label="Gain dB"><RangeCtrl value={p.midGain} min={-12} max={12} step={0.1} onChange={v => up({ midGain: v })} /></CtrlRow>
      {bandLabel('#f87171', 'High')}
      <CtrlRow label="Threshold"><RangeCtrl value={p.highThreshold} min={-60} max={0} step={0.5} onChange={v => up({ highThreshold: v })} /></CtrlRow>
      <CtrlRow label="Ratio"><RangeCtrl value={p.highRatio} min={1} max={20} step={0.1} onChange={v => up({ highRatio: v })} /></CtrlRow>
      <CtrlRow label="Gain dB"><RangeCtrl value={p.highGain} min={-12} max={12} step={0.1} onChange={v => up({ highGain: v })} /></CtrlRow>
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
      border: '1px solid var(--border)',
      borderRadius: 4,
      display: 'flex',
      flexDirection: 'column',
      flexShrink: 0,
      opacity: enabled ? 1 : 0.55,
      transition: 'opacity 0.1s',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '5px 6px 4px',
        borderBottom: '1px solid var(--border)',
      }}>
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <span style={{
            color: 'var(--text-primary)', fontSize: 11, fontWeight: 600,
            letterSpacing: '0.02em', display: 'block',
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
          ×
        </button>
      </div>
      {/* Controls */}
      <div style={{ padding: '8px 6px', flex: 1 }}>
        {effect.type === 'eq3'            && <Eq3Controls             effect={effect} trackId={trackId} returnId={returnId} />}
        {effect.type === 'compressor'     && <CompressorControls      effect={effect} trackId={trackId} returnId={returnId} />}
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
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
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
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(61,143,239,0.18)' }}
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
    <div style={{ width: 160, minHeight: 120, background: 'rgba(124,58,237,0.08)', border: '1px solid rgba(124,58,237,0.3)', borderRadius: 4, display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 6px', borderBottom: '1px solid rgba(124,58,237,0.2)', background: 'rgba(124,58,237,0.12)' }}>
        <button
          onClick={() => up({ enabled: !p.enabled })}
          style={{ width: 12, height: 12, borderRadius: 2, border: 'none', background: p.enabled ? '#a78bfa' : '#333', cursor: 'pointer', padding: 0, flexShrink: 0 }}
        />
        <span style={{ flex: 1, fontSize: 10, fontWeight: 700, color: '#c4b5fd', letterSpacing: '0.04em' }}>{MIDI_EFFECT_LABELS[effect.type]}</span>
        <button onClick={() => dispatch({ type: 'REMOVE_MIDI_EFFECT', trackId, effectId: effect.id })}
          style={{ width: 14, height: 14, border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 14, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>×</button>
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
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
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
        style={{ width: 28, height: 28, borderRadius: 4, border: '1px dashed rgba(124,58,237,0.4)', background: 'transparent', color: 'rgba(124,58,237,0.6)', cursor: 'pointer', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
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

export default function DeviceChain({ trackId }: { trackId: string }) {
  const { project } = useDaw()
  const track = project.tracks.find(t => t.id === trackId)
  if (!track) return null

  const midiEffects = track.midiEffects ?? []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {/* Audio FX row */}
      <div style={{
        display: 'flex',
        flexDirection: 'row',
        gap: 8,
        overflowX: 'auto',
        padding: 8,
        alignItems: 'flex-start',
      }}>
        {track.effects.map(effect => (
          <EffectDevice key={effect.id} effect={effect} trackId={trackId} />
        ))}
        <VoiceChainButton trackId={trackId} />
        <AddDeviceButton trackId={trackId} />
      </div>
      {/* MIDI FX row */}
      {(midiEffects.length > 0 || track.instrument) && (
        <div style={{ borderTop: '1px solid rgba(124,58,237,0.2)', padding: '4px 8px 4px', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 8, color: 'rgba(124,58,237,0.7)', letterSpacing: '0.1em', fontWeight: 700, flexShrink: 0 }}>MIDI FX</span>
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
