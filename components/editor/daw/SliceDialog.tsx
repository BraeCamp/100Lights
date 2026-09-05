'use client'
// Slice to New MIDI Track — the dialog (Live's: "Create one slice per",
// Batch 3.5). One slice per transient, warp marker, or grid step, and at most
// so many slices (lib/slice-to-midi.ts). Slicing itself is lib/audio-to-track.ts.

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { SLICE_GRIDS, DEFAULT_MAX_SLICES, MAX_SLICES, sliceByLabel, type SliceBy } from '@/lib/slice-to-midi'

export default function SliceDialog({ barBeats, hasMarkers, busy, onSlice, onClose }: {
  barBeats: number
  hasMarkers: boolean
  busy?: boolean
  onSlice: (by: SliceBy, max: number) => void
  onClose: () => void
}) {
  const [by, setBy] = useState<string>('transients')
  const [max, setMax] = useState(DEFAULT_MAX_SLICES)
  if (typeof document === 'undefined') return null
  const choices: Array<[string, string]> = [
    ['transients', 'Transient'],
    ...(hasMarkers ? [['markers', 'Warp Marker'] as [string, string]] : []),
    [String(barBeats), '1 Bar'],
    ...SLICE_GRIDS.map(g => [String(g), sliceByLabel(g, barBeats)] as [string, string]),
  ]
  const parse = (v: string): SliceBy => (v === 'transients' || v === 'markers' ? v : Number(v))
  const field: React.CSSProperties = { fontSize: 12, padding: '4px 6px', background: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 4 }
  return createPortal(
    <div role="dialog" aria-label="Slice to New MIDI Track" data-help-id="slice-dialog" className="electron-nodrag"
      style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.65)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }}>
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: '20px 22px', width: 360, maxWidth: '90vw', boxShadow: '0 12px 40px rgba(0,0,0,0.7)' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 10 }}>Slice to New MIDI Track</div>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 14, lineHeight: 1.5 }}>
          Every slice becomes a pad of a new drum track — chromatic from C1 — and a MIDI clip plays the pads where the slices sit. The audio clip stays.
        </p>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, fontSize: 12, color: 'var(--text-secondary)' }}>
          <span style={{ flex: 1 }}>Create one slice per</span>
          <select data-help-id="slice-by" aria-label="Create one slice per" value={by} onChange={e => setBy(e.target.value)} style={field}>
            {choices.map(([v, name]) => <option key={v} value={v}>{name}</option>)}
          </select>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18, fontSize: 12, color: 'var(--text-secondary)' }}>
          <span style={{ flex: 1 }}>At most</span>
          <input data-help-id="slice-max" aria-label="Maximum slices" type="number" min={1} max={MAX_SLICES} value={max}
            onChange={e => setMax(Math.max(1, Math.min(MAX_SLICES, Math.round(Number(e.target.value) || 1))))} style={{ ...field, width: 64 }} />
          <span>slices</span>
        </label>
        <div style={{ display: 'flex', gap: 8 }}>
          <button data-help-id="slice-go" disabled={busy} onClick={() => onSlice(parse(by), max)}
            style={{ flex: 1, padding: '7px 0', fontSize: 12, fontWeight: 600, borderRadius: 5, border: 'none', cursor: busy ? 'wait' : 'pointer', background: 'var(--accent)', color: 'var(--accent-contrast, #fff)' }}>
            {busy ? 'Slicing…' : 'Slice'}
          </button>
          <button onClick={onClose} style={{ flex: 1, padding: '7px 0', fontSize: 12, borderRadius: 5, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer' }}>Cancel</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
