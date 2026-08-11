'use client'

// Voice → Instrument — its own home screen. Identity: a hummed pitch contour becoming
// playable notes. Distinct to this app (not a shared template).
import { Mic, Music2, ArrowRight } from 'lucide-react'
import { useAppShell } from '@/components/apps/AppChrome'
import { relTime } from '@/lib/app-history'

const KEYS = [0, 1, 0, 1, 1, 0, 1, 0, 1, 0, 1, 1] // white/black pattern for the mini keyboard

export default function VoiceMidiHome({ onStart }: { onStart: () => void }) {
  const { history } = useAppShell()
  const recent = history.entries

  return (
    <main id="main" style={{ maxWidth: 620, margin: '0 auto', padding: '18px 18px 56px' }}>
      <style>{`
        @keyframes vmh-wave { 0%,100% { transform: scaleY(.35) } 50% { transform: scaleY(1) } }
        @keyframes vmh-note { 0% { opacity: 0; transform: translateY(6px) } 30%,80% { opacity: 1; transform: translateY(0) } 100% { opacity: 0; transform: translateY(-6px) } }
        .vmh-cta:active { transform: scale(.98) }
        .vmh-card { transition: transform .14s ease, border-color .18s ease }
        .vmh-card:hover { transform: translateY(-2px); border-color: var(--accent) }
      `}</style>

      <section style={{ position: 'relative', overflow: 'hidden', borderRadius: 20, border: '1px solid var(--border)', background: 'radial-gradient(120% 100% at 0% 0%, color-mix(in srgb, var(--accent) 12%, transparent), transparent 60%), var(--bg-card)', padding: '26px 22px 24px', marginBottom: 26 }}>
        <p style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--accent)', margin: '0 0 10px' }}>Voice → Instrument</p>
        <h1 style={{ fontSize: 33, fontWeight: 850, letterSpacing: '-0.03em', color: 'var(--text-primary)', margin: '0 0 8px', lineHeight: 1.06 }}>Hum it. Hear it.</h1>
        <p style={{ fontSize: 15, color: 'var(--text-secondary)', lineHeight: 1.55, margin: '0 0 22px', maxWidth: '40ch' }}>
          Sing or hum a melody into your mic and it plays back on any instrument — piano, strings, synth. No keyboard, no theory.
        </p>

        {/* motif: a hummed waveform resolving into notes over a keyboard */}
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 14, marginBottom: 24 }}>
          <span style={{ display: 'grid', placeItems: 'center', width: 46, height: 46, borderRadius: 14, background: 'var(--accent)', color: '#0e0d12', flexShrink: 0 }}><Mic size={22} /></span>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 40 }}>
            {Array.from({ length: 22 }).map((_, i) => (
              <span key={i} style={{ width: 4, height: 34, borderRadius: 2, background: 'var(--accent)', transformOrigin: 'bottom', opacity: 0.85, animation: `vmh-wave 1.5s ease-in-out ${(i * 0.06).toFixed(2)}s infinite` }} />
            ))}
          </div>
          <div style={{ display: 'flex', gap: 4, alignSelf: 'center' }}>
            {[0, 1, 2].map(i => <Music2 key={i} size={16} style={{ color: 'var(--accent)', animation: `vmh-note 2.4s ease-in-out ${(i * 0.35).toFixed(2)}s infinite` }} />)}
          </div>
        </div>
        <div aria-hidden style={{ display: 'flex', gap: 2, marginBottom: 22 }}>
          {KEYS.map((black, i) => <span key={i} style={{ width: 14, height: black ? 18 : 28, borderRadius: '0 0 3px 3px', background: black ? 'var(--text-primary)' : 'var(--bg-elevated, #26262f)', border: '1px solid var(--border)' }} />)}
        </div>

        <button type="button" onClick={onStart} className="vmh-cta"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 9, padding: '13px 24px', borderRadius: 12, border: 'none', background: 'var(--accent)', color: '#0e0d12', fontSize: 16, fontWeight: 850, cursor: 'pointer', boxShadow: '0 6px 20px rgba(0,0,0,0.25)' }}>
          <Mic size={18} /> Record your voice
        </button>
      </section>

      {recent.length > 0 && (
        <section>
          <h2 style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', margin: '0 0 12px' }}>Recent takes</h2>
          <div style={{ display: 'grid', gap: 8 }}>
            {recent.map(e => (
              <div key={e.id} className="vmh-card" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 13, border: '1px solid var(--border)', background: 'var(--bg-card)' }}>
                <span style={{ display: 'grid', placeItems: 'center', width: 38, height: 38, borderRadius: 10, background: 'var(--bg-base)', color: 'var(--accent)', flexShrink: 0 }}><Music2 size={17} /></span>
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

      <p style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 24, textAlign: 'center', lineHeight: 1.55 }}>Pitch detection runs entirely in your browser — nothing is recorded or uploaded. Add a metronome and quantize to lock it to the beat.</p>
    </main>
  )
}
