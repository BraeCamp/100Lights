'use client'

import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useDaw } from '@/lib/daw-state'
import type {
  TrackEffect, Eq3Params, CompressorParams, ReverbParams,
  DelayParams, FilterParams, EffectType,
} from '@/lib/daw-types'
import {
  defaultEq3, defaultCompressor, defaultReverb, defaultDelay, defaultFilter,
} from '@/lib/daw-types'

// ── Label map ──────────────────────────────────────────────────────────────────

const EFFECT_LABELS: Record<EffectType, string> = {
  eq3:        'EQ3',
  compressor: 'Compressor',
  reverb:     'Reverb',
  delay:      'Delay',
  filter:     'Filter',
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

  return (
    <>
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

  return (
    <>
      <CtrlRow label="Wet">
        <RangeCtrl value={p.wet} min={0} max={1} step={0.01} onChange={v => up({ wet: v })} />
      </CtrlRow>
      <CtrlRow label="Decay">
        <RangeCtrl value={p.decay} min={0.1} max={10} step={0.1} onChange={v => up({ decay: v })} />
      </CtrlRow>
      <CtrlRow label="Pre-delay">
        <RangeCtrl value={p.preDelay} min={0} max={0.5} step={0.001} onChange={v => up({ preDelay: v })} />
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

// ── Device card ────────────────────────────────────────────────────────────────

function EffectDevice({ effect, trackId, returnId }: { effect: TrackEffect; trackId: string; returnId?: string }) {
  const { dispatch } = useDaw()
  const enabled = effect.params.enabled

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
        <span style={{
          color: 'var(--text-primary)', fontSize: 11, fontWeight: 600,
          letterSpacing: '0.02em', flex: 1, overflow: 'hidden',
          textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {EFFECT_LABELS[effect.type]}
        </span>
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
        {effect.type === 'eq3'        && <Eq3Controls        effect={effect} trackId={trackId} returnId={returnId} />}
        {effect.type === 'compressor' && <CompressorControls effect={effect} trackId={trackId} returnId={returnId} />}
        {effect.type === 'reverb'     && <ReverbControls     effect={effect} trackId={trackId} returnId={returnId} />}
        {effect.type === 'delay'      && <DelayControls      effect={effect} trackId={trackId} returnId={returnId} />}
        {effect.type === 'filter'     && <FilterControls     effect={effect} trackId={trackId} returnId={returnId} />}
      </div>
    </div>
  )
}

// ── Add device button + dropdown ───────────────────────────────────────────────

const ADD_OPTIONS: { type: EffectType; label: string }[] = [
  { type: 'eq3',        label: 'EQ3' },
  { type: 'compressor', label: 'Compressor' },
  { type: 'reverb',     label: 'Reverb' },
  { type: 'delay',      label: 'Delay' },
  { type: 'filter',     label: 'Filter' },
]

function makeDefaultParams(type: EffectType) {
  switch (type) {
    case 'eq3':        return defaultEq3()
    case 'compressor': return defaultCompressor()
    case 'reverb':     return defaultReverb()
    case 'delay':      return defaultDelay()
    case 'filter':     return defaultFilter()
  }
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

// ── Main export ────────────────────────────────────────────────────────────────

export default function DeviceChain({ trackId }: { trackId: string }) {
  const { project } = useDaw()
  const track = project.tracks.find(t => t.id === trackId)
  if (!track) return null

  return (
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
      <AddDeviceButton trackId={trackId} />
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
