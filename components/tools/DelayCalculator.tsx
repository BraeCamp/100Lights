'use client'

/**
 * Delay / reverb time calculator.
 *
 * Given a BPM, a quarter note lasts 60000 / bpm ms. Every other note value is a
 * simple multiple of that, and dotted / triplet feels are 1.5x and 2/3x the
 * straight value. The straight column doubles as an LFO rate in Hz (1000 / ms),
 * which is what you'd dial into a tremolo or filter to lock it to the tempo.
 *
 * No audio here — it's pure arithmetic, so the whole thing is a controlled BPM
 * input plus a derived table. BPM persists to localStorage, loaded after mount
 * so server and client render the same default (no hydration mismatch).
 */

import { useEffect, useRef, useState } from 'react'

const MIN_BPM = 40
const MAX_BPM = 300
const BPM_KEY = '100lights-delay-bpm'

const clampBpm = (v: number) => Math.max(MIN_BPM, Math.min(MAX_BPM, Math.round(v)))

// mul is the multiple of a quarter note for the straight value.
const ROWS: Array<{ label: string; sub: string; mul: number }> = [
  { label: '1/1', sub: 'whole', mul: 4 },
  { label: '1/2', sub: 'half', mul: 2 },
  { label: '1/4', sub: 'quarter', mul: 1 },
  { label: '1/8', sub: 'eighth', mul: 1 / 2 },
  { label: '1/16', sub: 'sixteenth', mul: 1 / 4 },
  { label: '1/32', sub: 'thirty-second', mul: 1 / 8 },
]

const round1 = (n: number) => Math.round(n * 10) / 10

