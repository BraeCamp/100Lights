'use client'

import { useState, useMemo } from 'react'
import type { BeatHit } from '@/lib/beat-analyzer'

type Pattern = 'up' | 'down' | 'up-down' | 'random'
type Rate = '1/4' | '1/8' | '1/16' | '1/32'

interface ArpeggiatorProps {
  laneType: string
  laneColor: string
  existingHits: BeatHit[]
  bpm: number
  duration: number
  onClose: () => void
  onHitsChange: (hits: BeatHit[]) => void
}

const ROOT_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']

const CHORD_INTERVALS: Record<string, number[]> = {
  'major':   [0, 4, 7],
  'minor':   [0, 3, 7],
  'dim':     [0, 3, 6],
  'aug':     [0, 4, 8],
  'sus2':    [0, 2, 7],
  'sus4':    [0, 5, 7],
  'maj7':    [0, 4, 7, 11],
  'min7':    [0, 3, 7, 10],
  'dom7':    [0, 4, 7, 10],
}

function applyPattern(notes: number[], pattern: Pattern): number[] {
  if (notes.length === 0) return []
  const sorted = [...notes].sort((a, b) => a - b)
  if (pattern === 'up') return sorted
  if (pattern === 'down') return [...sorted].reverse()
  if (pattern === 'up-down') {
    if (sorted.length <= 1) return sorted
    return [...sorted, ...sorted.slice(1, -1).reverse()]
  }
  // random — shuffle
  const r = [...sorted]
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]]
  }
  return r
}

function generateArp(
  baseNotes: number[],
  pattern: Pattern,
  rate: Rate,
  octaveRange: number,
  gate: number,
  bpm: number,
  duration: number,
  laneType: string,
): BeatHit[] {
  const beatSec = 60 / bpm
  const rateSecs: Record<Rate, number> = {
    '1/4': beatSec,
    '1/8': beatSec / 2,
    '1/16': beatSec / 4,
    '1/32': beatSec / 8,
  }
  const stepSec = rateSecs[rate]
  const noteDur = stepSec * (gate / 100)

  const ordered = applyPattern(baseNotes, pattern)
  if (!ordered.length) return []

  const hits: BeatHit[] = []
  let t = 0
  let step = 0
  while (t < duration - 0.01) {
    const baseNote = ordered[step % ordered.length]
    const octaveOffset = Math.floor(step / ordered.length) % octaveRange * 12
    const note = baseNote + octaveOffset
    hits.push({
      id: crypto.randomUUID(),
      time: t,
      type: laneType as BeatHit['type'],
      velocity: 0.7 + Math.random() * 0.15, // slight velocity variation
      note,
      duration: noteDur,
    })
    t += stepSec
    step++
  }
  return hits
}

