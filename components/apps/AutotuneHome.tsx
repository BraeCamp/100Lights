'use client'

// Autotune — its own home screen. Identity: a wandering pitch line SNAPPING to a scale
// grid. Distinct to this app (not a shared template).
import { Mic, Upload, ArrowRight, AudioWaveform } from 'lucide-react'
import { useAppShell } from '@/components/apps/AppChrome'
import { relTime } from '@/lib/app-history'

const LANES = 6

export default function AutotuneHome({ onStart }: { onStart: () => void }) {
  const { history } = useAppShell()
  const recent = history.entries

  return (
    <main id="main" style={{ maxWidth: 620, margin: '0 auto', padding: '18px 18px 56px' }}>
      <style>{`
        @keyframes at-snap { 0% { top: 82% } 18% { top: 82% } 22% { top: 50% } 44% { top: 50% } 48% { top: 16% } 70% { top: 16% } 74% { top: 66% } 96% { top: 66% } 100% { top: 82% } }
        @keyframes at-ghost { 0%,100% { top: 78% } 25% { top: 46% } 50% { top: 20% } 75% { top: 62% } }
        .at-cta:active { transform: scale(.98) }
        .at-card { transition: transform .14s ease, border-color .18s ease }
        .at-card:hover { transform: translateY(-2px); border-color: var(--accent) }
      `}</style>

      <section style={{ position: 'relative', overflow: 'hidden', borderRadius: 20, border: '1px solid var(--border)', background: 'linear-gradient(200deg, var(--bg-card), var(--bg-base))', padding: '26px 22px 24px', marginBottom: 26 }}>
        <p style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--accent)', margin: '0 0 10px' }}>Pitch Correction</p>
        <h1 style={{ fontSize: 33, fontWeight: 850, letterSpacing: '-0.03em', color: 'var(--text-primary)', margin: '0 0 8px', lineHeight: 1.06 }}>Autotune</h1>
        <p style={{ fontSize: 15, color: 'var(--text-secondary)', lineHeight: 1.55, margin: '0 0 22px', maxWidth: '40ch' }}>
          Sing a line and hear it snapped to the nearest note in your key — from a gentle touch-up to the hard-tuned effect.
        </p>

        {/* motif: a pitch line snapping to a scale grid */}
        <div style={{ position: 'relative', height: 96, borderRadius: 12, background: 'var(--bg-base)', border: '1px solid var(--border)', overflow: 'hidden', marginBottom: 22 }}>
          {Array.from({ length: LANES }).map((_, i) => (
            <span key={i} style={{ position: 'absolute', left: 0, right: 0, top: `${(i / (LANES - 1)) * 100}%`, height: 1, background: 'var(--border)' }} />
          ))}
          {/* loose (ghost) pitch */}
          <span aria-hidden style={{ position: 'absolute', left: 0, width: 10, height: 10, borderRadius: 999, marginTop: -5, background: 'color-mix(in srgb, var(--text-muted) 60%, transparent)', animation: 'at-ghost 3.2s ease-in-out infinite' }} />
          {/* snapped pitch */}
          <span aria-hidden style={{ position: 'absolute', right: 16, width: 13, height: 13, borderRadius: 999, marginTop: -6.5, background: 'var(--accent)', boxShadow: '0 0 12px 2px var(--accent)', animation: 'at-snap 3.2s steps(1,end) infinite' }} />
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button type="button" onClick={onStart} className="at-cta"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 9, padding: '13px 22px', borderRadius: 12, border: 'none', background: 'var(--accent)', color: '#0e0d12', fontSize: 15, fontWeight: 850, cursor: 'pointer', boxShadow: '0 6px 20px rgba(0,0,0,0.25)' }}>
            <Mic size={18} /> Record a take
          </button>
          <button type="button" onClick={onStart} className="at-cta"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '13px 20px', borderRadius: 12, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-secondary)', fontSize: 15, fontWeight: 750, cursor: 'pointer' }}>
            <Upload size={17} /> Upload a vocal
          </button>
        </div>
      </section>

      {recent.length > 0 && (
        <section>
          <h2 style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', margin: '0 0 12px' }}>Recent takes</h2>
          <div style={{ display: 'grid', gap: 8 }}>
            {recent.map(e => (
              <div key={e.id} className="at-card" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 13, border: '1px solid var(--border)', background: 'var(--bg-card)' }}>
                <span style={{ display: 'grid', placeItems: 'center', width: 38, height: 38, borderRadius: 10, background: 'var(--bg-base)', color: 'var(--accent)', flexShrink: 0 }}><AudioWaveform size={17} /></span>
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

      <p style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 24, textAlign: 'center', lineHeight: 1.55 }}>Recorded and corrected entirely in your browser — nothing is uploaded. A/B original vs corrected, then download a WAV.</p>
    </main>
  )
}
