'use client'

// Touch-first transport. The bar shows only the essentials — play, position,
// tempo, metronome, loop. Everything advanced (tap tempo, time signature, swing,
// key + scale) lives in a Settings sheet behind the gear, so it never overwhelms.

import { useEffect, useRef, useState } from 'react'
import { Repeat, Music2, Zap } from 'lucide-react'
import { useDaw } from '@/lib/daw-state'
import type { DawEngine } from '@/lib/daw-engine'

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const SCALES: { id: string; label: string }[] = [
  { id: 'major', label: 'Major' }, { id: 'minor', label: 'Minor' },
  { id: 'penta-maj', label: 'Penta+' }, { id: 'penta-min', label: 'Penta−' },
  { id: 'dorian', label: 'Dorian' }, { id: 'chromatic', label: 'Chromatic' },
]

// A stepper that repeats (and accelerates) while held — fast BPM/value nudging.
function HoldButton({ onStep, style, children, 'aria-label': ariaLabel, title }: { onStep: () => void; style: React.CSSProperties; children: React.ReactNode; 'aria-label'?: string; title?: string }) {
  const timer = useRef<number | undefined>(undefined)
  const stop = () => { if (timer.current) { window.clearTimeout(timer.current); timer.current = undefined } }
  const start = () => {
    onStep()
    let delay = 340
    const tick = () => { onStep(); delay = Math.max(40, delay * 0.8); timer.current = window.setTimeout(tick, delay) }
    timer.current = window.setTimeout(tick, delay)
  }
  useEffect(() => stop, [])
  return (
    <button onPointerDown={e => { e.preventDefault(); start() }} onPointerUp={stop} onPointerLeave={stop} onPointerCancel={stop}
      style={{ ...style, touchAction: 'none' }} aria-label={ariaLabel} title={title}>{children}</button>
  )
}

// Momentary FX pad: hold to apply a master effect, release to reset.
function FxPad({ label, mode, engine, color }: { label: string; mode: 'lp' | 'hp' | 'duck'; engine: DawEngine; color: string }) {
  const [on, setOn] = useState(false)
  const down = () => { setOn(true); engine.perfFX(mode) }
  const up = () => { setOn(false); engine.perfFX('off') }
  return (
    <button onPointerDown={e => { e.preventDefault(); down() }} onPointerUp={up} onPointerLeave={up} onPointerCancel={up}
      style={{ flex: 1, padding: '12px 0', borderRadius: 10, border: `1px solid ${on ? color : 'var(--border)'}`, background: on ? `${color}30` : 'var(--bg-card)', color: on ? color : 'var(--text-secondary)', fontSize: 11.5, fontWeight: 800, letterSpacing: '0.03em', cursor: 'pointer', touchAction: 'none' }}>
      {label}
    </button>
  )
}

