'use client'

// Hear Sheet Music — its own home screen. Identity: a musical staff where notes land on
// the lines under a sweeping playhead. Distinct to this app (not a shared template).
import { Upload, FileMusic, Play, ArrowRight } from 'lucide-react'
import { useAppShell } from '@/components/apps/AppChrome'
import { relTime } from '@/lib/app-history'

// [x% across, line index 0..8 (lines+spaces)]
const NOTES: [number, number][] = [[8, 6], [20, 5], [30, 3], [42, 4], [52, 2], [64, 5], [74, 3], [86, 1]]
const STAFF_LINES = 5

export default function SheetMusicHome({ onStart }: { onStart: () => void }) {
  const { history } = useAppShell()
  const recent = history.entries

  return (
    <main id="main" style={{ maxWidth: 620, margin: '0 auto', padding: '18px 18px 56px' }}>
      <style>{`
        @keyframes sm-sweep { 0% { left: 2% } 100% { left: 96% } }
        @keyframes sm-pop { 0%,100% { transform: scale(1) } 50% { transform: scale(1.35); filter: brightness(1.4) } }
        .sm-cta:active { transform: scale(.98) }
        .sm-card { transition: transform .14s ease, border-color .18s ease }
        .sm-card:hover { transform: translateY(-2px); border-color: var(--accent) }
      `}</style>

      <section style={{ position: 'relative', overflow: 'hidden', borderRadius: 20, border: '1px solid var(--border)', background: 'linear-gradient(170deg, var(--bg-card), var(--bg-base))', padding: '26px 22px 24px', marginBottom: 26 }}>
        <p style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--accent)', margin: '0 0 10px' }}>Score → Sound</p>
        <h1 style={{ fontSize: 33, fontWeight: 850, letterSpacing: '-0.03em', color: 'var(--text-primary)', margin: '0 0 8px', lineHeight: 1.06 }}>Hear Sheet Music</h1>
        <p style={{ fontSize: 15, color: 'var(--text-secondary)', lineHeight: 1.55, margin: '0 0 22px', maxWidth: '42ch' }}>
          Upload a photo, PDF, or MusicXML of a score and it reads the notes and plays them on any instrument — then open it in the studio.
        </p>

        {/* motif: a staff with notes + a sweeping playhead */}
        <div style={{ position: 'relative', height: 92, borderRadius: 12, background: 'var(--bg-base)', border: '1px solid var(--border)', overflow: 'hidden', marginBottom: 22 }}>
          {Array.from({ length: STAFF_LINES }).map((_, i) => (
            <span key={i} style={{ position: 'absolute', left: 14, right: 14, top: `${25 + i * 12}%`, height: 1.5, background: 'var(--border)' }} />
          ))}
          {NOTES.map(([x, line], i) => (
            <span key={i} style={{ position: 'absolute', left: `${x}%`, top: `${25 + line * 6}%`, width: 12, height: 9, marginTop: -4.5, borderRadius: '50%', background: 'var(--accent)', animation: `sm-pop 2.6s ease-in-out ${(i * 0.18).toFixed(2)}s infinite` }} />
          ))}
          <span aria-hidden style={{ position: 'absolute', top: 8, bottom: 8, width: 2, background: 'rgba(255,255,255,0.65)', boxShadow: '0 0 10px 2px var(--accent)', animation: 'sm-sweep 3s linear infinite' }} />
        </div>

        <button type="button" onClick={onStart} className="sm-cta"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 9, padding: '13px 24px', borderRadius: 12, border: 'none', background: 'var(--accent)', color: '#0e0d12', fontSize: 16, fontWeight: 850, cursor: 'pointer', boxShadow: '0 6px 20px rgba(0,0,0,0.25)' }}>
          <Upload size={18} /> Upload a score
        </button>
      </section>

      {recent.length > 0 && (
        <section>
          <h2 style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', margin: '0 0 12px' }}>Recent</h2>
          <div style={{ display: 'grid', gap: 8 }}>
            {recent.map(e => (
              <div key={e.id} className="sm-card" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 13, border: '1px solid var(--border)', background: 'var(--bg-card)' }}>
                <span style={{ display: 'grid', placeItems: 'center', width: 38, height: 38, borderRadius: 10, background: 'var(--bg-base)', color: 'var(--accent)', flexShrink: 0 }}><FileMusic size={17} /></span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.title}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{[e.subtitle, relTime(e.ts)].filter(Boolean).join(' · ')}</div>
                </div>
                <button type="button" onClick={onStart} aria-label="Open" style={{ display: 'grid', placeItems: 'center', width: 34, height: 34, borderRadius: 9, background: 'var(--bg-base)', border: '1px solid var(--border)', color: 'var(--text-secondary)', cursor: 'pointer', flexShrink: 0 }}><Play size={15} /></button>
              </div>
            ))}
          </div>
        </section>
      )}

      <p style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 24, textAlign: 'center', lineHeight: 1.55 }}>Reads the notes on-device. Choose any instrument to play it back, then export WAV/MIDI or open the piece in the studio.</p>
    </main>
  )
}
