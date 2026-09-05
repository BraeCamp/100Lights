'use client'

// The Pitch & Time panel — Live 12's Notes box, as a popover off the piano
// roll's Musical bar. Two groups: PITCH (transpose, invert, interval size +
// Add Interval) and TIME (stretch knob with ×2 / ÷2, duration chooser + Set
// Length, humanise amount + Humanise, reverse, legato). Every button acts on
// the selected notes, or the whole clip when nothing is selected, and the
// arithmetic lives in lib/pitch-time.ts so the ⌘K palette and the voice path
// do exactly the same thing.
//
// With the scale on, the pitch group works in scale degrees and says so; the
// interval field then means degrees, so "+2" builds thirds that stay in key.

import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import Knob from './Knob'
import { DURATIONS, describeInterval } from '@/lib/pitch-time'

export function PitchTimePanel({
  anchor, onClose, ignoreOutside, scope, scaleOn, scaleName,
  intervalSize, setIntervalSize, stretchFactor, setStretchFactor,
  lengthBeats, setLengthBeats, humanizeAmount, setHumanizeAmount,
  onTranspose, onInvert, onAddInterval, onStretch, onSetLength, onHumanize, onReverse, onLegato,
}: {
  anchor: { x: number; y: number }
  onClose: () => void
  ignoreOutside?: React.RefObject<HTMLElement | null>
  /** "4 selected notes" or "every note in this clip". */
  scope: string
  scaleOn: boolean
  scaleName: string
  intervalSize: number
  setIntervalSize: (n: number) => void
  stretchFactor: number
  setStretchFactor: (f: number) => void
  lengthBeats: number
  setLengthBeats: (b: number) => void
  humanizeAmount: number
  setHumanizeAmount: (pct: number) => void
  onTranspose: (steps: number) => void
  onInvert: () => void
  onAddInterval: () => void
  onStretch: (factor: number) => void
  onSetLength: () => void
  onHumanize: () => void
  onReverse: () => void
  onLegato: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (ref.current?.contains(t) || ignoreOutside?.current?.contains(t)) return
      onClose()
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', onDown, true)
    document.addEventListener('keydown', onKey, true)
    return () => { document.removeEventListener('mousedown', onDown, true); document.removeEventListener('keydown', onKey, true) }
  }, [onClose, ignoreOutside])

  const x = Math.max(8, Math.min(anchor.x, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 336))
  const y = Math.max(8, Math.min(anchor.y, (typeof window !== 'undefined' ? window.innerHeight : 800) - 300))
  const unit = scaleOn ? 'degree' : 'st'

  return createPortal(
    <div ref={ref} data-help-id="pitch-time-panel" role="dialog" aria-label="Pitch & Time"
      style={{
        position: 'fixed', left: x, top: y, width: 328, zIndex: 9999,
        background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8,
        padding: '8px 10px 10px', boxShadow: '0 10px 28px rgba(0,0,0,0.6)', color: 'var(--text-secondary)', fontSize: 10,
      }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--text-primary)' }}>PITCH & TIME</span>
        <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>{scope}{scaleOn ? ` · ${scaleName}, by degree` : ''}</span>
      </div>

      <Group title="Pitch">
        <Row label="Transpose">
          <Btn id="pt-down" onClick={() => onTranspose(-1)} title={`Down a ${unit}`}>− 1 {unit}</Btn>
          <Btn id="pt-up" onClick={() => onTranspose(1)} title={`Up a ${unit}`}>+ 1 {unit}</Btn>
          <Btn id="pt-octave-down" onClick={() => onTranspose(scaleOn ? -7 : -12)} title="Down an octave">− oct</Btn>
          <Btn id="pt-octave-up" onClick={() => onTranspose(scaleOn ? 7 : 12)} title="Up an octave">+ oct</Btn>
        </Row>
        <Row label="Invert">
          <Btn id="pt-invert" onClick={onInvert} title={`Flip the notes upside down — the highest becomes the lowest${scaleOn ? ', staying in key' : ''}`}>Invert</Btn>
        </Row>
        <Row label="Interval">
          <input data-help-id="pt-interval" type="number" min={-24} max={24} step={1} value={intervalSize}
            onChange={e => setIntervalSize(Math.max(-24, Math.min(24, Math.round(Number(e.target.value) || 0))))}
            aria-label={`Interval size in ${scaleOn ? 'scale degrees' : 'semitones'}`}
            style={{ width: 44, fontSize: 10, padding: '2px 4px', background: 'var(--bg-elevated, #1c1c1c)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 3 }} />
          <span style={{ color: 'var(--text-muted)', minWidth: 62 }}>{describeInterval(intervalSize, scaleOn)}</span>
          <Btn id="pt-add-interval" onClick={onAddInterval} title="Add a copy of every note the interval away — the copies become the selection">Add Interval</Btn>
        </Row>
      </Group>

      <Group title="Time">
        <Row label="Stretch">
          <Knob value={stretchFactor} defaultValue={1} size={26}
            spec={{ label: 'Stretch', min: 0.25, max: 4, unit: '×', curve: 'log' }}
            onChange={f => setStretchFactor(Math.round(f * 100) / 100)} />
          <Btn id="pt-stretch-apply" onClick={() => onStretch(stretchFactor)} title="Stretch positions and lengths by the knob's factor, from the first note">Apply ×{stretchFactor}</Btn>
          <Btn id="pt-x2" onClick={() => onStretch(2)} title="Twice as long — half speed">×2</Btn>
          <Btn id="pt-half" onClick={() => onStretch(0.5)} title="Half as long — double speed">÷2</Btn>
        </Row>
        <Row label="Length">
          <select data-help-id="pt-duration" value={lengthBeats} onChange={e => setLengthBeats(Number(e.target.value))} aria-label="Duration"
            style={{ fontSize: 10, padding: '2px 4px', background: 'var(--bg-elevated, #1c1c1c)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 3 }}>
            {DURATIONS.map(d => <option key={d.label} value={d.beats}>{d.label}</option>)}
          </select>
          <Btn id="pt-set-length" onClick={onSetLength} title="Make every note the chosen length">Set Length</Btn>
        </Row>
        <Row label="Humanise">
          <Knob value={humanizeAmount} defaultValue={50} size={26}
            spec={{ label: 'Humanise amount', min: 0, max: 100, unit: '%' }}
            onChange={v => setHumanizeAmount(Math.round(v))} />
          <span style={{ color: 'var(--text-muted)', minWidth: 34 }}>{humanizeAmount}%</span>
          <Btn id="pt-humanize" onClick={onHumanize} title="Move each note's start a random amount, earlier or later — up to the amount, as a share of half a grid step">Humanise</Btn>
        </Row>
        <Row label="">
          <Btn id="pt-reverse" onClick={onReverse} title="Play the notes backwards — within the selection, or the whole clip">Reverse</Btn>
          <Btn id="pt-legato" onClick={onLegato} title="Run each note into the next">Legato</Btn>
        </Row>
      </Group>
    </div>,
    document.body,
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ fontSize: 8, letterSpacing: '0.1em', color: 'var(--text-muted)', marginBottom: 3, textTransform: 'uppercase' }}>{title}</div>
      <div style={{ display: 'grid', gap: 4 }}>{children}</div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <span style={{ width: 54, flexShrink: 0, color: 'var(--text-muted)' }}>{label}</span>
      {children}
    </div>
  )
}

function Btn({ id, onClick, title, children }: { id: string; onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button data-help-id={id} onClick={onClick} title={title}
      style={{
        fontSize: 9, fontWeight: 600, padding: '2px 7px', borderRadius: 4, cursor: 'pointer', whiteSpace: 'nowrap',
        border: '1px solid var(--border)', background: 'var(--bg-elevated, #222)', color: 'var(--text-secondary)',
      }}>
      {children}
    </button>
  )
}
