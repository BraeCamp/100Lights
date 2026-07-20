'use client'

/**
 * A playable step sequencer inside an article.
 *
 * The beat guide currently *describes* putting a kick on 1-2-3-4 and hats on
 * the offbeats. This lets the reader click it in and hear it, which is the
 * difference between an article about the product and a small piece of the
 * product. It is also the thing worth linking to — text about drum patterns
 * is a commodity; a drum machine in the page is not.
 *
 * Voices are synthesized rather than sampled, so the whole widget is a few KB
 * with nothing to download.
 */

import React, { useEffect, useRef, useState } from 'react'

export interface GridSpec {
  /** Rows top to bottom. */
  lanes: Array<{ name: string; sound: 'kick' | 'snare' | 'hat' | 'clap' }>
  steps: number
  bpm: number
  /** Preset pattern: lane index → step indices that start on. */
  pattern: number[][]
  caption?: string
}

const LANE_COLOR: Record<string, string> = {
  kick: '#f472b6', snare: '#38bdf8', hat: '#34d399', clap: '#fbbf24',
}

/** Expand the preset pattern into a lane × step boolean grid. */
function initialGrid(spec: GridSpec): boolean[][] {
  const grid: boolean[][] = []
  for (let li = 0; li < spec.lanes.length; li++) {
    const hits = new Set(spec.pattern[li] ?? [])
    const row: boolean[] = []
    for (let si = 0; si < spec.steps; si++) row.push(hits.has(si))
    grid.push(row)
  }
  return grid
}

function emptyGrid(spec: GridSpec): boolean[][] {
  return spec.lanes.map(() => new Array<boolean>(spec.steps).fill(false))
}

export default function ArticleGrid({ spec }: { spec: GridSpec }) {
  const [on, setOn] = useState<boolean[][]>(() => initialGrid(spec))
  const [playing, setPlaying] = useState(false)
  const [step, setStep] = useState(-1)

  const ctxRef = useRef<AudioContext | null>(null)
  const timerRef = useRef<number | null>(null)
  const nextTimeRef = useRef(0)
  const stepRef = useRef(0)
  // The scheduler reads the grid through a ref so editing a cell mid-playback
  // takes effect without tearing down and re-arming the interval.
  const onRef = useRef(on)
  useEffect(() => { onRef.current = on }, [on])

  // AudioContext is created on first play, never on mount — an article with
  // three of these shouldn't open three audio devices just by being scrolled
  // past. Only ever called from event handlers, never during render.
  function ctx(): AudioContext {
    if (!ctxRef.current) ctxRef.current = new AudioContext()
    return ctxRef.current
  }

  function voice(kind: string, t: number) {
    const c = ctx()
    const g = c.createGain()
    g.connect(c.destination)
    if (kind === 'kick') {
      const o = c.createOscillator()
      o.frequency.setValueAtTime(130, t)
      o.frequency.exponentialRampToValueAtTime(45, t + 0.11)
      g.gain.setValueAtTime(0.9, t)
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.3)
      o.connect(g); o.start(t); o.stop(t + 0.3)
      return
    }
    // Everything else is filtered noise with a different colour and decay.
    const len = kind === 'hat' ? 0.05 : 0.2
    const buf = c.createBuffer(1, Math.ceil(c.sampleRate * len), c.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
    const src = c.createBufferSource()
    src.buffer = buf
    const f = c.createBiquadFilter()
    f.type = kind === 'hat' ? 'highpass' : 'bandpass'
    f.frequency.value = kind === 'hat' ? 8000 : kind === 'clap' ? 1500 : 1900
    g.gain.setValueAtTime(kind === 'hat' ? 0.32 : 0.6, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + len)
    src.connect(f); f.connect(g); src.start(t); src.stop(t + len)
  }

  function stop() {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    setPlaying(false); setStep(-1)
  }

  function start() {
    const c = ctx()
    void c.resume()
    stepRef.current = 0
    nextTimeRef.current = c.currentTime + 0.06
    const stepDur = 60 / spec.bpm / 4      // sixteenths
    setPlaying(true)
    // Lookahead scheduler: schedule ahead on the audio clock, draw on the UI
    // clock. A setInterval that triggered notes directly would audibly drift.
    timerRef.current = window.setInterval(() => {
      const now = c.currentTime
      while (nextTimeRef.current < now + 0.12) {
        const s = stepRef.current % spec.steps
        spec.lanes.forEach((lane, li) => {
          if (onRef.current[li]?.[s]) voice(lane.sound, nextTimeRef.current)
        })
        const drawAt = nextTimeRef.current
        window.setTimeout(() => setStep(s), Math.max(0, (drawAt - c.currentTime) * 1000))
        nextTimeRef.current += stepDur
        stepRef.current++
      }
    }, 25)
  }

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current)
    void ctxRef.current?.close()
  }, [])

  function toggle(li: number, si: number) {
    setOn(prev => prev.map((row, i) => i === li ? row.map((v, j) => j === si ? !v : v) : row))
  }

  return (
    <figure style={{ margin: '24px 0' }}>
      <div style={{ border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px', background: 'rgba(255,255,255,0.02)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <button
            onClick={() => playing ? stop() : start()}
            style={{
              width: 36, height: 36, borderRadius: 18, border: 'none', background: '#7c3aed',
              color: '#fff', cursor: 'pointer', fontSize: 13, paddingLeft: playing ? 0 : 3,
            }}
            aria-label={playing ? 'Stop' : 'Play'}
          >{playing ? '❚❚' : '▶'}</button>
          <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{spec.bpm} BPM · click any square</span>
          <button
            onClick={() => setOn(emptyGrid(spec))}
            style={{ marginLeft: 'auto', fontSize: 10.5, background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 10px', color: 'var(--text-muted)', cursor: 'pointer' }}
          >Clear</button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, overflowX: 'auto' }}>
          {spec.lanes.map((lane, li) => (
            <div key={lane.name} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 44, flexShrink: 0, fontSize: 10, color: 'var(--text-muted)', textAlign: 'right' }}>{lane.name}</span>
              <div style={{ display: 'flex', gap: 3 }}>
                {Array.from({ length: spec.steps }, (_, si) => {
                  const active = on[li][si]
                  const isBeat = si % 4 === 0
                  return (
                    <button
                      key={si}
                      onClick={() => toggle(li, si)}
                      aria-label={`${lane.name} step ${si + 1}`}
                      aria-pressed={active}
                      style={{
                        width: 22, height: 22, flexShrink: 0, borderRadius: 4, cursor: 'pointer',
                        border: step === si ? '1px solid rgba(255,255,255,0.85)' : '1px solid transparent',
                        background: active ? LANE_COLOR[lane.sound] : isBeat ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.045)',
                        transition: 'background 90ms',
                      }}
                    />
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
      {spec.caption && (
        <figcaption style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.6 }}>{spec.caption}</figcaption>
      )}
    </figure>
  )
}
