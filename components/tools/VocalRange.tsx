'use client'

/**
 * Vocal range finder. Listens to you sing and tracks the lowest and highest
 * confident, held pitches, then estimates a voice type. Pure pitch detection —
 * nothing is recorded or uploaded.
 */

import { useEffect, useRef, useState } from 'react'
import { LivePitchDetector, LivePitchResult } from '@/lib/pitch-detector'

const PC = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']
const noteName = (m: number) => `${PC[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`

// Classic voice-type ranges in MIDI (low, high). Best-fit, not gospel.
const VOICE_TYPES = [
  { name: 'Bass', low: 40, high: 64 },
  { name: 'Baritone', low: 45, high: 69 },
  { name: 'Tenor', low: 48, high: 72 },
  { name: 'Alto', low: 53, high: 77 },
  { name: 'Mezzo-soprano', low: 57, high: 81 },
  { name: 'Soprano', low: 60, high: 84 },
]

function classify(low: number, high: number): string {
  let best = VOICE_TYPES[0], bestScore = Infinity
  for (const v of VOICE_TYPES) {
    const score = Math.abs(low - v.low) + Math.abs(high - v.high)
    if (score < bestScore) { bestScore = score; best = v }
  }
  return best.name
}

export default function VocalRange() {
  const [listening, setListening] = useState(false)
  const [current, setCurrent] = useState<number | null>(null)
  const [low, setLow] = useState<number | null>(null)
  const [high, setHigh] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const detectorRef = useRef<LivePitchDetector | null>(null)
  // Stability gate: only accept a pitch that holds for a few frames, to reject
  // clicks, breaths, and octave-jump glitches.
  const stable = useRef<{ midi: number; count: number }>({ midi: 0, count: 0 })

  useEffect(() => () => { detectorRef.current?.stop() }, [])

  function onPitch(r: LivePitchResult | null) {
    if (!r || r.confidence < 0.85 || r.rms < 0.02) { setCurrent(null); stable.current.count = 0; return }
    const midi = Math.round(r.midi)
    // Ignore anything outside a plausible sung range (E1–C7).
    if (midi < 28 || midi > 96) return
    if (midi === stable.current.midi) stable.current.count++
    else stable.current = { midi, count: 1 }
    setCurrent(midi)
    if (stable.current.count >= 3) {
      setLow(l => (l == null || midi < l ? midi : l))
      setHigh(h => (h == null || midi > h ? midi : h))
    }
  }

  async function start() {
    setError(null)
    try {
      const d = new LivePitchDetector()
      detectorRef.current = d
      await d.start(onPitch, false)
      setListening(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not access the microphone.')
    }
  }

  function stop() {
    detectorRef.current?.stop(); detectorRef.current = null
    setListening(false); setCurrent(null)
  }

  function reset() {
    setLow(null); setHigh(null); stable.current = { midi: 0, count: 0 }
  }

  const span = low != null && high != null ? high - low : null
  const voice = low != null && high != null && span! >= 5 ? classify(low, high) : null

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 16, padding: '22px 20px', background: 'var(--bg-card)' }}>
      {/* Live note */}
      <div style={{ textAlign: 'center', marginBottom: 20 }}>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>You&rsquo;re singing</div>
        <div style={{ fontSize: 52, fontWeight: 800, color: current != null ? 'var(--accent-light)' : 'var(--text-muted)', letterSpacing: '-0.02em', lineHeight: 1.1, minHeight: 58 }}>
          {current != null ? noteName(current) : listening ? '—' : '·'}
        </div>
      </div>

      {/* Low / high */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
        {([['Lowest', low, '#38bdf8'], ['Highest', high, '#f472b6']] as const).map(([label, val, col]) => (
          <div key={label} style={{ flex: 1, textAlign: 'center', padding: '14px 8px', borderRadius: 12, background: 'var(--bg-base)', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: 10.5, color: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>{label}</div>
            <div style={{ fontSize: 30, fontWeight: 800, color: val != null ? col : 'var(--text-muted)', letterSpacing: '-0.02em' }}>{val != null ? noteName(val) : '—'}</div>
          </div>
        ))}
      </div>

      {/* Result */}
      {voice && span != null && (
        <div style={{ textAlign: 'center', padding: '16px', borderRadius: 12, marginBottom: 18, background: 'linear-gradient(135deg, rgba(124,58,237,0.14), rgba(59,130,246,0.08))', border: '1px solid rgba(139,92,246,0.3)' }}>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Your range spans <strong style={{ color: 'var(--text-primary)' }}>{Math.floor(span / 12)} octave{Math.floor(span / 12) === 1 ? '' : 's'} and {span % 12} semitone{span % 12 === 1 ? '' : 's'}</strong></div>
          <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', marginTop: 4 }}>Closest voice type: {voice}</div>
        </div>
      )}

      {error && <p style={{ fontSize: 12, color: '#ef4444', textAlign: 'center', margin: '0 0 12px' }}>{error}</p>}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
        {!listening ? (
          <button onClick={start} style={{ padding: '10px 26px', borderRadius: 10, border: 'none', fontSize: 14, fontWeight: 700, cursor: 'pointer', background: 'var(--accent)', color: '#fff' }}>
            ▶ Start singing
          </button>
        ) : (
          <button onClick={stop} style={{ padding: '10px 26px', borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: 'pointer', border: '1px solid #dc2626', background: 'rgba(220,38,38,0.13)', color: '#dc2626' }}>
            ⏹ Stop
          </button>
        )}
        {(low != null || high != null) && (
          <button onClick={reset} style={{ padding: '10px 18px', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: 'pointer', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)' }}>Reset</button>
        )}
      </div>

      <p style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', marginTop: 14, marginBottom: 0, lineHeight: 1.6 }}>
        Slide down to your lowest comfortable note, then up to your highest. Hold each for a second. Nothing is recorded.
      </p>
    </div>
  )
}
