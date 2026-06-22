'use client'

import React, { createContext, useContext, useRef, useState, useEffect } from 'react'
import type { MidiMapping, MidiMappingTarget } from '@/lib/midi-mapping'
import { targetLabel, deserializeMappings, serializeMappings } from '@/lib/midi-mapping'

// ── MidiLearnContext ──────────────────────────────────────────────────────────

interface MidiLearnCtx {
  isLearning: boolean
  learningTarget: MidiMappingTarget | null
  setLearnTarget: (t: MidiMappingTarget) => void
}

export const MidiLearnContext = createContext<MidiLearnCtx | null>(null)

// ── MidiLearnTarget ───────────────────────────────────────────────────────────

/**
 * Wrap any learnable parameter in this component.
 * While MIDI Learn mode is active it renders a pulsing orange border and
 * registers itself as the learn target on click.
 */
export function MidiLearnTarget({
  target,
  children,
  style,
}: {
  target: MidiMappingTarget
  children: React.ReactNode
  style?: React.CSSProperties
}) {
  const ctx = useContext(MidiLearnContext)
  if (!ctx) return <>{children}</>

  const { isLearning, learningTarget, setLearnTarget } = ctx

  const isActive =
    isLearning &&
    learningTarget !== null &&
    JSON.stringify(learningTarget) === JSON.stringify(target)

  const isPending = isLearning && !isActive

  return (
    <div
      data-midi-target={JSON.stringify(target)}
      onClick={() => { if (isLearning) setLearnTarget(target) }}
      style={{
        ...style,
        position: 'relative',
        borderRadius: 4,
        outline: isActive
          ? '2px solid #f97316'
          : isPending
          ? '2px dashed rgba(249,115,22,0.45)'
          : 'none',
        cursor: isLearning ? 'crosshair' : undefined,
        transition: 'outline 0.12s',
        animation: isActive ? 'midi-learn-pulse 0.8s ease-in-out infinite' : undefined,
      }}
    >
      {children}
      {isActive && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
          justifyContent: 'center', background: 'rgba(249,115,22,0.12)',
          borderRadius: 4, pointerEvents: 'none', zIndex: 10,
        }}>
          <span style={{ fontSize: 9, fontWeight: 700, color: '#f97316', letterSpacing: '0.06em', textTransform: 'uppercase', background: 'rgba(0,0,0,0.55)', padding: '2px 5px', borderRadius: 3 }}>
            Turn knob
          </span>
        </div>
      )}
    </div>
  )
}

// ── MidiMappingPanel ──────────────────────────────────────────────────────────

export interface MidiMappingPanelProps {
  open: boolean
  mappings: MidiMapping[]
  learningTarget: MidiMappingTarget | null
  onStartLearn: (target: MidiMappingTarget) => void
  onStopLearn: () => void
  onUpdateMapping: (id: string, update: Partial<MidiMapping>) => void
  onDeleteMapping: (id: string) => void
  onImport: (mappings: MidiMapping[]) => void
  onExport: () => void
  onClose: () => void
  activeLaneTypes: string[]
  laneLabels: Record<string, string>
  /** Pass newly-confirmed mappings so the row can flash */
  lastAddedId?: string | null
}

// Simple curve selector component
function CurveSelect({ value, onChange }: { value: MidiMapping['curve']; onChange: (v: MidiMapping['curve']) => void }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value as MidiMapping['curve'])}
      style={{
        fontSize: 10, background: 'var(--bg-surface)', border: '1px solid var(--border)',
        borderRadius: 3, color: 'var(--text-secondary)', padding: '1px 3px', cursor: 'pointer',
      }}
    >
      <option value="linear">Lin</option>
      <option value="log">Log</option>
      <option value="exp">Exp</option>
    </select>
  )
}

