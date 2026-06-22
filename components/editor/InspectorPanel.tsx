'use client'

import { useState } from 'react'

interface InspectorLane {
  type: string
  label: string
  color: string
  hitCount: number
  level: number
  pan: number
  muted: boolean
  soloed: boolean
  effectCount: number
  automCount: number
}

interface InspectorPanelProps {
  lane: InspectorLane | null
  bpm: number | null
  duration: number
  totalHits: number
  laneCount: number
  onClose: () => void
  onMute: () => void
  onSolo: () => void
  onPanChange: (v: number) => void
  onOpenPianoRoll?: () => void
  onOpenStepSeq?: () => void
  onOpenChordBuilder?: () => void
  onOpenArpeggiator?: () => void
  onToggleFx: () => void
  onToggleAutom: () => void
}

export default function InspectorPanel({
  lane, bpm, duration, totalHits, laneCount, onClose,
  onMute, onSolo, onPanChange,
  onOpenPianoRoll, onOpenStepSeq, onOpenChordBuilder, onOpenArpeggiator,
  onToggleFx, onToggleAutom,
}: InspectorPanelProps) {
  const [tab, setTab] = useState<'lane' | 'project'>('lane')

  const sec = (v: number) => `${v.toFixed(1)}s`
  const bars = bpm && duration ? Math.round(duration / (60 / bpm / 4) / 4) : null

  const tabBtn = (id: typeof tab, label: string) => (
    <button key={id} onClick={() => setTab(id)} style={{
      flex: 1, padding: '5px 0', background: tab === id ? 'var(--bg-card)' : 'none',
      border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 11,
      color: tab === id ? 'var(--text-primary)' : 'var(--text-muted)', fontWeight: tab === id ? 600 : 400,
    }}>{label}</button>
  )

  const row = (label: string, value: string | number) => (
    <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'monospace' }}>{value}</span>
    </div>
  )

  const actionBtn = (label: string, onClick: () => void, active = false) => (
    <button key={label} onClick={onClick} style={{
      display: 'block', width: '100%', padding: '7px 10px', background: active ? 'rgba(139,92,246,0.12)' : 'none',
      border: `1px solid ${active ? 'rgba(139,92,246,0.35)' : 'var(--border)'}`,
      borderRadius: 6, cursor: 'pointer', textAlign: 'left', fontSize: 11,
      color: active ? 'rgba(167,139,250,1)' : 'var(--text-secondary)', marginBottom: 4,
    }}>{label}</button>
  )

  return (
    <div style={{
      width: 240, flexShrink: 0, borderLeft: '1px solid var(--border)',
      background: 'var(--bg-surface)', display: 'flex', flexDirection: 'column',
      overflowY: 'auto',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', flex: 1 }}>Inspector</span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 16, lineHeight: 1, padding: '0 2px' }}>✕</button>
      </div>

      {/* Tab strip */}
      <div style={{ display: 'flex', gap: 2, padding: 6, background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)' }}>
        {tabBtn('lane', 'Lane')}
        {tabBtn('project', 'Project')}
      </div>

      <div style={{ padding: 12, flex: 1 }}>
        {tab === 'project' && (
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Session</div>
            {row('BPM', bpm ?? '—')}
            {row('Duration', sec(duration))}
            {bars !== null && row('Bars', bars)}
            {row('Total hits', totalHits)}
            {row('Active lanes', laneCount)}
          </div>
        )}

        {tab === 'lane' && !lane && (
          <div style={{ color: 'var(--text-muted)', fontSize: 11, paddingTop: 8 }}>
            Click a lane to inspect it.
          </div>
        )}

        {tab === 'lane' && lane && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* Lane identity */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: lane.color, flexShrink: 0 }} />
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{lane.label}</span>
            </div>

            {/* Stats */}
            <div>
              {row('Hits', lane.hitCount)}
              {row('FX slots', lane.effectCount)}
              {row('Automation', lane.automCount)}
            </div>

            {/* Level meter */}
            <div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 5 }}>Level</div>
              <div style={{ height: 6, background: 'var(--bg-base)', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${Math.min(100, lane.level * 400)}%`, background: lane.level > 0.7 ? '#ef4444' : lane.level > 0.4 ? '#f59e0b' : lane.color, borderRadius: 3, transition: 'width 80ms linear' }} />
              </div>
            </div>

            {/* Pan */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Pan</span>
                <span style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--text-secondary)' }}>{lane.pan >= 0 ? '+' : ''}{Math.round(lane.pan * 100)}</span>
              </div>
              <input type="range" min={-1} max={1} step={0.01} value={lane.pan}
                onChange={e => onPanChange(Number(e.target.value))}
                style={{ width: '100%', accentColor: lane.color }} />
            </div>

            {/* Mute / Solo */}
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={onMute} style={{
                flex: 1, padding: '5px 0', borderRadius: 5, border: '1px solid',
                cursor: 'pointer', fontSize: 11, fontWeight: 700,
                background: lane.muted ? 'rgba(239,68,68,0.15)' : 'var(--bg-card)',
                borderColor: lane.muted ? 'rgba(239,68,68,0.5)' : 'var(--border)',
                color: lane.muted ? '#ef4444' : 'var(--text-muted)',
              }}>Mute</button>
              <button onClick={onSolo} style={{
                flex: 1, padding: '5px 0', borderRadius: 5, border: '1px solid',
                cursor: 'pointer', fontSize: 11, fontWeight: 700,
                background: lane.soloed ? 'rgba(251,191,36,0.15)' : 'var(--bg-card)',
                borderColor: lane.soloed ? 'rgba(251,191,36,0.5)' : 'var(--border)',
                color: lane.soloed ? 'rgb(251,191,36)' : 'var(--text-muted)',
              }}>Solo</button>
            </div>

            {/* Tools */}
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Tools</div>
              {actionBtn(`FX Chain${lane.effectCount > 0 ? ` (${lane.effectCount})` : ''}`, onToggleFx, lane.effectCount > 0)}
              {actionBtn(`Automation${lane.automCount > 0 ? ` (${lane.automCount})` : ''}`, onToggleAutom, lane.automCount > 0)}
              {onOpenStepSeq && actionBtn('Step Sequencer', onOpenStepSeq)}
              {onOpenPianoRoll && actionBtn('Piano Roll', onOpenPianoRoll)}
              {onOpenChordBuilder && actionBtn('Chord Builder', onOpenChordBuilder)}
              {onOpenArpeggiator && actionBtn('Arpeggiator', onOpenArpeggiator)}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
