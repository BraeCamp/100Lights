'use client'

// Touch-first transport. The bar shows only the essentials — play, position,
// tempo, metronome, loop. Everything advanced (tap tempo, time signature, swing,
// key + scale) lives in a Settings sheet behind the gear, so it never overwhelms.

import { useEffect, useRef, useState } from 'react'
import { Repeat, Music2 } from 'lucide-react'
import { useDaw } from '@/lib/daw-state'

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const SCALES: { id: string; label: string }[] = [
  { id: 'major', label: 'Major' }, { id: 'minor', label: 'Minor' },
  { id: 'penta-maj', label: 'Penta+' }, { id: 'penta-min', label: 'Penta−' },
  { id: 'dorian', label: 'Dorian' }, { id: 'chromatic', label: 'Chromatic' },
]

export function MobileTransport() {
  const { engine, playing, position, project, dispatch, metronome, setMetronome } = useDaw()
  const [settings, setSettings] = useState(false)
  const taps = useRef<number[]>([])

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
      <div style={{ display: 'flex', alignItems: 'center', gap: landscape ? 6 : 8, padding: landscape ? '3px 10px' : '9px 12px' }}>
        <button onClick={() => (engine.isPlaying ? engine.stop() : void engine.play())} aria-label={playing ? 'Stop' : 'Play'} style={{ width: landscape ? 58 : play, height: play, borderRadius: play / 2, border: 'none', flexShrink: 0, cursor: 'pointer', background: playing ? '#ef4444' : 'var(--accent)', color: '#fff', fontSize: landscape ? 15 : 18 }}>{playing ? '■' : '▶'}</button>
        <div style={{ textAlign: 'center', minWidth: 46 }}>
          <div style={{ fontSize: 17, fontWeight: 800, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{bar}:{beat}</div>
          <div style={{ fontSize: 8, color: 'var(--text-muted)', letterSpacing: 0.4 }}>BAR</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginLeft: 'auto' }}>
          <button onClick={() => dispatch({ type: 'SET_TEMPO', tempo: project.tempo - 1 })} style={tBtn}>−</button>
          <div style={{ textAlign: 'center', minWidth: 42 }}><div style={{ fontSize: 16, fontWeight: 800, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{Math.round(project.tempo)}</div><div style={{ fontSize: 8, color: 'var(--text-muted)' }}>BPM</div></div>
          <button onClick={() => dispatch({ type: 'SET_TEMPO', tempo: project.tempo + 1 })} style={tBtn}>+</button>
        </div>
        <button onClick={() => setMetronome(!metronome)} aria-pressed={metronome} title="Metronome" style={{ ...tBtn, width: 34, color: metronome ? 'var(--accent-light)' : 'var(--text-muted)', borderColor: metronome ? 'var(--accent)' : 'var(--border)', background: metronome ? 'rgba(139,92,246,0.14)' : 'var(--bg-card)' }}><Music2 size={15} /></button>
        <button onClick={toggleLoop} aria-pressed={project.loopEnabled} title="Loop the whole project" style={{ ...tBtn, width: 34, color: project.loopEnabled ? 'var(--accent-light)' : 'var(--text-muted)', borderColor: project.loopEnabled ? 'var(--accent)' : 'var(--border)', background: project.loopEnabled ? 'rgba(139,92,246,0.14)' : 'var(--bg-card)' }}><Repeat size={15} /></button>
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
                  <button onClick={() => dispatch({ type: 'SET_TEMPO', tempo: project.tempo - 1 })} style={roundBtn}>−</button>
                  <div style={{ fontSize: 22, fontWeight: 800, fontVariantNumeric: 'tabular-nums', minWidth: 54, textAlign: 'center' }}>{Math.round(project.tempo)}</div>
                  <button onClick={() => dispatch({ type: 'SET_TEMPO', tempo: project.tempo + 1 })} style={roundBtn}>+</button>
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

const tBtn: React.CSSProperties = { width: 30, height: 34, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 16, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }
const roundBtn: React.CSSProperties = { width: 38, height: 38, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 20, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }
const label: React.CSSProperties = { fontSize: 10.5, fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 8 }
const chip = (on: boolean): React.CSSProperties => ({ padding: '8px 13px', borderRadius: 999, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`, background: on ? 'rgba(139,92,246,0.16)' : 'var(--bg-card)', color: on ? 'var(--accent-light)' : 'var(--text-secondary)' })
