'use client'

// Audio → MIDI — its own home screen. Identity: a waveform resolving into stacked MIDI
// note-blocks (a piano roll). Distinct to this app (not a shared template).
import { Mic, Upload, FileMusic, ArrowRight } from 'lucide-react'
import { useAppShell } from '@/components/apps/AppChrome'
import { relTime } from '@/lib/app-history'

// A little piano-roll: [lane, startStep, lengthSteps]
const ROLL: [number, number, number][] = [
  [4, 0, 2], [3, 2, 2], [2, 4, 3], [1, 7, 2], [2, 9, 2], [0, 11, 3], [3, 14, 2],
]
const ROLL_LANES = 5, ROLL_STEPS = 16

export default function TranscribeHome({ onStart }: { onStart: () => void }) {
  const { history } = useAppShell()
  const recent = history.entries

  return (
    <main id="main" style={{ maxWidth: 620, margin: '0 auto', padding: '18px 18px 56px' }}>
      <style>{`
        @keyframes th-wave { 0%,100% { transform: scaleY(.3) } 50% { transform: scaleY(1) } }
        @keyframes th-note { from { transform: scaleX(0); opacity: 0 } to { transform: scaleX(1); opacity: 1 } }
        .th-cta:active { transform: scale(.98) }
        .th-card { transition: transform .14s ease, border-color .18s ease }
        .th-card:hover { transform: translateY(-2px); border-color: var(--accent) }
      `}</style>

      <section style={{ position: 'relative', overflow: 'hidden', borderRadius: 20, border: '1px solid var(--border)', background: 'linear-gradient(150deg, var(--bg-card), var(--bg-base))', padding: '26px 22px 24px', marginBottom: 26 }}>
        <p style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--accent)', margin: '0 0 10px' }}>Audio → MIDI</p>
        <h1 style={{ fontSize: 33, fontWeight: 850, letterSpacing: '-0.03em', color: 'var(--text-primary)', margin: '0 0 8px', lineHeight: 1.06 }}>Audio to MIDI</h1>
        <p style={{ fontSize: 15, color: 'var(--text-secondary)', lineHeight: 1.55, margin: '0 0 22px', maxWidth: '42ch' }}>
          Drop in a recording or hum a line — the pitch detector turns it into editable MIDI notes you can hear on any instrument and export.
        </p>

        {/* motif: waveform → piano-roll notes */}
        <div style={{ display: 'flex', alignItems: 'stretch', gap: 12, marginBottom: 24, height: 88 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 3, padding: '0 12px', borderRadius: 10, background: 'var(--bg-base)', border: '1px solid var(--border)' }}>
            {Array.from({ length: 14 }).map((_, i) => <span key={i} style={{ width: 3, height: 44, borderRadius: 2, background: 'var(--accent)', opacity: 0.85, transformOrigin: 'center', animation: `th-wave 1.4s ease-in-out ${(i * 0.07).toFixed(2)}s infinite` }} />)}
          </div>
          <ArrowRight size={18} style={{ color: 'var(--text-muted)', alignSelf: 'center', flexShrink: 0 }} />
          <div style={{ position: 'relative', flex: 1, borderRadius: 10, background: 'var(--bg-base)', border: '1px solid var(--border)', overflow: 'hidden' }}>
            {ROLL.map(([lane, start, len], i) => (
              <span key={i} style={{ position: 'absolute', left: `${(start / ROLL_STEPS) * 100}%`, width: `${(len / ROLL_STEPS) * 100 - 1}%`, top: `${(lane / ROLL_LANES) * 100 + 6}%`, height: `${100 / ROLL_LANES - 12}%`, background: 'var(--accent)', borderRadius: 4, transformOrigin: 'left', animation: `th-note .5s ease-out ${(i * 0.12).toFixed(2)}s both` }} />
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button type="button" onClick={onStart} className="th-cta"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 9, padding: '13px 22px', borderRadius: 12, border: 'none', background: 'var(--accent)', color: '#0e0d12', fontSize: 15, fontWeight: 850, cursor: 'pointer', boxShadow: '0 6px 20px rgba(0,0,0,0.25)' }}>
            <Upload size={18} /> Upload audio
          </button>
          <button type="button" onClick={onStart} className="th-cta"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '13px 20px', borderRadius: 12, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-secondary)', fontSize: 15, fontWeight: 750, cursor: 'pointer' }}>
            <Mic size={17} /> Record a melody
          </button>
        </div>
      </section>

      {recent.length > 0 && (
        <section>
          <h2 style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', margin: '0 0 12px' }}>Recent</h2>
          <div style={{ display: 'grid', gap: 8 }}>
            {recent.map(e => (
              <div key={e.id} className="th-card" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 13, border: '1px solid var(--border)', background: 'var(--bg-card)' }}>
                <span style={{ display: 'grid', placeItems: 'center', width: 38, height: 38, borderRadius: 10, background: 'var(--bg-base)', color: 'var(--accent)', flexShrink: 0 }}><FileMusic size={17} /></span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.title}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{[e.subtitle, relTime(e.ts)].filter(Boolean).join(' · ')}</div>
                </div>
                <button type="button" onClick={onStart} aria-label="Open" style={{ display: 'grid', placeItems: 'center', width: 34, height: 34, borderRadius: 9, background: 'var(--bg-base)', border: '1px solid var(--border)', color: 'var(--text-secondary)', cursor: 'pointer', flexShrink: 0 }}><ArrowRight size={16} /></button>
              </div>
            ))}
          </div>
        </section>
      )}

      <p style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 24, textAlign: 'center', lineHeight: 1.55 }}>Runs on-device — no upload, no sign-in. Best on a single melody line; it detects chords too, then export MIDI/WAV or open in the studio.</p>
    </main>
  )
}
