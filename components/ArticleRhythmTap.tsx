'use client'

// Hear a rhythm, then tap it back. A pattern plays across eight slots (the
// playhead lights each one); you recreate it by clicking the slots, then check.
// Reading rhythm notation is optional — this teaches the feel directly.

import { useEffect, useRef, useState } from 'react'
import { Play } from 'lucide-react'
import { ACCENT, mixCtx, Frame } from './article/mix-kit'
import { GOOD, BAD } from './article/challenge-kit'

const SLOTS = 8
const SLOT_MS = 210

export default function ArticleRhythmTap({ caption }: { caption?: string }) {
  const [pattern, setPattern] = useState<boolean[]>(Array(SLOTS).fill(false))
  const [userPat, setUserPat] = useState<boolean[]>(Array(SLOTS).fill(false))
  const [phase, setPhase] = useState<'idle' | 'playing' | 'input' | 'checked'>('idle')
  const [playhead, setPlayhead] = useState(-1)
  const [score, setScore] = useState({ right: 0, total: 0 })
  const bufRef = useRef<AudioBuffer | null>(null)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])

  useEffect(() => {
    const c = mixCtx()
    const buf = c.createBuffer(1, Math.floor(c.sampleRate * 0.12), c.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2.2)
    bufRef.current = buf
    return () => { timers.current.forEach(clearTimeout); timers.current = [] }
  }, [])

  function hit(t: number) {
    const c = mixCtx(); const buf = bufRef.current; if (!buf) return
    const s = c.createBufferSource(); s.buffer = buf
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1900; bp.Q.value = 0.9
    const g = c.createGain(); g.gain.value = 0.5
    s.connect(bp); bp.connect(g); g.connect(c.destination); s.start(t)
  }

  function playPattern(pat: boolean[]) {
    const c = mixCtx(); void c.resume()
    timers.current.forEach(clearTimeout); timers.current = []
    setPhase('playing')
    const base = c.currentTime + 0.12
    for (let i = 0; i < SLOTS; i++) {
      if (pat[i]) hit(base + (i * SLOT_MS) / 1000)
      timers.current.push(setTimeout(() => setPlayhead(i), i * SLOT_MS + 60))
    }
    timers.current.push(setTimeout(() => { setPlayhead(-1); setPhase('input') }, SLOTS * SLOT_MS + 120))
  }

  function newPattern() {
    const pat = Array.from({ length: SLOTS }, (_, i) => i === 0 ? true : Math.random() < 0.42)
    if (pat.filter(Boolean).length < 3) pat[3] = true, pat[6] = true
    setPattern(pat); setUserPat(Array(SLOTS).fill(false)); setPhase('playing')
    playPattern(pat)
  }
  function toggle(i: number) {
    if (phase !== 'input') return
    setUserPat(u => u.map((v, j) => j === i ? !v : v))
  }
  function check() {
    if (phase !== 'input') return
    const ok = pattern.every((p, i) => p === userPat[i])
    setScore(s => ({ right: s.right + (ok ? 1 : 0), total: s.total + 1 }))
    setPhase('checked')
  }

  const showTruth = phase === 'checked'

  return (
    <Frame caption={caption}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <button onClick={newPattern} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 700, padding: '9px 18px', borderRadius: 10, border: 'none', cursor: 'pointer', background: ACCENT, color: '#fff' }}>
          <Play size={14} /> {phase === 'idle' ? 'Start' : 'New rhythm'}
        </button>
        {phase !== 'idle' && (
          <button onClick={() => playPattern(pattern)} style={{ fontSize: 12, fontWeight: 700, padding: '9px 14px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-secondary)', cursor: 'pointer' }}>
            Hear again
          </button>
        )}
        {phase === 'input' && (
          <button onClick={check} style={{ fontSize: 12, fontWeight: 700, padding: '9px 16px', borderRadius: 10, border: `1px solid ${ACCENT}`, background: 'rgba(167,139,250,0.15)', color: ACCENT, cursor: 'pointer' }}>
            Check
          </button>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 11.5, fontWeight: 700, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
          {score.total > 0 ? `${score.right} / ${score.total}` : 'Score'}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${SLOTS}, 1fr)`, gap: 6 }}>
        {Array.from({ length: SLOTS }).map((_, i) => {
          const on = userPat[i]
          const isHead = playhead === i
          let border = 'var(--border)', bg = 'var(--bg-card)', color = 'var(--text-muted)'
          if (showTruth) {
            if (pattern[i] && on) { border = GOOD; bg = 'rgba(52,211,153,0.18)'; color = GOOD }
            else if (pattern[i] && !on) { border = GOOD; bg = 'transparent'; color = GOOD }       // missed (outline)
            else if (!pattern[i] && on) { border = BAD; bg = 'rgba(248,113,113,0.18)'; color = BAD } // extra
          } else if (on) { border = ACCENT; bg = 'rgba(167,139,250,0.25)'; color = ACCENT }
          return (
            <button key={i} onClick={() => toggle(i)} disabled={phase !== 'input'}
              title={`Slot ${i + 1}`}
              style={{
                aspectRatio: '1', borderRadius: 8, cursor: phase === 'input' ? 'pointer' : 'default',
                border: `2px solid ${isHead ? '#fff' : border}`, background: bg, color,
                fontSize: 16, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: isHead ? '0 0 12px rgba(255,255,255,0.6)' : 'none', transition: 'box-shadow 0.08s',
              }}>
              {(showTruth ? pattern[i] : on) ? '●' : ''}
            </button>
          )
        })}
      </div>

      {phase === 'input' && <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 10 }}>Tap the slots that played, then Check. Beat 1 is always on.</p>}
      {showTruth && (
        <p style={{ fontSize: 12, marginTop: 10, fontWeight: 600, color: pattern.every((p, i) => p === userPat[i]) ? GOOD : BAD }}>
          {pattern.every((p, i) => p === userPat[i]) ? '✓ Nailed the rhythm.' : '✗ Close — filled = the real pattern, outline = you missed it, red = extra.'}
        </p>
      )}
    </Frame>
  )
}