// Full-width playhead scrubber. Represents the whole song (0 → end); dragging
// the thumb seeks the transport. This is the ONLY way the playhead moves on
// mobile now, so a one-finger drag on the timeline can pan/scroll freely.
function ScrubBar({ engine, position, setPosition, end, sig }: {
  engine: DawEngine; position: number; setPosition: (b: number) => void; end: number; sig: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const seek = (clientX: number) => {
    const el = ref.current; if (!el || end <= 0) return
    const r = el.getBoundingClientRect()
    const frac = Math.max(0, Math.min(1, (clientX - r.left) / r.width))
    const beat = frac * end
    engine.seek(beat); setPosition(beat)
  }
  const frac = end > 0 ? Math.max(0, Math.min(1, position / end)) : 0
  const bars = Math.max(1, Math.round(end / sig))
  const tickEvery = bars > 24 ? 8 : bars > 12 ? 4 : bars > 6 ? 2 : 1
  return (
    <div
      onPointerDown={e => { dragging.current = true; try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* ok */ } seek(e.clientX) }}
      onPointerMove={e => { if (dragging.current) seek(e.clientX) }}
      onPointerUp={e => { dragging.current = false; try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* ok */ } }}
      onPointerCancel={() => { dragging.current = false }}
      aria-label="Playhead position — drag to scrub"
      style={{ position: 'relative', display: 'flex', alignItems: 'center', height: 30, padding: '0 14px', touchAction: 'none', cursor: 'pointer' }}
    >
      <div ref={ref} style={{ position: 'relative', width: '100%', height: 6, borderRadius: 3, background: 'var(--bg-card)' }}>
        {/* bar ticks for orientation */}
        {Array.from({ length: bars + 1 }, (_, b) => b).filter(b => b % tickEvery === 0).map(b => (
          <div key={b} style={{ position: 'absolute', left: `${(b / bars) * 100}%`, top: -2, bottom: -2, width: 1, background: 'var(--border)', pointerEvents: 'none' }} />
        ))}
        <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${frac * 100}%`, background: 'var(--accent)', borderRadius: 3, pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', left: `${frac * 100}%`, top: '50%', width: 16, height: 16, marginLeft: -8, marginTop: -8, borderRadius: '50%', background: '#fff', border: '2px solid var(--accent)', boxShadow: '0 1px 4px rgba(0,0,0,0.45)', pointerEvents: 'none' }} />
      </div>
    </div>
  )
}

export function MobileTransport() {
  const { engine, playing, position, project, dispatch, metronome, setMetronome, setPosition, undo, redo, canUndo, canRedo } = useDaw()
  const [settings, setSettings] = useState(false)
  const [fxOpen, setFxOpen] = useState(false)
  const taps = useRef<number[]>([])
  // Undo button: tap = undo, long-press = redo (GarageBand pattern).
  const undoHold = useRef<{ timer?: number; long: boolean }>({ long: false })

  // Landscape phones are short — shrink the transport so tracks get the height.
  const [landscape, setLandscape] = useState(false)
  useEffect(() => {
    const c = () => setLandscape(window.innerHeight < 500 && window.innerWidth > window.innerHeight)
    c(); window.addEventListener('resize', c); return () => window.removeEventListener('resize', c)
  }, [])
  const play = landscape ? 34 : 44

  const sig = project.timeSignatureNum || 4
  const bar = Math.floor(position / sig) + 1
  const beat = Math.floor(position % sig) + 1
  // Song length for the scrub bar — last clip end, at least a few bars, + a
  // bar of run-off so the playhead can sit just past the end.
  const songEnd = Math.max(sig * 4, ...project.arrangementClips.map(c => c.startBeat + c.durationBeats)) + sig

  const toggleLoop = () => {
    if (!project.loopEnabled) {
      const end = Math.max(sig, ...project.arrangementClips.map(c => c.startBeat + c.durationBeats))
      dispatch({ type: 'SET_LOOP', start: 0, end })
    }
    dispatch({ type: 'SET_LOOP_ENABLED', enabled: !project.loopEnabled })
  }

  const tap = () => {
    const now = (typeof performance !== 'undefined' ? performance.now() : 0)
    const arr = taps.current.filter(t => now - t < 2000)
    arr.push(now)
    taps.current = arr
    if (arr.length >= 2) {
      const gaps = arr.slice(1).map((t, i) => t - arr[i])
      const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length
      if (avg > 0) dispatch({ type: 'SET_TEMPO', tempo: Math.round(60000 / avg) })
    }
  }

  return (
    <div style={{ flexShrink: 0, borderTop: '1px solid var(--border)', background: 'var(--bg-surface)' }}>
      {/* Playhead scrub bar — drag to move the playhead through the song. Lives
          here (under the +Track button, above the tabs) so scrolling the
          timeline never moves the playhead by accident. */}
      <ScrubBar engine={engine} position={position} setPosition={setPosition} end={songEnd} sig={sig} />
      {fxOpen && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
          <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.08em', color: 'var(--text-muted)', flexShrink: 0 }}>HOLD FX</span>
          <FxPad label="LOW-PASS" mode="lp" engine={engine} color="#8b5cf6" />
          <FxPad label="HIGH-PASS" mode="hp" engine={engine} color="#3b82f6" />
          <FxPad label="DUCK" mode="duck" engine={engine} color="#f59e0b" />
          <button onClick={() => setFxOpen(false)} aria-label="Close FX" style={{ ...tBtn, width: 30 }}>×</button>
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: landscape ? 6 : 8, padding: landscape ? '3px 10px' : '9px 12px' }}>
        <button onClick={() => (engine.isPlaying ? engine.stop() : void engine.play())} aria-label={playing ? 'Stop' : 'Play'} style={{ width: landscape ? 58 : play, height: play, borderRadius: play / 2, border: 'none', flexShrink: 0, cursor: 'pointer', background: playing ? '#ef4444' : 'var(--accent)', color: '#fff', fontSize: landscape ? 15 : 18 }}>{playing ? '■' : '▶'}</button>
        <div style={{ textAlign: 'center', minWidth: 46 }}>
          <div style={{ fontSize: 17, fontWeight: 800, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{bar}:{beat}</div>
          <div style={{ fontSize: 8, color: 'var(--text-muted)', letterSpacing: 0.4 }}>BAR</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginLeft: 'auto' }}>
          <HoldButton onStep={() => dispatch({ type: 'SET_TEMPO', tempo: project.tempo - 1 })} style={tBtn} aria-label="Slower">−</HoldButton>
          <div style={{ textAlign: 'center', minWidth: 42 }}><div style={{ fontSize: 16, fontWeight: 800, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{Math.round(project.tempo)}</div><div style={{ fontSize: 8, color: 'var(--text-muted)' }}>BPM</div></div>
          <HoldButton onStep={() => dispatch({ type: 'SET_TEMPO', tempo: project.tempo + 1 })} style={tBtn} aria-label="Faster">+</HoldButton>
        </div>
        <button onClick={() => setMetronome(!metronome)} aria-pressed={metronome} title="Metronome" style={{ ...tBtn, width: 34, color: metronome ? 'var(--accent-light)' : 'var(--text-muted)', borderColor: metronome ? 'var(--accent)' : 'var(--border)', background: metronome ? 'rgba(139,92,246,0.14)' : 'var(--bg-card)' }}><Music2 size={15} /></button>
        <button onClick={toggleLoop} aria-pressed={project.loopEnabled} title="Loop the whole project" style={{ ...tBtn, width: 34, color: project.loopEnabled ? 'var(--accent-light)' : 'var(--text-muted)', borderColor: project.loopEnabled ? 'var(--accent)' : 'var(--border)', background: project.loopEnabled ? 'rgba(139,92,246,0.14)' : 'var(--bg-card)' }}><Repeat size={15} /></button>
        <button onClick={() => setFxOpen(o => !o)} aria-pressed={fxOpen} aria-label="Performance FX" title="Hold-to-play FX" style={{ ...tBtn, width: 34, fontSize: 15, color: fxOpen ? 'var(--accent-light)' : 'var(--text-muted)', borderColor: fxOpen ? 'var(--accent)' : 'var(--border)', background: fxOpen ? 'rgba(139,92,246,0.14)' : 'var(--bg-card)' }}><Zap size={15} /></button>
        <button
          onPointerDown={() => { undoHold.current.long = false; undoHold.current.timer = window.setTimeout(() => { undoHold.current.long = true; redo?.() }, 450) }}
          onPointerUp={() => { if (undoHold.current.timer) window.clearTimeout(undoHold.current.timer); if (!undoHold.current.long) undo?.() }}
          onPointerLeave={() => { if (undoHold.current.timer) window.clearTimeout(undoHold.current.timer) }}
          aria-label="Undo (hold to redo)" title="Tap: undo · Hold: redo"
          style={{ ...tBtn, width: 34, fontSize: 15, touchAction: 'none', opacity: (canUndo || canRedo) ? 1 : 0.4, color: canUndo ? 'var(--text-primary)' : 'var(--text-muted)' }}>↩</button>
        <button onClick={() => setSettings(true)} aria-label="Transport settings" style={{ ...tBtn, width: 34, fontSize: 16 }}>⚙</button>
      </div>

      {settings && (
        <div onClick={() => setSettings(false)} style={{ position: 'fixed', inset: 0, zIndex: 170, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-end' }}>
          <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxHeight: '80vh', overflowY: 'auto', background: 'var(--bg-surface)', borderTop: '1px solid var(--border)', borderRadius: '18px 18px 0 0', padding: '16px 16px calc(18px + env(safe-area-inset-bottom))' }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14 }}>
              <strong style={{ fontSize: 14.5, flex: 1 }}>Song settings</strong>
              <button onClick={() => setSettings(false)} aria-label="Close" style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 20, cursor: 'pointer' }}>×</button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              {/* Tempo + tap */}
              <div>
                <div style={label}>Tempo</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <HoldButton onStep={() => dispatch({ type: 'SET_TEMPO', tempo: project.tempo - 1 })} style={roundBtn} aria-label="Slower">−</HoldButton>
                  <div style={{ fontSize: 22, fontWeight: 800, fontVariantNumeric: 'tabular-nums', minWidth: 54, textAlign: 'center' }}>{Math.round(project.tempo)}</div>
                  <HoldButton onStep={() => dispatch({ type: 'SET_TEMPO', tempo: project.tempo + 1 })} style={roundBtn} aria-label="Faster">+</HoldButton>
                  <button onClick={tap} style={{ marginLeft: 'auto', padding: '10px 20px', borderRadius: 10, fontSize: 13, fontWeight: 800, cursor: 'pointer', border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)' }}>TAP</button>
                </div>
              </div>

              {/* Time signature */}
              <div>
                <div style={label}>Time signature</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {([[project.timeSignatureNum, 'num'], [project.timeSignatureDen, 'den']] as const).map(([val, which], i) => (
                    <div key={which} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {i === 1 && <span style={{ fontSize: 18, color: 'var(--text-muted)' }}>/</span>}
                      <button onClick={() => dispatch({ type: 'SET_TIME_SIG', num: which === 'num' ? Math.max(1, val - 1) : project.timeSignatureNum, den: which === 'den' ? Math.max(1, val - 1) : project.timeSignatureDen })} style={roundBtn}>−</button>
                      <span style={{ fontSize: 18, fontWeight: 800, minWidth: 22, textAlign: 'center' }}>{val}</span>
                      <button onClick={() => dispatch({ type: 'SET_TIME_SIG', num: which === 'num' ? val + 1 : project.timeSignatureNum, den: which === 'den' ? val * 2 : project.timeSignatureDen })} style={roundBtn}>+</button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Swing */}
              <div>
                <div style={label}>Swing {Math.round((project.swing ?? 0) * 100)}%</div>
                <input type="range" min={0} max={100} value={Math.round((project.swing ?? 0) * 100)} onChange={e => dispatch({ type: 'SET_SWING', swing: Number(e.target.value) / 100 })} style={{ width: '100%', accentColor: '#8b5cf6' }} />
              </div>

              {/* Key */}
              <div>
                <div style={label}>Key</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {NOTE_NAMES.map((n, i) => (
                    <button key={n} onClick={() => dispatch({ type: 'SET_KEY_SCALE', key: i, scale: project.scale })} style={chip(project.key === i)}>{n}</button>
                  ))}
                </div>
              </div>

              {/* Scale */}
              <div>
                <div style={label}>Scale</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {SCALES.map(s => (
                    <button key={s.id} onClick={() => dispatch({ type: 'SET_KEY_SCALE', key: project.key, scale: s.id })} style={chip(project.scale === s.id)}>{s.label}</button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const tBtn: React.CSSProperties = { width: 32, height: 42, borderRadius: 9, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 16, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }
const roundBtn: React.CSSProperties = { width: 38, height: 38, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 20, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }
const label: React.CSSProperties = { fontSize: 10.5, fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 8 }
const chip = (on: boolean): React.CSSProperties => ({ padding: '8px 13px', borderRadius: 999, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`, background: on ? 'rgba(139,92,246,0.16)' : 'var(--bg-card)', color: on ? 'var(--accent-light)' : 'var(--text-secondary)' })