export default function Arpeggiator({ laneType, laneColor, existingHits, bpm, duration, onClose, onHitsChange }: ArpeggiatorProps) {
  const [rootNote, setRootNote] = useState(60) // middle C
  const [chordType, setChordType] = useState<string>('major')
  const [pattern, setPattern] = useState<Pattern>('up')
  const [rate, setRate] = useState<Rate>('1/16')
  const [octaveRange, setOctaveRange] = useState(2)
  const [gate, setGate] = useState(80)
  const [useExisting, setUseExisting] = useState(existingHits.length > 0)

  const baseNotes = useMemo(() => {
    if (useExisting && existingHits.length > 0) {
      return [...new Set(existingHits.map(h => h.note ?? 60))]
    }
    return CHORD_INTERVALS[chordType].map(i => rootNote + i)
  }, [useExisting, existingHits, rootNote, chordType])

  const preview = useMemo(() =>
    generateArp(baseNotes, pattern, rate, octaveRange, gate, bpm, Math.min(duration, 4), laneType),
    [baseNotes, pattern, rate, octaveRange, gate, bpm, duration, laneType]
  )

  function handleStamp() {
    const all = generateArp(baseNotes, pattern, rate, octaveRange, gate, bpm, duration, laneType)
    onHitsChange(all)
    onClose()
  }

  const chip = (label: string, active: boolean, onClick: () => void) => (
    <button key={label} onClick={onClick} style={{
      padding: '4px 10px', borderRadius: 5, border: '1px solid',
      fontSize: 11, cursor: 'pointer', fontWeight: active ? 700 : 400,
      background: active ? `${laneColor}25` : 'var(--bg-card)',
      borderColor: active ? laneColor : 'var(--border)',
      color: active ? laneColor : 'var(--text-secondary)',
    }}>{label}</button>
  )

  const minNote = Math.min(...(baseNotes.length ? baseNotes : [60]))
  const maxNote = Math.max(...(baseNotes.length ? baseNotes : [72])) + octaveRange * 12

  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 499, background: 'rgba(0,0,0,0.6)' }} onClick={onClose} />
      <div style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
        zIndex: 500, width: 560, maxHeight: '80vh', overflowY: 'auto',
        background: 'var(--bg-surface)', border: '1px solid var(--border)',
        borderRadius: 12, boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: laneColor, marginRight: 8 }} />
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', flex: 1 }}>Arpeggiator</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 18, lineHeight: 1 }}>✕</button>
        </div>

        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Source: existing hits or chord builder */}
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Notes source</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {chip('Use existing hits', useExisting, () => setUseExisting(true))}
              {chip('Build chord', !useExisting, () => setUseExisting(false))}
            </div>
          </div>

          {/* Chord builder (only when not using existing) */}
          {!useExisting && (
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 5 }}>Root note</div>
                <select value={rootNote} onChange={e => setRootNote(Number(e.target.value))}
                  style={{ padding: '4px 8px', borderRadius: 5, background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 12 }}>
                  {ROOT_NAMES.map((n, i) => (
                    <option key={n} value={60 + i}>{n}4</option>
                  ))}
                </select>
              </div>
              <div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 5 }}>Chord type</div>
                <select value={chordType} onChange={e => setChordType(e.target.value)}
                  style={{ padding: '4px 8px', borderRadius: 5, background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 12 }}>
                  {Object.keys(CHORD_INTERVALS).map(k => <option key={k} value={k}>{k}</option>)}
                </select>
              </div>
            </div>
          )}

          {/* Pattern */}
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Pattern</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {(['up', 'down', 'up-down', 'random'] as Pattern[]).map(p => chip(p, pattern === p, () => setPattern(p)))}
            </div>
          </div>

          {/* Rate */}
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Rate</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {(['1/4', '1/8', '1/16', '1/32'] as Rate[]).map(r => chip(r, rate === r, () => setRate(r)))}
            </div>
          </div>

          {/* Octave range + Gate */}
          <div style={{ display: 'flex', gap: 20 }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Octave range</span>
                <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>{octaveRange}</span>
              </div>
              <input type="range" min={1} max={4} step={1} value={octaveRange}
                onChange={e => setOctaveRange(Number(e.target.value))}
                style={{ width: '100%', accentColor: laneColor }} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Gate</span>
                <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>{gate}%</span>
              </div>
              <input type="range" min={10} max={100} step={5} value={gate}
                onChange={e => setGate(Number(e.target.value))}
                style={{ width: '100%', accentColor: laneColor }} />
            </div>
          </div>

          {/* Preview timeline */}
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
              Preview (first 4 bars · {preview.length} notes)
            </div>
            <div style={{ position: 'relative', height: 64, background: 'var(--bg-card)', borderRadius: 6, border: '1px solid var(--border)', overflow: 'hidden' }}>
              {preview.map(hit => {
                const noteRange = Math.max(maxNote - minNote, 12)
                const x = (hit.time / Math.min(duration, 4)) * 100
                const y = (1 - ((hit.note ?? 60) - minNote) / noteRange) * 90
                return (
                  <div key={hit.id} style={{
                    position: 'absolute',
                    left: `${x}%`, top: `${y}%`,
                    width: `max(2px, ${(hit.duration ?? 0.05) / Math.min(duration, 4) * 100}%)`,
                    height: 6, borderRadius: 2,
                    background: laneColor,
                    opacity: hit.velocity,
                  }} />
                )
              })}
            </div>
          </div>

          {/* Footer */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, paddingTop: 4 }}>
            <button onClick={onClose}
              style={{ padding: '8px 18px', borderRadius: 7, background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 12 }}>
              Cancel
            </button>
            <button onClick={handleStamp}
              style={{ padding: '8px 18px', borderRadius: 7, background: laneColor, border: 'none', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
              Stamp to Lane
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
