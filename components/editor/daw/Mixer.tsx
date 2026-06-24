'use client'

import { useState, useRef } from 'react'
import { Circle } from 'lucide-react'
import { useDaw } from '@/lib/daw-state'
import type { DawTrack } from '@/lib/daw-types'
import LevelMeter from './LevelMeter'
import Knob from './Knob'

// ── Vertical fader ─────────────────────────────────────────────────────────

function VerticalFader({ value, onChange, onCommit }: {
  value: number
  onChange: (v: number) => void
  onCommit?: (v: number) => void
}) {
  const trackH = 110
  const thumbH = 16
  const max    = 1.2
  const pos    = (1 - value / max) * (trackH - thumbH)
  const dragRef = useRef<{ startY: number; startVal: number } | null>(null)

  function onMouseDown(e: React.MouseEvent) {
    dragRef.current = { startY: e.clientY, startVal: value }
    function onMove(ev: MouseEvent) {
      if (!dragRef.current) return
      const delta = (dragRef.current.startY - ev.clientY) / (trackH - thumbH) * max
      onChange(Math.max(0, Math.min(max, dragRef.current.startVal + delta)))
    }
    function onUp(ev: MouseEvent) {
      if (!dragRef.current) return
      const delta = (dragRef.current.startY - ev.clientY) / (trackH - thumbH) * max
      onCommit?.(Math.max(0, Math.min(max, dragRef.current.startVal + delta)))
      dragRef.current = null
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  const db = value > 0.0001 ? (20 * Math.log10(value)).toFixed(1) : '-∞'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
      <div
        style={{ width: 8, height: trackH, background: '#1a1a1a', borderRadius: 4, position: 'relative', cursor: 'ns-resize', userSelect: 'none' }}
        onMouseDown={onMouseDown}
      >
        <div style={{
          position: 'absolute', left: -3, right: -3,
          top: (1 - 0.8 / max) * (trackH - thumbH) + thumbH / 2,
          height: 1, background: 'rgba(255,255,255,0.15)', pointerEvents: 'none',
        }} />
        <div style={{
          position: 'absolute', left: -5, top: Math.round(pos),
          width: 18, height: thumbH,
          background: 'linear-gradient(180deg,#555 0%,#3a3a3a 100%)',
          borderRadius: 3, border: '1px solid #666', cursor: 'ns-resize',
        }} />
      </div>
      <span style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'monospace', letterSpacing: '0.04em' }}>
        {db}dB
      </span>
    </div>
  )
}

// ── Channel strip ──────────────────────────────────────────────────────────

