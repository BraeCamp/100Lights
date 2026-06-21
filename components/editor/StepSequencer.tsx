'use client'
import { useState, useCallback, useEffect, useRef } from 'react'
import type { BeatHit, BeatType } from '@/lib/beat-analyzer'

const MELODIC_TYPES = new Set([
  'guitar-acoustic', 'guitar-electric', 'guitar-nylon',
  'piano-grand', 'piano-electric', 'piano-rhodes',
  'synth-lead', 'synth-pad', 'synth-bass', 'synth-arp',
])

const NOTE_MIN_MELODIC = 48  // C3
const NOTE_MAX_MELODIC = 71  // B4
const MELODIC_ROWS = NOTE_MAX_MELODIC - NOTE_MIN_MELODIC + 1  // 24

const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']
const BLACK_KEYS = new Set([1, 3, 6, 8, 10])

const DEFAULT_NOTE: Record<string, number> = {
  kick: 36, snare: 38, hihat: 42, 'open-hihat': 46,
  clap: 39, tom: 45, crash: 49, rim: 37,
}

function stepTimes(numSteps: number, duration: number, swing: number): number[] {
  const base = duration / numSteps
  const times: number[] = []
  let t = 0
  for (let i = 0; i < numSteps; i++) {
    times.push(t)
    const sw = i % 2 === 0 ? base * (1 + swing * 0.14) : base * (1 - swing * 0.14)
    t += sw
  }
  return times
}

type StepCell = { active: boolean; velocity: number; probability: number }  // probability: 0–1, default 1

interface StepSequencerProps {
  laneType: string
  laneColor: string
  hits: BeatHit[]
  bpm: number
  duration: number
  onClose: () => void
  onHitsChange: (hits: BeatHit[]) => void
}