export default function DelayCalculator() {
  const [bpm, setBpm] = useState(120)
  const [editing, setEditing] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)

  const tapTimes = useRef<number[]>([])
  const copyTimer = useRef<number | null>(null)

  // Load saved BPM after mount so SSR and first client render match.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(BPM_KEY)
      if (raw != null && raw !== '') {
        const v = Number(raw)
        if (Number.isFinite(v)) setBpm(clampBpm(v))
      }
    } catch { /* ignore */ }
  }, [])

  // Debounced save.
  useEffect(() => {
    const t = setTimeout(() => {
      try { localStorage.setItem(BPM_KEY, String(bpm)) } catch { /* quota */ }
    }, 300)
    return () => clearTimeout(t)
  }, [bpm])

  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current) }, [])

  function tap() {
    const now = performance.now()
    const times = tapTimes.current.filter(t => now - t < 2000)
    times.push(now)
    tapTimes.current = times
    if (times.length >= 2) {
      const gaps = times.slice(1).map((t, i) => t - times[i])
      const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length
      setBpm(clampBpm(60000 / avg))
    }
  }

  function copy(key: string, value: number) {
    const text = String(round1(value))
    try { void navigator.clipboard?.writeText(text) } catch { /* no clipboard */ }
    setCopied(key)
    if (copyTimer.current) clearTimeout(copyTimer.current)
    copyTimer.current = window.setTimeout(() => setCopied(null), 900)
  }

  const quarter = 60000 / bpm

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 16, padding: '22px 20px', background: 'var(--bg-card)' }}>
      {/* BPM control */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
        <div style={{ textAlign: 'center' }}>
          {editing ? (
            <input
              autoFocus type="number" min={MIN_BPM} max={MAX_BPM} defaultValue={bpm}
              onBlur={e => { setBpm(clampBpm(Number(e.target.value) || bpm)); setEditing(false) }}
              onKeyDown={e => {
                if (e.key === 'Enter') { setBpm(clampBpm(Number((e.target as HTMLInputElement).value) || bpm)); setEditing(false) }
                if (e.key === 'Escape') setEditing(false)
              }}
              style={{ width: 128, fontSize: 48, fontWeight: 800, textAlign: 'center', background: 'var(--bg-base)', border: '1px solid var(--accent)', borderRadius: 12, color: 'var(--text-primary)', outline: 'none', fontVariantNumeric: 'tabular-nums' }}
            />
          ) : (
            <button onClick={() => setEditing(true)} title="Click to type a tempo"
              style={{ background: 'none', border: 'none', cursor: 'text', padding: 0, display: 'block' }}>
              <span style={{ fontSize: 52, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.03em', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{bpm}</span>
            </button>
          )}
          <div style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginTop: 2 }}>BPM</div>
        </div>

        <div style={{ flex: '1 1 220px', minWidth: 200 }}>
          <input
            type="range" min={MIN_BPM} max={MAX_BPM} value={bpm}
            onChange={e => setBpm(Number(e.target.value))}
            className="cf-slider" style={{ width: '100%' }} aria-label="Tempo"
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <button onClick={() => setBpm(b => clampBpm(b - 1))} style={stepBtn}>−</button>
            <button onClick={() => setBpm(b => clampBpm(b + 1))} style={stepBtn}>+</button>
            <button onClick={tap} style={{ ...stepBtn, width: 'auto', padding: '0 18px', fontSize: 12, fontWeight: 700 }}>TAP</button>
            <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>tap along to find a tempo</span>
          </div>
        </div>
      </div>

      {/* Results table */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontVariantNumeric: 'tabular-nums' }}>
          <thead>
            <tr>
              <th style={{ ...th, textAlign: 'left' }}>Note</th>
              <th style={th}>Straight</th>
              <th style={th}>Dotted</th>
              <th style={th}>Triplet</th>
              <th style={{ ...th, color: 'var(--text-muted)' }}>Hz</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map(row => {
              const straight = quarter * row.mul
              const dotted = straight * 1.5
              const triplet = straight * (2 / 3)
              const hz = 1000 / straight
              return (
                <tr key={row.label} style={{ borderTop: '1px solid var(--border-light)' }}>
                  <td style={{ ...td, textAlign: 'left' }}>
                    <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{row.label}</span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 7 }}>{row.sub}</span>
                  </td>
                  <MsCell k={`${row.label}-s`} value={straight} copied={copied} onCopy={copy} strong />
                  <MsCell k={`${row.label}-d`} value={dotted} copied={copied} onCopy={copy} />
                  <MsCell k={`${row.label}-t`} value={triplet} copied={copied} onCopy={copy} />
                  <td style={{ ...td, fontSize: 12, color: 'var(--text-muted)' }}>{round1(hz)} Hz</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <p style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', margin: '14px 0 0' }}>
        Tap any millisecond value to copy it. <strong>Straight</strong> is the plain note, <strong>Dotted</strong> is 1.5×, <strong>Triplet</strong> is ⅔×. Hz syncs an LFO or tremolo to the straight value.
      </p>
    </div>
  )
}

function MsCell({ k, value, copied, onCopy, strong }: {
  k: string
  value: number
  copied: string | null
  onCopy: (k: string, v: number) => void
  strong?: boolean
}) {
  const isCopied = copied === k
  return (
    <td style={td}>
      <button
        onClick={() => onCopy(k, value)}
        title="Click to copy"
        style={{
          border: '1px solid transparent', borderRadius: 7, padding: '4px 8px', cursor: 'pointer',
          background: isCopied ? 'rgba(124,58,237,0.15)' : 'transparent',
          color: isCopied ? 'var(--accent-light)' : strong ? 'var(--text-primary)' : 'var(--text-secondary)',
          fontWeight: strong ? 700 : 500, fontSize: 13.5, fontVariantNumeric: 'tabular-nums',
          minWidth: 78, transition: 'background 120ms, color 120ms',
        }}
      >
        {isCopied ? 'copied' : `${round1(value)} ms`}
      </button>
    </td>
  )
}

const th: React.CSSProperties = {
  fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
  color: 'var(--text-secondary)', textAlign: 'right', padding: '0 8px 8px', whiteSpace: 'nowrap',
}
const td: React.CSSProperties = {
  padding: '6px 8px', textAlign: 'right', whiteSpace: 'nowrap',
}
const stepBtn: React.CSSProperties = {
  width: 38, height: 38, borderRadius: 10, cursor: 'pointer', fontSize: 18, fontWeight: 700,
  border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
}