function ChannelStrip({ track, isMaster }: { track?: DawTrack; isMaster?: boolean }) {
  const { project, dispatch, engine } = useDaw()
  const [eqLo, setEqLo]   = useState(0)
  const [eqMid, setEqMid] = useState(0)
  const [eqHi, setEqHi]   = useState(0)
  const [editing, setEditing]   = useState(false)
  const [nameDraft, setNameDraft] = useState(track?.name ?? 'MASTER')

  const volume  = isMaster ? project.masterVolume : (track?.volume ?? 0.8)
  const pan     = track?.pan ?? 0
  const muted   = track?.mute ?? false
  const soloed  = track?.solo ?? false
  const armed   = track?.armed ?? false
  const anySolo = project.tracks.some(t => t.solo)
  const dimmed  = !isMaster && anySolo && !soloed
  const color   = track?.color ?? '#3d8fef'
  const typeLabel = track
    ? (track.type === 'audio' ? 'A' : track.type === 'midi' ? 'M' : 'D')
    : ''
  const panLabel = pan === 0 ? 'C' : pan < 0 ? `L${Math.round(-pan * 100)}` : `R${Math.round(pan * 100)}`

  return (
    <div style={{
      width: isMaster ? 80 : 72, flexShrink: 0,
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      gap: 4, padding: '8px 4px 6px',
      background: isMaster ? '#1a1a1a' : 'var(--bg-card)',
      borderRight: '1px solid var(--border)',
      opacity: dimmed ? 0.4 : 1, transition: 'opacity 0.15s',
      position: 'relative',
    }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: color, borderRadius: '2px 2px 0 0' }} />

      {/* Name */}
      {editing && track ? (
        <input
          autoFocus value={nameDraft}
          onChange={e => setNameDraft(e.target.value)}
          onBlur={() => { dispatch({ type: 'UPDATE_TRACK', trackId: track.id, patch: { name: nameDraft } }); setEditing(false) }}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === 'Escape') { dispatch({ type: 'UPDATE_TRACK', trackId: track.id, patch: { name: nameDraft } }); setEditing(false) }
            e.stopPropagation()
          }}
          style={{ width: '100%', fontSize: 10, background: '#111', border: '1px solid var(--accent)', color: 'var(--text-primary)', borderRadius: 3, textAlign: 'center', padding: '1px 2px', outline: 'none' }}
        />
      ) : (
        <div
          onDoubleClick={() => { if (track) { setEditing(true); setNameDraft(track.name) } }}
          style={{ fontSize: 10, color: 'var(--text-secondary)', textAlign: 'center', width: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'default', userSelect: 'none', marginTop: 4 }}
          title={track?.name ?? 'MASTER'}
        >
          {track?.name ?? 'MASTER'}
        </div>
      )}

      {/* EQ knobs */}
      <div style={{ display: 'flex', gap: 2 }}>
        <Knob value={eqLo}  min={-12} max={12} defaultValue={0} size={20} color="#22c55e" label="LO"  onChange={setEqLo} />
        <Knob value={eqMid} min={-12} max={12} defaultValue={0} size={20} color="#eab308" label="MID" onChange={setEqMid} />
        <Knob value={eqHi}  min={-12} max={12} defaultValue={0} size={20} color="#3b82f6" label="HI"  onChange={setEqHi} />
      </div>

      {/* Pan */}
      {!isMaster && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <Knob
            value={pan} min={-1} max={1} defaultValue={0} size={26} color={color}
            onChange={v => { dispatch({ type: 'UPDATE_TRACK', trackId: track!.id, patch: { pan: v } }); engine.setTrackPan(track!.id, v) }}
            format={v => v === 0 ? 'Center' : v < 0 ? `L${Math.round(-v * 100)}` : `R${Math.round(v * 100)}`}
          />
          <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>{panLabel}</span>
        </div>
      )}

      {/* Mute / Solo */}
      {!isMaster && track && (
        <div style={{ display: 'flex', gap: 2 }}>
          <button onClick={() => dispatch({ type: 'UPDATE_TRACK', trackId: track.id, patch: { mute: !muted } })}
            style={{ width: 24, height: 18, fontSize: 9, borderRadius: 3, border: '1px solid var(--border)', background: muted ? '#d97706' : 'var(--bg-surface)', color: muted ? '#fff' : 'var(--text-secondary)', cursor: 'pointer', fontWeight: 700 }}
            title="Mute">M</button>
          <button onClick={() => dispatch({ type: 'UPDATE_TRACK', trackId: track.id, patch: { solo: !soloed } })}
            style={{ width: 24, height: 18, fontSize: 9, borderRadius: 3, border: '1px solid var(--border)', background: soloed ? '#eab308' : 'var(--bg-surface)', color: soloed ? '#000' : 'var(--text-secondary)', cursor: 'pointer', fontWeight: 700 }}
            title="Solo">S</button>
        </div>
      )}

      {/* Fader + meter */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, flex: 1 }}>
        <VerticalFader
          value={volume}
          onChange={v => {
            if (isMaster) { dispatch({ type: 'SET_MASTER_VOLUME', volume: v }); engine.setMasterVolume(v) }
            else if (track) dispatch({ type: 'UPDATE_TRACK', trackId: track.id, patch: { volume: v } })
          }}
        />
        <LevelMeter trackId={isMaster ? undefined : track?.id} width={6} height={110} />
      </div>

      {/* Arm */}
      {!isMaster && track && (
        <button
          onClick={() => dispatch({ type: 'UPDATE_TRACK', trackId: track.id, patch: { armed: !armed } })}
          style={{ width: 24, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 3, border: '1px solid var(--border)', cursor: 'pointer', background: armed ? 'rgba(239,68,68,0.2)' : 'var(--bg-surface)', color: armed ? '#ef4444' : 'var(--text-muted)' }}
          title="Arm for recording"
        >
          <Circle size={8} fill={armed ? '#ef4444' : 'transparent'} />
        </button>
      )}

      {typeLabel && <span style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '0.08em', fontFamily: 'monospace' }}>{typeLabel}</span>}
    </div>
  )
}

// ── Mixer ──────────────────────────────────────────────────────────────────

export default function Mixer() {
  const { project, dispatch } = useDaw()

  return (
    <div style={{ display: 'flex', height: '100%', background: 'var(--bg-surface)', overflow: 'hidden' }}>
      <div style={{ display: 'flex', overflowX: 'auto', overflowY: 'hidden', flex: 1 }}>
        {project.tracks.map(track => (
          <ChannelStrip key={track.id} track={track} />
        ))}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '8px 6px', justifyContent: 'flex-end' }}>
          {(['audio', 'midi', 'drum'] as const).map(type => (
            <button
              key={type}
              onClick={() => dispatch({ type: 'ADD_TRACK', trackType: type })}
              style={{ width: 60, padding: '4px 0', fontSize: 10, borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-secondary)', cursor: 'pointer', letterSpacing: '0.03em' }}
            >
              + {type.charAt(0).toUpperCase() + type.slice(1)}
            </button>
          ))}
        </div>
      </div>
      <div style={{ flexShrink: 0, borderLeft: '2px solid var(--border)' }}>
        <ChannelStrip isMaster />
      </div>
    </div>
  )
}
