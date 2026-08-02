'use client'

// One section of the drawn-graph suite — header + on/off toggle + the freehand
// curve + axis captions. EVERY drawable curve area in the Sound panel renders
// through this, driven by the registry in lib/draw-graphs.ts, so a change to the
// chrome or the drawing primitive (MotionCurve) is universal across amplitude,
// pitch, LFO, volume, groove and FX motion at once.

import type { ReactNode } from 'react'
import type { AutoPoint } from '@/lib/daw-types'
import { GRAPH_AREAS, GRAPH_COLOR, type MotionAreaId } from '@/lib/draw-graphs'
import MotionCurve from './MotionCurve'

export default function DrawnGraphSection({
  area, points, onToggle, onChange, width = 276, children, emptyHint,
}: {
  area: MotionAreaId
  /** The current curve, or undefined when the area is off. */
  points: AutoPoint[] | undefined
  onToggle: (on: boolean) => void
  onChange: (pts: AutoPoint[]) => void
  width?: number
  /** Extra controls shown under the curve (e.g. the FX-motion per-note toggle + fx picker). */
  children?: ReactNode
  /** Shown in place of the curve when the area is off (e.g. FX motion's blurb). */
  emptyHint?: ReactNode
}) {
  const def = GRAPH_AREAS[area]
  const active = points != null

  return (
    <div style={{ borderTop: '1px solid var(--border)', padding: '9px 12px 6px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--text-secondary)' }}>{def.label}</span>
        {active
          ? <button onClick={() => onToggle(false)} title={def.offTitle}
              style={{ fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 4, cursor: 'pointer', border: '1px solid var(--border-light)', background: 'var(--bg-card)', color: 'var(--text-secondary)' }}>{def.offLabel}</button>
          : <button onClick={() => onToggle(true)} title={def.onTitle}
              style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 9, fontWeight: 700, padding: '2px 9px', borderRadius: 4, cursor: 'pointer', border: `1px solid ${GRAPH_COLOR}`, background: 'rgb(var(--accent-rgb) / 0.16)', color: GRAPH_COLOR }}>{def.onLabel}</button>}
      </div>
      {active ? (
        <>
          <MotionCurve points={points!} onChange={onChange} width={width} height={def.height} color={GRAPH_COLOR} />
          {def.axis.length > 0 && (
            <div style={{ display: 'flex', justifyContent: def.axis.length === 1 ? 'center' : 'space-between', fontSize: 8, color: 'var(--text-muted)', margin: '3px 2px 4px' }}>
              {def.axis.map((a, i) => <span key={i}>{a}</span>)}
            </div>
          )}
          {children}
        </>
      ) : emptyHint ? (
        <div style={{ fontSize: 9, color: 'var(--text-muted)', lineHeight: 1.45 }}>{emptyHint}</div>
      ) : null}
    </div>
  )
}