export default function StepSequencer({
  laneType, laneColor, hits, bpm, duration, onClose, onHitsChange,
}: StepSequencerProps) {
  const isMelodic = MELODIC_TYPES.has(laneType)
  const numRows = isMelodic ? MELODIC_ROWS : 1

  const [numSteps, setNumSteps] = useState(16)
  const [subdivision, setSubdivision] = useState<'1/8' | '1/16'>('1/16')
  const [swing, setSwing] = useState(0)
  // grid[row][step] — row 0 = top (highest pitch for melodic)
  const [grid, setGrid] = useState<StepCell[][]>(() => initGrid(numSteps, numRows, hits, duration, isMelodic))
  const draggingVelRef = useRef<{ step: number; startY: number; startVel: number } | null>(null)
  const draggingProbRef = useRef<{ step: number; startY: number; startProb: number } | null>(null)

  function initGrid(steps: number, rows: number, srcHits: BeatHit[], dur: number, melodic: boolean): StepCell[][] {
    const times = stepTimes(steps, dur, 0)
    const stepDur = dur / steps
    const g: StepCell[][] = Array.from({ length: rows }, () =>
      Array.from({ length: steps }, () => ({ active: false, velocity: 0.75, probability: 1 }))
    )
    for (const h of srcHits) {
      const closest = times.reduce((best, t, i) => Math.abs(h.time - t) < Math.abs(h.time - times[best]) ? i : best, 0)
      if (Math.abs(h.time - times[closest]) > stepDur * 0.6) continue
      if (melodic) {
        const row = NOTE_MAX_MELODIC - h.note
        if (row >= 0 && row < rows) g[row][closest] = { active: true, velocity: h.velocity, probability: 1 }
      } else {
        g[0][closest] = { active: true, velocity: h.velocity, probability: 1 }
      }
    }
    return g
  }

  const emitHits = useCallback((g: StepCell[][], steps: number, sw: number) => {
    const times = stepTimes(steps, duration, sw)
    const newHits: BeatHit[] = []
    for (let row = 0; row < numRows; row++) {
      for (let step = 0; step < steps; step++) {
        const cell = g[row]?.[step]
        if (!cell?.active) continue
        const note = isMelodic ? NOTE_MAX_MELODIC - row : (DEFAULT_NOTE[laneType] ?? 60)
        newHits.push({
          id: crypto.randomUUID(),
          time: times[step],
          type: laneType as BeatType,
          // probability < 1: velocity is scaled; playback engine filters by Math.random() < cell.probability
          velocity: cell.probability < 1 ? cell.velocity * cell.probability : cell.velocity,
          note,
        })
      }
    }
    onHitsChange(newHits.sort((a, b) => a.time - b.time))
  }, [duration, numRows, isMelodic, laneType, onHitsChange])

  function toggleCell(row: number, step: number) {
    setGrid(prev => {
      const next = prev.map(r => r.map(c => ({ ...c })))
      const wasActive = next[row][step].active
      next[row][step] = {
        active: !wasActive,
        velocity: next[row][step].velocity || 0.75,
        probability: wasActive ? next[row][step].probability : 1,
      }
      emitHits(next, numSteps, swing)
      return next
    })
  }

  function changeSteps(n: number) {
    const newGrid = initGrid(n, numRows, hits, duration, isMelodic)
    setNumSteps(n)
    setGrid(newGrid)
    emitHits(newGrid, n, swing)
  }

  function changeSwing(s: number) {
    setSwing(s)
    emitHits(grid, numSteps, s)
  }

  function startVelDrag(step: number, e: React.MouseEvent) {
    e.preventDefault()
    const startY = e.clientY
    const startVel = velocityForStep(step)
    draggingVelRef.current = { step, startY, startVel }
    const move = (me: MouseEvent) => {
      if (!draggingVelRef.current) return
      const dy = draggingVelRef.current.startY - me.clientY
      const newVel = Math.max(0.05, Math.min(1, draggingVelRef.current.startVel + dy / 80))
      setGrid(prev => {
        const next = prev.map(r => r.map(c => ({ ...c })))
        for (let row = 0; row < numRows; row++) {
          if (next[row][step]?.active) next[row][step].velocity = newVel
        }
        emitHits(next, numSteps, swing)
        return next
      })
    }
    const up = () => {
      draggingVelRef.current = null
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  function startProbDrag(step: number, e: React.MouseEvent) {
    e.preventDefault()
    const startY = e.clientY
    const startProb = probabilityForStep(step)
    let moved = false
    draggingProbRef.current = { step, startY, startProb }
    const move = (me: MouseEvent) => {
      if (!draggingProbRef.current) return
      const dy = draggingProbRef.current.startY - me.clientY
      if (Math.abs(dy) < 3 && !moved) return
      moved = true
      const newProb = Math.max(0, Math.min(1, draggingProbRef.current.startProb + dy / 80))
      setGrid(prev => {
        const next = prev.map(r => r.map(c => ({ ...c })))
        for (let row = 0; row < numRows; row++) {
          if (next[row]?.[step]) next[row][step].probability = newProb
        }
        emitHits(next, numSteps, swing)
        return next
      })
    }
    const up = () => {
      if (!moved) cycleProbability(step)
      draggingProbRef.current = null
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  function velocityForStep(step: number): number {
    for (let row = 0; row < numRows; row++) {
      if (grid[row]?.[step]?.active) return grid[row][step].velocity
    }
    return 0.75
  }

  function probabilityForStep(step: number): number {
    for (let row = 0; row < numRows; row++) {
      if (grid[row]?.[step]?.active) return grid[row][step].probability
    }
    return 1
  }

  function cycleProbability(step: number) {
    setGrid(prev => {
      const next = prev.map(r => r.map(c => ({ ...c })))
      let currentProb = 1
      for (let row = 0; row < numRows; row++) {
        if (prev[row]?.[step]?.active) { currentProb = prev[row][step].probability; break }
      }
      const presets = [1, 0.75, 0.5, 0.25]
      const idx = presets.findIndex(p => Math.abs(p - currentProb) < 0.01)
      const nextPreset = idx >= 0 ? presets[(idx + 1) % presets.length] : 1
      for (let row = 0; row < numRows; row++) {
        if (next[row]?.[step]) next[row][step].probability = nextPreset
      }
      emitHits(next, numSteps, swing)
      return next
    })
  }

  function hasActiveInStep(step: number): boolean {
    return grid.some(r => r[step]?.active)
  }

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const CELL_W = Math.max(28, Math.min(52, Math.floor(680 / numSteps)))
  const CELL_H = isMelodic ? 18 : 48
  const VEL_H = 80

  const hexR = parseInt(laneColor.slice(1, 3), 16)
  const hexG = parseInt(laneColor.slice(3, 5), 16)
  const hexB = parseInt(laneColor.slice(5, 7), 16)
  const colorFull = `rgba(${hexR},${hexG},${hexB},0.88)`
  const colorDim  = `rgba(${hexR},${hexG},${hexB},0.22)`

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 500,
      background: 'rgba(10,10,14,0.94)',
      display: 'flex', flexDirection: 'column',
      fontFamily: "'JetBrains Mono','Fira Mono',monospace",
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px',
        borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)', flexShrink: 0,
      }}>
        <div style={{ width: 10, height: 10, borderRadius: '50%', background: laneColor, flexShrink: 0 }} />
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', marginRight: 6 }}>Step Sequencer</span>
        <span style={{ fontSize: 10, color: 'var(--text-muted)', marginRight: 10 }}>{laneType}</span>

        {/* Pattern length */}
        <div style={{ display: 'flex', gap: 2, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 5, overflow: 'hidden' }}>
          {([8, 16, 32] as const).map(n => (
            <button key={n} onClick={() => changeSteps(n)} style={{
              padding: '3px 9px', border: 'none', cursor: 'pointer', fontSize: 10, fontWeight: 700,
              background: numSteps === n ? colorDim : 'none',
              color: numSteps === n ? laneColor : 'var(--text-muted)',
            }}>{n}</button>
          ))}
        </div>

        {/* Subdivision */}
        <div style={{ display: 'flex', gap: 2, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 5, overflow: 'hidden' }}>
          {(['1/8', '1/16'] as const).map(s => (
            <button key={s} onClick={() => setSubdivision(s)} style={{
              padding: '3px 8px', border: 'none', cursor: 'pointer', fontSize: 10,
              background: subdivision === s ? colorDim : 'none',
              color: subdivision === s ? laneColor : 'var(--text-muted)',
            }}>{s}</button>
          ))}
        </div>

        {/* Swing */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>Swing</span>
          <input type="range" min={0} max={1} step={0.01} value={swing}
            onChange={e => changeSwing(Number(e.target.value))}
            style={{ width: 70, accentColor: laneColor, cursor: 'pointer' }}
          />
          <span style={{ fontSize: 9, color: 'var(--text-muted)', minWidth: 28 }}>{Math.round(swing * 100)}%</span>
        </div>

        <div style={{ flex: 1 }} />
        <button onClick={onClose} style={{
          background: 'none', border: 'none', color: 'var(--text-muted)',
          cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: '0 4px',
        }}>✕</button>
      </div>

      {/* Grid area */}
      <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', minWidth: 'max-content' }}>
          {/* Row labels (sticky left) */}
          <div style={{ position: 'sticky', left: 0, zIndex: 2, flexShrink: 0, background: 'var(--bg-surface)', borderRight: '1px solid var(--border)' }}>
            {/* Step number header spacer */}
            <div style={{ height: 22 }} />
            {isMelodic ? (
              Array.from({ length: MELODIC_ROWS }, (_, rowIdx) => {
                const midiNote = NOTE_MAX_MELODIC - rowIdx
                const semitone = midiNote % 12
                const octave = Math.floor(midiNote / 12) - 1
                const isBlack = BLACK_KEYS.has(semitone)
                const isC = semitone === 0
                return (
                  <div key={rowIdx} style={{
                    width: 52, height: CELL_H,
                    display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
                    paddingRight: 6, gap: 3,
                    background: isBlack ? '#1a1a2a' : 'rgba(255,255,255,0.04)',
                    borderBottom: '1px solid var(--border)',
                    borderLeft: isBlack ? '3px solid #0a0a14' : '3px solid transparent',
                  }}>
                    {isC && (
                      <span style={{ fontSize: 8, color: 'var(--text-muted)', fontWeight: 700 }}>
                        {NOTE_NAMES[semitone]}{octave}
                      </span>
                    )}
                    <div style={{
                      width: 8, height: CELL_H - 4,
                      borderRadius: 2,
                      background: isBlack ? '#222' : 'rgba(255,255,255,0.75)',
                    }} />
                  </div>
                )
              })
            ) : (
              <div style={{
                width: 52, height: CELL_H,
                display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
                paddingRight: 8, borderBottom: '1px solid var(--border)',
              }}>
                <span style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 600 }}>{laneType}</span>
              </div>
            )}
          </div>

          {/* Columns */}
          <div style={{ display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
            {/* Step number header */}
            <div style={{ display: 'flex', height: 22 }}>
              {Array.from({ length: numSteps }, (_, step) => (
                <div key={step} style={{
                  width: CELL_W, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 9, color: step % 4 === 0 ? laneColor : 'var(--text-muted)',
                  fontWeight: step % 4 === 0 ? 700 : 400,
                  borderRight: '1px solid var(--border)',
                  background: step % 4 === 0 ? `rgba(${hexR},${hexG},${hexB},0.06)` : 'transparent',
                }}>
                  {step % 4 === 0 ? step / 4 + 1 : '·'}
                </div>
              ))}
            </div>

            {/* Grid rows */}
            {Array.from({ length: numRows }, (_, rowIdx) => {
              const midiNote = isMelodic ? NOTE_MAX_MELODIC - rowIdx : 0
              const semitone = midiNote % 12
              const isBlack = isMelodic && BLACK_KEYS.has(semitone)
              return (
                <div key={rowIdx} style={{ display: 'flex' }}>
                  {Array.from({ length: numSteps }, (_, step) => {
                    const cell = grid[rowIdx]?.[step]
                    const active = cell?.active ?? false
                    const isBeat = step % 4 === 0
                    return (
                      <div
                        key={step}
                        onClick={() => toggleCell(rowIdx, step)}
                        style={{
                          width: CELL_W, height: CELL_H,
                          border: '1px solid var(--border)',
                          borderRadius: 3,
                          cursor: 'pointer',
                          background: active
                            ? colorFull
                            : isBlack
                            ? 'rgba(255,255,255,0.018)'
                            : isBeat
                            ? `rgba(${hexR},${hexG},${hexB},0.04)`
                            : 'var(--bg-card)',
                          transition: 'background 0.08s',
                          position: 'relative',
                          boxSizing: 'border-box',
                        }}
                      >
                        {active && !isMelodic && (
                          // Velocity fill indicator inside drum cell
                          <div style={{
                            position: 'absolute', bottom: 0, left: 0, right: 0,
                            height: `${(cell?.velocity ?? 0.75) * 100}%`,
                            background: 'rgba(255,255,255,0.18)',
                            borderRadius: '0 0 2px 2px',
                            pointerEvents: 'none',
                          }} />
                        )}
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </div>

        {/* Velocity row */}
        <div style={{
          display: 'flex', flexShrink: 0,
          borderTop: '2px solid var(--border)',
          background: 'var(--bg-surface)',
        }}>
          {/* Velocity label (aligns with sticky labels above) */}
          <div style={{
            position: 'sticky', left: 0, zIndex: 2,
            width: 52, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
            paddingRight: 6, fontSize: 8, color: 'var(--text-muted)', fontWeight: 700,
            letterSpacing: '0.07em', textTransform: 'uppercase',
            background: 'var(--bg-surface)', borderRight: '1px solid var(--border)',
            height: VEL_H,
          }}>
            Vel
          </div>
          {/* Bars */}
          <div style={{ display: 'flex', alignItems: 'flex-end', height: VEL_H, padding: '4px 0' }}>
            {Array.from({ length: numSteps }, (_, step) => {
              const hasActive = hasActiveInStep(step)
              const vel = velocityForStep(step)
              return (
                <div
                  key={step}
                  onMouseDown={hasActive ? e => startVelDrag(step, e) : undefined}
                  title={hasActive ? `Velocity: ${Math.round(vel * 100)}%` : undefined}
                  style={{
                    width: CELL_W, height: VEL_H - 8,
                    display: 'flex', alignItems: 'flex-end',
                    borderRight: '1px solid var(--border)',
                    cursor: hasActive ? 'ns-resize' : 'default',
                    padding: '0 2px',
                  }}
                >
                  {hasActive && (
                    <div style={{
                      width: '100%',
                      height: `${vel * 100}%`,
                      background: colorDim,
                      borderRadius: '2px 2px 0 0',
                      borderTop: `2px solid ${laneColor}`,
                      minHeight: 3,
                    }} />
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Probability strip */}
        <div style={{
          display: 'flex', flexShrink: 0,
          borderTop: '2px solid var(--border)',
          background: 'var(--bg-surface)',
        }}>
          {/* P% label (aligns with sticky labels above) */}
          <div style={{
            position: 'sticky', left: 0, zIndex: 2,
            width: 52, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
            paddingRight: 6, fontSize: 8, color: 'var(--text-muted)', fontWeight: 700,
            letterSpacing: '0.07em', textTransform: 'uppercase',
            background: 'var(--bg-surface)', borderRight: '1px solid var(--border)',
            height: 28,
          }}>
            P%
          </div>
          {/* Probability cells */}
          <div style={{ display: 'flex', height: 28 }}>
            {Array.from({ length: numSteps }, (_, step) => {
              const hasActive = hasActiveInStep(step)
              const prob = probabilityForStep(step)
              const isBelow = hasActive && prob < 1
              return (
                <div
                  key={step}
                  onMouseDown={hasActive ? e => startProbDrag(step, e) : undefined}
                  title={hasActive ? `Probability: ${Math.round(prob * 100)}%` : undefined}
                  style={{
                    width: CELL_W, height: 28,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    borderRight: '1px solid var(--border)',
                    cursor: hasActive ? 'pointer' : 'default',
                    background: isBelow ? 'rgba(251,191,36,0.15)' : 'var(--bg-card)',
                    outline: isBelow ? '1px solid rgba(251,191,36,0.4)' : undefined,
                    outlineOffset: '-1px',
                    boxSizing: 'border-box',
                    fontSize: 9, fontWeight: 700,
                    color: isBelow ? 'rgb(251,191,36)' : 'var(--text-muted)',
                    userSelect: 'none',
                  }}
                >
                  {isBelow ? Math.round(prob * 100) : null}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
