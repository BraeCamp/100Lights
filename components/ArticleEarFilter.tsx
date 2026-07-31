'use client'

// Match-by-ear: a target tone plays through a hidden low-pass. Slide YOUR cutoff
// until it matches — the meter goes green when you're on it. You learn what the
// filter does by chasing the sound, no explanation needed.

import { useEffect, useRef, useState } from 'react'
import { ACCENT, clamp, rangeStyle, Frame } from './article/mix-kit'
import { Meter, GOOD } from './article/challenge-kit'

const F_LO = 140, F_HI = 11000
const toFreq = (x: number) => F_LO * Math.pow(F_HI / F_LO, x)

export default function ArticleEarFilter({ caption }: { caption?: string }) {
  const [targetX, setTargetX] = useState(0.55)
  const [userX, setUserX] = useState(0.5)
  const [mode, setMode] = useState<'target' | 'yours' | null>(null)  // what's currently sounding
  const [started, setStarted] = useState(false)

  const filterRef = useRef<BiquadFilterNode | null>(null)
  const masterRef = useRef<GainNode | null>(null)
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Build a persistent detuned-saw drone → low-pass → master (silent until play).
  useEffect(() => {
    // Lazy ctx from mix-kit is fine, but this widget wants its own so stopping it
    // never cuts another widget's audio.
    const c = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
    const filter = c.createBiquadFilter(); filter.type = 'lowpass'; filter.Q.value = 4; filter.frequency.value = toFreq(0.55)
    const master = c.createGain(); master.gain.value = 0
    filter.connect(master); master.connect(c.destination)
    const oscs = [-7, 0, 7].map(det => {
      const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 110; o.detune.value = det
      const g = c.createGain(); g.gain.value = 0.16
      o.connect(g); g.connect(filter); o.start()
      return o
    })
    filterRef.current = filter; masterRef.current = master
    return () => {
      oscs.forEach(o => { try { o.stop() } catch { /* stopped */ } })
      filter.disconnect(); master.disconnect(); void c.close().catch(() => {})
    }
  }, [])

  // Whatever's sounding follows its cutoff live (so dragging is audible).
  useEffect(() => {
    const f = filterRef.current; if (!f || mode === null) return
    const x = mode === 'target' ? targetX : userX
    f.frequency.setTargetAtTime(toFreq(x), f.context.currentTime, 0.03)
  }, [mode, targetX, userX])

  function hear(which: 'target' | 'yours') {
    const master = masterRef.current, f = filterRef.current
    if (!master || !f) return
    void (f.context as AudioContext).resume()
    setMode(which)
    if (stopTimer.current) clearTimeout(stopTimer.current)
    const t = f.context.currentTime
    master.gain.cancelScheduledValues(t)
    master.gain.setTargetAtTime(0.28, t, 0.01)
    stopTimer.current = setTimeout(() => {
      master.gain.setTargetAtTime(0, f.context.currentTime, 0.05)
    }, 1400)
  }

  function newTarget() {
    setStarted(true)
    setTargetX(0.12 + Math.random() * 0.78)
    hear('target')
  }

  const dist = Math.abs(userX - targetX)
  const proximity = clamp(1 - dist / 0.4, 0, 1)
  const nailed = dist < 0.03

  return (
    <Frame caption={caption}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <button onClick={newTarget} style={{ fontSize: 13, fontWeight: 700, padding: '9px 18px', borderRadius: 10, border: 'none', cursor: 'pointer', background: ACCENT, color: '#fff' }}>
          {started ? 'New target' : 'Start'}
        </button>
        {started && (
          <>
            <button onClick={() => hear('target')} style={btn(mode === 'target')}>▶ Target</button>
            <button onClick={() => hear('yours')} style={btn(mode === 'yours')}>▶ Yours</button>
          </>
        )}
        {started && (
          <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 800, color: nailed ? GOOD : 'var(--text-muted)' }}>
            {nailed ? '✓ matched' : `${Math.round(proximity * 100)}%`}
          </span>
        )}
      </div>

      {started && <Meter value={proximity} hint={nailed ? 'On it — hit New target for another.' : 'Warmer as the bar fills. Green = matched.'} />}

      <input
        type="range" min={0} max={1000} value={Math.round(userX * 1000)}
        onChange={e => { setUserX(Number(e.target.value) / 1000); setMode('yours') }}
        aria-label="Your cutoff" style={{ ...rangeStyle, opacity: started ? 1 : 0.5 }} disabled={!started}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
        <span>dark</span><span>your cutoff{started ? ` · ${Math.round(toFreq(userX))} Hz` : ''}</span><span>bright</span>
      </div>
    </Frame>
  )
}

function btn(active: boolean): React.CSSProperties {
  return {
    fontSize: 12, fontWeight: 700, padding: '9px 13px', borderRadius: 10, cursor: 'pointer',
    border: `1px solid ${active ? ACCENT : 'var(--border)'}`,
    background: active ? 'rgba(167,139,250,0.2)' : 'var(--bg-card)', color: active ? ACCENT : 'var(--text-secondary)',
  }
}
