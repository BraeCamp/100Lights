'use client'

// Captions — its own home screen. Identity: bold captions animating word-by-word over a
// video frame (the thing the app makes). Distinct to this app (not a shared template).
import { Plus, Captions as CaptionsIcon, ArrowRight, Trash2 } from 'lucide-react'
import { useAppShell } from '@/components/apps/AppChrome'
import { relTime } from '@/lib/app-history'

const WORDS = ['caption', 'every', 'word', 'perfectly']

export default function CaptionsHome({ onNew, onOpen }: { onNew: () => void; onOpen: (data: unknown) => void }) {
  const { history } = useAppShell()
  const recent = history.entries

  return (
    <main id="main" style={{ maxWidth: 620, margin: '0 auto', padding: '18px 18px 56px' }}>
      <style>{`
        @keyframes ch-word { 0%,100% { color: var(--text-muted); transform: translateY(0) } 50% { color: #fff; transform: translateY(-1px) } }
        .ch-cta:active { transform: scale(.98) }
        .ch-card { transition: transform .14s ease, border-color .18s ease }
        .ch-card:hover { transform: translateY(-2px); border-color: var(--accent) }
      `}</style>

      <section style={{ position: 'relative', overflow: 'hidden', borderRadius: 20, border: '1px solid var(--border)', background: 'linear-gradient(160deg, var(--bg-card), var(--bg-base))', padding: '26px 22px 24px', marginBottom: 26 }}>
        <p style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--accent)', margin: '0 0 10px' }}>Speech → Captions</p>
        <h1 style={{ fontSize: 33, fontWeight: 850, letterSpacing: '-0.03em', color: 'var(--text-primary)', margin: '0 0 8px', lineHeight: 1.06 }}>Captions</h1>
        <p style={{ fontSize: 15, color: 'var(--text-secondary)', lineHeight: 1.55, margin: '0 0 22px', maxWidth: '42ch' }}>
          Drop in a video from your camera roll and get clean, animated captions — on-device, editable, and burned right onto the clip.
        </p>

        {/* motif: a video frame with animated captions */}
        <div style={{ position: 'relative', aspectRatio: '16 / 7', borderRadius: 12, background: 'repeating-linear-gradient(135deg, var(--bg-base), var(--bg-base) 10px, var(--bg-elevated, #1b1b22) 10px, var(--bg-elevated, #1b1b22) 20px)', border: '1px solid var(--border)', overflow: 'hidden', marginBottom: 22 }}>
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 14, textAlign: 'center' }}>
            <span style={{ display: 'inline-flex', gap: 8, padding: '6px 12px', borderRadius: 8, background: 'rgba(0,0,0,0.72)', fontSize: 18, fontWeight: 800 }}>
              {WORDS.map((w, i) => <span key={i} style={{ color: 'var(--text-muted)', animation: `ch-word 2.4s ease-in-out ${(i * 0.5).toFixed(2)}s infinite` }}>{w}</span>)}
            </span>
          </div>
        </div>

        <button type="button" onClick={onNew} className="ch-cta"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 9, padding: '13px 24px', borderRadius: 12, border: 'none', background: 'var(--accent)', color: '#0e0d12', fontSize: 16, fontWeight: 850, cursor: 'pointer', boxShadow: '0 6px 20px rgba(0,0,0,0.25)' }}>
          <Plus size={19} /> Caption a video
        </button>
      </section>

      {recent.length > 0 && (
        <section>
          <h2 style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', margin: '0 0 12px' }}>Your captions</h2>
          <div style={{ display: 'grid', gap: 8 }}>
            {recent.map(e => (
              <div key={e.id} className="ch-card" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 13, border: '1px solid var(--border)', background: 'var(--bg-card)' }}>
                <span style={{ display: 'grid', placeItems: 'center', width: 38, height: 38, borderRadius: 10, background: 'var(--bg-base)', color: 'var(--accent)', flexShrink: 0 }}><CaptionsIcon size={17} /></span>
                <button type="button" onClick={() => onOpen(e.data)} style={{ flex: 1, minWidth: 0, textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.title}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{[e.subtitle, relTime(e.ts)].filter(Boolean).join(' · ')}</div>
                </button>
                <button type="button" onClick={() => onOpen(e.data)} aria-label="Open" style={{ display: 'grid', placeItems: 'center', width: 34, height: 34, borderRadius: 9, background: 'var(--bg-base)', border: '1px solid var(--border)', color: 'var(--text-secondary)', cursor: 'pointer', flexShrink: 0 }}><ArrowRight size={16} /></button>
                <button type="button" onClick={() => history.remove(e.id)} aria-label="Delete" style={{ display: 'grid', placeItems: 'center', width: 34, height: 34, borderRadius: 9, background: 'var(--bg-base)', border: '1px solid var(--border)', color: 'var(--text-muted)', cursor: 'pointer', flexShrink: 0 }}><Trash2 size={15} /></button>
              </div>
            ))}
          </div>
          <p style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 10 }}>Opening a saved set restores the words + style — re-add the video to play it.</p>
        </section>
      )}

      <p style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 24, textAlign: 'center', lineHeight: 1.55 }}>Transcribed on your device — nothing is uploaded. Edit the words, animate snippets, export SRT/VTT, or save the captioned video.</p>
    </main>
  )
}
