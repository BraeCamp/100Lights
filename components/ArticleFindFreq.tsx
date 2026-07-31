'use client'

// Ear-training: noise plays with one frequency band boosted (a "honk"). Your
// slider is a matching CUT — sweep it until the honk disappears and the noise
// goes flat. When your cut lands on the boost, they cancel. You learn to hear
// where frequencies live, no numbers required.

import { useEffect, useRef, useState } from 'react'
import { Play, Square } from 'lucide-react'
import { ACCENT, clamp, rangeStyle, Frame } from './article/mix-kit'
import { Meter, GOOD } from './article/challenge-kit'

const F_LO = 250, F_HI = 7000
const toFreq = (x: number) => F_LO * Math.pow(F_HI / F_LO, x)

export default function ArticleFindFreq({ caption }: { caption?: string }) {
  const [targetX, setTargetX] = useState(0.5)
  const [userX, setUserX] = useState(0.5)
  const [started, setStarted] = useState(false)
  const [playing, setPlaying] = useState(false)

  const ctxRef = useRef<AudioContext | null>(null)
  const bufRef = useRef<AudioBuffer | null>(null)
  const srcRef = useRef<AudioBufferSourceNode | null>(null)
  const boostRef = useRef<BiquadFilterNode | null>(null)
  const cutRef = useRef<BiquadFilterNode | null>(null)

  useEffect(() => {
    const c = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
    ctxRef.current = c
    const buf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * 0.5
    bufRef.current = buf
    const boost = c.createBiquadFilter(); boost.type = 'peaking'; boost.Q.value = 3.2; boost.gain.value = 13; boost.frequency.value = toFreq(0.5)
    const cut = c.createBiquadFilter(); cut.type = 'peaking'; cut.Q.value = 3.2; cut.gain.value = -13; cut.frequency.value = toFreq(0.5)
    const out = c.createGain(); out.gain.value = 0.6
    boost.connect(cut); cut.connect(out); out.connect(c.destination)
    boostRef.current = boost; cutRef.current = cut
    return () => { try { srcRef.current?.stop() } catch { /* stopped */ } ; void c.close().catch(() => {}) }
  }, [])

  useEffect(() => { const b = boostRef.current; if (b) b.frequency.setTargetAtTime(toFreq(targetX), b.context.currentTime, 0.02) }, [targetX])
  useEffect(() => { const cu = cutRef.current; if (cu) cu.frequency.setTargetAtTime(toFreq(userX), cu.context.currentTime, 0.02) }, [userX])

  function stop() { try { srcRef.current?.stop() } catch { /* stopped */ } srcRef.current = null; setPlaying(false) }
  function play() {
    const c = ctxRef.current, buf = bufRef.current, boost = boostRef.current
    if (!c || !buf || !boost) return
    void c.resume()
    try { srcRef.current?.stop() } catch { /* none */ }
    const s = c.createBufferSource(); s.buffer = buf; s.loop = true; s.connect(boost); s.start()
    srcRef.current = s; setPlaying(true)
  }

  function newRound() {
    setStarted(true)
    setTargetX(0.1 + Math.random() * 0.8)
    if (!playing) play()
  }

  const dist = Math.abs(userX - targetX)
  const proximity = clamp(1 - dist / 0.4, 0, 1)
  const nailed = dist < 0.035

  return (
    <Frame caption={caption}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <button onClick={newRound} style={{ fontSize: 13, fontWeight: 700, padding: '9px 18px', borderRadius: 10, border: 'none', cursor: 'pointer', background: ACCENT, color: '#fff' }}>
          {started ? 'New honk' : 'Start'}
        </button>
        {started && (
          <button onClick={() => (playing ? stop() : play())} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, padding: '9px 14px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-secondary)', cursor: 'pointer' }}>
            {playing ? <Square size={12} fill="currentColor" /> : <Play size={13} />} {playing ? 'Stop' : 'Play'}
          </button>
        )}
        {started && <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 800, color: nailed ? GOOD : 'var(--text-muted)' }}>{nailed ? '✓ flat' : `${Math.round(proximity * 100)}%`}</span>}
      </div>

      {started && <Meter value={proximity} hint={nailed ? 'The honk is gone — you found it. New honk for another.' : 'Sweep until the resonant honk cancels out.'} />}

      <input
        type="range" min={0} max={1000} value={Math.round(userX * 1000)}
        onChange={e => setUserX(Number(e.target.value) / 1000)}
        aria-label="Your cut frequency" style={{ ...rangeStyle, opacity: started ? 1 : 0.5 }} disabled={!started}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
        <span>low</span><span>your cut{started ? ` · ${Math.round(toFreq(userX))} Hz` : ''}</span><span>high</span>
      </div>
    </Frame>
  )
}
