'use client'

// Quantize Settings — Live's ⇧⌘U dialog, as a popover off the piano roll.
// Grid (follow the editor, or 1/4 … 1/32, straight or triplet), what moves
// (starts, ends, both), Amount, and a Quantize button that applies to the
// selection or the whole clip. The settings persist (lib/quantize.ts), so Q
// and ⌘U keep doing what you set here.

import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import Knob from './Knob'
import { QUANTIZE_GRIDS, describeQuantize, gridLabel, type QuantizeSettings, type QuantizeTarget } from '@/lib/quantize'

export function QuantizeDialog({ anchor, settings, editorGrid, onChange, onApply, onClose, count, scope }: {
  anchor: { x: number; y: number }
  settings: QuantizeSettings
  editorGrid: number
  onChange: (patch: Partial<QuantizeSettings>) => void
  onApply: () => void
  onClose: () => void
  /** How many notes the button will move. */
  count: number
  scope: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose() }
    // Escape closes the dialog and goes no further — left to travel on it
    // reaches the studio's "clear every selection" and closes the roll too.
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    document.addEventListener('mousedown', onDown, true)
    document.addEventListener('keydown', onKey, true)
    return () => { document.removeEventListener('mousedown', onDown, true); document.removeEventListener('keydown', onKey, true) }
  }, [onClose])

  const x = Math.max(8, Math.min(anchor.x, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 316))
  const y = Math.max(8, Math.min(anchor.y, (typeof window !== 'undefined' ? window.innerHeight : 800) - 240))
  const chip = (on: boolean): React.CSSProperties => ({
    fontSize: 9, fontWeight: 600, padding: '2px 7px', borderRadius: 4, cursor: 'pointer', whiteSpace: 'nowrap',
    border: on ? '1px solid rgb(var(--accent-rgb) / 0.5)' : '1px solid var(--border)',
    background: on ? 'rgb(var(--accent-rgb) / 0.18)' : 'transparent', color: on ? 'var(--accent-light)' : 'var(--text-secondary)',
  })

  return createPortal(
    <div ref={ref} data-help-id="quantize-dialog" role="dialog" aria-label="Quantize settings"
      style={{
        position: 'fixed', left: x, top: y, width: 308, zIndex: 9999,
        background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8,
        padding: '8px 10px 10px', boxShadow: '0 10px 28px rgba(0,0,0,0.6)', color: 'var(--text-secondary)', fontSize: 10,
      }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--text-primary)' }}>QUANTIZE SETTINGS</span>
        <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>{scope}</span>
      </div>

      <Row label="Grid">
        <button data-help-id="q-grid-follow" onClick={() => onChange({ grid: null })} style={chip(settings.grid == null)} title={`Follow the editor's grid (${gridLabel(editorGrid)})`}>editor</button>
        {QUANTIZE_GRIDS.map(g => (
          <button key={g.label} data-help-id={`q-grid-${g.label.replace('/', '-')}`} onClick={() => onChange({ grid: g.beats })} style={chip(settings.grid === g.beats)}>{g.label}</button>
        ))}
        <button data-help-id="q-triplet" onClick={() => onChange({ triplet: !settings.triplet })} aria-pressed={settings.triplet} style={chip(settings.triplet)} title="Triplet grid — two thirds of the note value">3</button>
      </Row>
      <Row label="Adjust">
        {(['start', 'end', 'both'] as QuantizeTarget[]).map(t => (
          <button key={t} data-help-id={`q-target-${t}`} onClick={() => onChange({ target: t })} style={chip(settings.target === t)}
            title={t === 'start' ? 'Move note starts; lengths stay' : t === 'end' ? 'Move note ends; starts stay' : 'Move both'}>
            {t === 'start' ? 'Start' : t === 'end' ? 'End' : 'Start + End'}
          </button>
        ))}
      </Row>
      <Row label="Amount">
        <Knob value={settings.amount} defaultValue={100} size={26} spec={{ label: 'Quantize amount', min: 0, max: 100, unit: '%' }}
          onChange={v => onChange({ amount: Math.round(v) })} />
        <span data-help-id="q-amount" style={{ minWidth: 34 }}>{Math.round(settings.amount)} %</span>
        <span style={{ color: 'var(--text-muted)' }}>{settings.amount < 100 ? 'part of the way — keeps some feel' : 'all the way'}</span>
      </Row>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
        <button data-help-id="q-apply" onClick={onApply} disabled={!count}
          style={{ ...chip(true), padding: '3px 10px', opacity: count ? 1 : 0.5 }}
          title="Quantize now with these settings (Q or ⌘U does the same)">
          Quantize {count ? `${count} note${count === 1 ? '' : 's'}` : ''}
        </button>
        <button onClick={onClose} style={chip(false)}>Close</button>
        <span data-help-id="q-readout" style={{ marginLeft: 'auto', color: 'var(--text-muted)', fontSize: 9 }}>{describeQuantize(settings, editorGrid)}</span>
      </div>
    </div>,
    document.body,
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 5, flexWrap: 'wrap' }}>
      <span style={{ width: 44, flexShrink: 0, color: 'var(--text-muted)' }}>{label}</span>
      {children}
    </div>
  )
}
