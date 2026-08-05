'use client'

// The one full-screen drawing modal every graph opens into — the drawn-graph
// areas (amplitude/pitch/LFO/volume/groove/FX-motion), the per-slider FX curves,
// and the track EQ. Clicking a setting's NAME opens this; the curve never sits
// inline in the Sound panel anymore, so the panel stays short.
//
// Body: by default a big MotionCurve driven by `points`/`onChange`; pass
// `children` to supply a different editor (e.g. the EQ curve). `extra` renders
// under the curve (e.g. FX-motion's per-note toggle + effect picker).

import { createPortal } from 'react-dom'
import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import type { AutoPoint } from '@/lib/daw-types'
import MotionCurve from './MotionCurve'
import { GRAPH_COLOR } from '@/lib/draw-graphs'

const ACCENT = 'var(--accent-light)'
const CURVE_W = 528

export default function DrawnGraphModal({
  title, subtitle, axis, points, onChange, onClose, onReset, onOff, offLabel = 'Remove',
  children, extra, curveHeight = 240,
}: {
  title: string
  subtitle?: string
  axis?: string[]
  points?: AutoPoint[]
  onChange?: (pts: AutoPoint[]) => void
  onClose: () => void
  onReset?: () => void
  onOff?: () => void
  offLabel?: string
  children?: ReactNode      // custom editor body instead of the MotionCurve (e.g. EQ)
  extra?: ReactNode         // extra controls under the curve (FX-motion per-note + fx picker)
  curveHeight?: number
}) {
  if (typeof document === 'undefined') return null
  const ghost: React.CSSProperties = {
    fontSize: 11.5, fontWeight: 700, padding: '6px 13px', borderRadius: 7, cursor: 'pointer',
    border: '1px solid var(--border-light)', background: 'var(--bg-card)', color: 'var(--text-secondary)',
  }
  return createPortal(
    <div
      data-editor="true" data-sound-overlay="true" role="dialog" aria-modal="true" aria-label={title}
      onClick={onClose}
      onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }}
      style={{ position: 'fixed', inset: 0, zIndex: 10050, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(4px)' }}
    >
      <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 560, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 14, boxShadow: '0 30px 80px rgba(0,0,0,0.6)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, padding: '14px 16px 11px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: '0.04em', color: 'var(--text-primary)' }}>{title}</div>
            {subtitle && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.4 }}>{subtitle}</div>}
          </div>
          <button onClick={onClose} aria-label="Close" style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26, borderRadius: 6, cursor: 'pointer', border: '1px solid var(--border-light)', background: 'var(--bg-card)', color: 'var(--text-secondary)' }}><X size={14} /></button>
        </div>

        <div style={{ padding: '16px 16px 8px' }}>
          {children ?? (points && onChange && (
            <>
              <MotionCurve points={points} onChange={onChange} width={CURVE_W} height={curveHeight} color={GRAPH_COLOR} />
              {axis && axis.length > 0 && (
                <div style={{ display: 'flex', justifyContent: axis.length === 1 ? 'center' : 'space-between', fontSize: 10, color: 'var(--text-muted)', margin: '7px 2px 0' }}>
                  {axis.map((a, i) => <span key={i}>{a}</span>)}
                </div>
              )}
            </>
          ))}
          {extra}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '11px 16px 14px', borderTop: '1px solid var(--border)' }}>
          {onOff && (
            <button onClick={onOff} style={{ ...ghost, color: '#ef4444', borderColor: 'rgba(239,68,68,0.4)' }}>{offLabel}</button>
          )}
          <span style={{ flex: 1 }} />
          {onReset && <button onClick={onReset} style={ghost}>Reset</button>}
          <button onClick={onClose} style={{ ...ghost, border: `1px solid ${ACCENT}`, background: 'rgb(var(--accent-rgb) / 0.16)', color: ACCENT }}>Done</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