// Editable number input for min/max
function NumInput({ value, onChange, step = 0.01 }: { value: number; onChange: (v: number) => void; step?: number }) {
  const [raw, setRaw] = useState(String(value))
  useEffect(() => { setRaw(String(value)) }, [value])
  return (
    <input
      type="number"
      value={raw}
      step={step}
      onChange={e => setRaw(e.target.value)}
      onBlur={() => {
        const n = parseFloat(raw)
        if (!isNaN(n)) onChange(n)
        else setRaw(String(value))
      }}
      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
      style={{
        width: 52, fontSize: 10, background: 'var(--bg-surface)',
        border: '1px solid var(--border)', borderRadius: 3,
        color: 'var(--text-secondary)', padding: '1px 4px', textAlign: 'right',
      }}
    />
  )
}

export default function MidiMappingPanel({
  open,
  mappings,
  learningTarget,
  onStopLearn,
  onUpdateMapping,
  onDeleteMapping,
  onImport,
  onExport,
  onClose,
  laneLabels,
  lastAddedId,
}: MidiMappingPanelProps) {
  const [flashId, setFlashId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Flash the newly added row
  useEffect(() => {
    if (!lastAddedId) return
    setFlashId(lastAddedId)
    const t = setTimeout(() => setFlashId(null), 1200)
    return () => clearTimeout(t)
  }, [lastAddedId])

  if (!open) return null

  const isLearning = learningTarget !== null

  function handleImportClick() {
    fileInputRef.current?.click()
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      try {
        const parsed = JSON.parse(ev.target?.result as string)
        const store = deserializeMappings(parsed)
        onImport(store.mappings)
      } catch { /* ignore bad JSON */ }
    }
    reader.readAsText(file)
    // reset so same file can be re-imported
    e.target.value = ''
  }

  return (
    <>
      {/* Backdrop */}
      <div
        style={{ position: 'fixed', inset: 0, zIndex: 499 }}
        onClick={onClose}
      />

      {/* Panel */}
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0,
        width: 340, zIndex: 500,
        background: 'var(--bg-surface)',
        borderLeft: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column',
        boxShadow: '-8px 0 32px rgba(0,0,0,0.4)',
      }}>
        {/* CSS animations injected inline */}
        <style>{`
          @keyframes midi-learn-pulse {
            0%, 100% { outline-color: #f97316; }
            50%       { outline-color: rgba(249,115,22,0.35); }
          }
          @keyframes midi-row-flash {
            0%   { background: rgba(249,115,22,0.25); }
            100% { background: transparent; }
          }
        `}</style>

        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 14px', borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>
              MIDI Mappings
            </span>
            {mappings.length > 0 && (
              <span style={{ fontSize: 10, color: 'var(--text-muted)', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: '1px 6px' }}>
                {mappings.length}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {/* Learn mode indicator */}
            {isLearning && (
              <span style={{
                fontSize: 10, fontWeight: 700, color: '#f97316', padding: '2px 8px',
                borderRadius: 4, background: 'rgba(249,115,22,0.15)',
                border: '1px solid rgba(249,115,22,0.4)',
                animation: 'midi-learn-pulse 1s ease-in-out infinite',
              }}>
                LEARNING
              </span>
            )}
            {isLearning && (
              <button
                onClick={onStopLearn}
                style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4, background: 'rgba(249,115,22,0.12)', border: '1px solid rgba(249,115,22,0.35)', color: '#f97316', cursor: 'pointer', fontWeight: 600 }}
              >
                Cancel
              </button>
            )}
            <button
              onClick={onClose}
              style={{ fontSize: 16, lineHeight: 1, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '2px 4px' }}
              title="Close MIDI Mapping panel"
            >
              ×
            </button>
          </div>
        </div>

        {/* Learn mode target hint */}
        {isLearning && learningTarget && (
          <div style={{
            padding: '8px 14px',
            background: 'rgba(249,115,22,0.08)',
            borderBottom: '1px solid rgba(249,115,22,0.2)',
            fontSize: 11, color: '#f97316',
          }}>
            Target: <strong>{targetLabel(learningTarget, laneLabels)}</strong>
            <br />
            <span style={{ fontSize: 10, color: 'rgba(249,115,22,0.7)' }}>
              Turn a knob on your controller…
            </span>
          </div>
        )}

        {/* Mapping list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '6px 0' }}>
          {mappings.length === 0 ? (
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              gap: 10, padding: '48px 24px', textAlign: 'center',
            }}>
              <div style={{ fontSize: 28, opacity: 0.3 }}>🎛</div>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6, margin: 0 }}>
                Connect a MIDI controller and turn a knob to start mapping
              </p>
              <p style={{ fontSize: 11, color: 'var(--text-muted)', opacity: 0.7, margin: 0 }}>
                Right-click any parameter (volume, pan, reverb…) then click a lane parameter while learn mode is active.
              </p>
            </div>
          ) : (
            mappings.map(m => (
              <div
                key={m.id}
                style={{
                  padding: '7px 14px',
                  borderBottom: '1px solid var(--border)',
                  animation: flashId === m.id ? 'midi-row-flash 1.2s ease-out forwards' : undefined,
                }}
              >
                {/* Row top: CC badge → target label */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
                  <span style={{
                    fontSize: 10, fontWeight: 700, fontFamily: 'monospace',
                    color: 'rgba(139,92,246,0.9)', background: 'rgba(139,92,246,0.12)',
                    border: '1px solid rgba(139,92,246,0.3)', borderRadius: 4, padding: '1px 5px',
                    flexShrink: 0,
                  }}>
                    {m.channel === 'any' ? 'ANY' : `CH${m.channel}`} CC{m.cc}
                  </span>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}>→</span>
                  <span style={{ fontSize: 11, color: 'var(--text-primary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {m.label || targetLabel(m.target, laneLabels)}
                  </span>
                  <button
                    onClick={() => onDeleteMapping(m.id)}
                    title="Remove mapping"
                    style={{ fontSize: 12, lineHeight: 1, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '1px 3px', flexShrink: 0 }}
                  >×</button>
                </div>

                {/* Row controls: min / max / curve */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 9, color: 'var(--text-muted)', flexShrink: 0 }}>Min</span>
                  <NumInput value={m.min} onChange={v => onUpdateMapping(m.id, { min: v })} />
                  <span style={{ fontSize: 9, color: 'var(--text-muted)', flexShrink: 0 }}>Max</span>
                  <NumInput value={m.max} onChange={v => onUpdateMapping(m.id, { max: v })} />
                  <CurveSelect value={m.curve} onChange={v => onUpdateMapping(m.id, { curve: v })} />
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer: Import / Export */}
        <div style={{
          padding: '10px 14px', borderTop: '1px solid var(--border)',
          display: 'flex', gap: 8, flexShrink: 0,
        }}>
          <button
            onClick={handleImportClick}
            style={{
              flex: 1, fontSize: 11, fontWeight: 600, padding: '6px 0', borderRadius: 5,
              background: 'var(--bg-card)', border: '1px solid var(--border)',
              color: 'var(--text-secondary)', cursor: 'pointer',
            }}
          >
            Import JSON
          </button>
          <button
            onClick={onExport}
            disabled={mappings.length === 0}
            style={{
              flex: 1, fontSize: 11, fontWeight: 600, padding: '6px 0', borderRadius: 5,
              background: mappings.length > 0 ? 'rgba(139,92,246,0.15)' : 'var(--bg-card)',
              border: `1px solid ${mappings.length > 0 ? 'rgba(139,92,246,0.4)' : 'var(--border)'}`,
              color: mappings.length > 0 ? 'rgba(167,139,250,1)' : 'var(--text-muted)',
              cursor: mappings.length > 0 ? 'pointer' : 'default',
            }}
          >
            Export JSON
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />
        </div>
      </div>
    </>
  )
}

// Re-export serialization helpers so callers can use them from a single import
export { serializeMappings, deserializeMappings }
