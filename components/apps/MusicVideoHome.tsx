'use client'

// Lightning Bug — its own home screen. Identity: a live audio spectrum (reactive bars).
// Distinct to this app (not a shared template).
import { useRef } from 'react'
import { Film, Radio, Upload, Play } from 'lucide-react'
import { useAppShell } from '@/components/apps/AppChrome'
import { relTime } from '@/lib/app-history'

const BARS = 28

export default function MusicVideoHome({ busy, onFile, onLive }: { busy: boolean; onFile: (f: File) => void; onLive: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const { history } = useAppShell()
  const recent = history.entries

  return (
    <main id="main" style={{ maxWidth: 620, margin: '0 auto', padding: '18px 18px 56px' }}>
      <style>{`
        @keyframes mvh-eq { 0%,100% { transform: scaleY(.18) } 50% { transform: scaleY(1) } }
        .mvh-tile { transition: transform .14s ease, border-color .18s ease, background .18s ease }
        .mvh-tile:hover { transform: translateY(-2px); border-color: var(--accent) }
        .mvh-tile:active { transform: scale(.99) }
      `}</style>

      <section style={{ position: 'relative', overflow: 'hidden', borderRadius: 20, border: '1px solid var(--border)', background: 'linear-gradient(180deg, var(--bg-card), var(--bg-base))', padding: '26px 22px 22px', marginBottom: 22 }}>
        <p style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--accent)', margin: '0 0 10px' }}>Music → Light</p>
        <h1 style={{ fontSize: 33, fontWeight: 850, letterSpacing: '-0.03em', color: 'var(--text-primary)', margin: '0 0 8px', lineHeight: 1.06 }}>Lightning Bug</h1>
        <p style={{ fontSize: 15, color: 'var(--text-secondary)', lineHeight: 1.55, margin: '0 0 22px', maxWidth: '42ch' }}>
          Put reactive visuals on a video, or turn the room’s music into a live show for a party — all on your device, no AI.
        </p>

        {/* motif: a reactive spectrum */}
        <div aria-hidden style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: 4, height: 84, padding: '0 8px', borderRadius: 12, background: 'var(--bg-base)', border: '1px solid var(--border)' }}>
          {Array.from({ length: BARS }).map((_, i) => {
            const d = Math.abs(i - BARS / 2) / (BARS / 2)
            return <span key={i} style={{ width: 6, height: `${70 - d * 40}%`, borderRadius: 3, background: 'var(--accent)', transformOrigin: 'bottom', opacity: 0.55 + (1 - d) * 0.45, animation: `mvh-eq ${(0.9 + d * 0.6).toFixed(2)}s ease-in-out ${(i * 0.04).toFixed(2)}s infinite` }} />
          })}
        </div>
      </section>

      <div style={{ display: 'grid', gap: 12, marginBottom: recent.length ? 26 : 0 }}>
        <button type="button" onClick={() => inputRef.current?.click()} className="mvh-tile"
          style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '18px 18px', borderRadius: 16, cursor: busy ? 'wait' : 'pointer', textAlign: 'left', border: '1px solid var(--border)', background: 'var(--bg-card)' }}>
          <span style={{ display: 'grid', placeItems: 'center', width: 46, height: 46, borderRadius: 12, background: 'var(--accent)', color: '#0e0d12', flexShrink: 0 }}><Film size={22} /></span>
          <span style={{ minWidth: 0 }}>
            <span style={{ display: 'block', fontSize: 16, fontWeight: 800, color: 'var(--text-primary)' }}>Add a video</span>
            <span style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', gap: 5 }}><Upload size={13} /> Its melody becomes a synced visual overlay · MP4 · MOV · WebM</span>
          </span>
          <input ref={inputRef} type="file" accept="video/*,.mp4,.mov,.webm,.m4v" hidden onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); e.currentTarget.value = '' }} />
        </button>

        <button type="button" onClick={onLive} className="mvh-tile"
          style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '18px 18px', borderRadius: 16, cursor: 'pointer', textAlign: 'left', border: '1px solid var(--border)', background: 'var(--bg-card)' }}>
          <span style={{ display: 'grid', placeItems: 'center', width: 46, height: 46, borderRadius: 12, background: 'var(--bg-base)', color: 'var(--accent)', flexShrink: 0 }}><Radio size={22} /></span>
          <span style={{ minWidth: 0 }}>
            <span style={{ display: 'block', fontSize: 16, fontWeight: 800, color: 'var(--text-primary)' }}>Live visuals (party mode)</span>
            <span style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)' }}>React to the room’s music — full-screen it on a TV or projector.</span>
          </span>
        </button>
      </div>

      {recent.length > 0 && (
        <section>
          <h2 style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', margin: '0 0 12px' }}>Recent</h2>
          <div style={{ display: 'grid', gap: 8 }}>
            {recent.map(e => (
              <div key={e.id} className="mvh-tile" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 13, border: '1px solid var(--border)', background: 'var(--bg-card)' }}>
                <span style={{ display: 'grid', placeItems: 'center', width: 38, height: 38, borderRadius: 10, background: 'var(--bg-base)', color: 'var(--accent)', flexShrink: 0 }}><Play size={16} /></span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.title}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{[e.subtitle, relTime(e.ts)].filter(Boolean).join(' · ')}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <p style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 22, textAlign: 'center', lineHeight: 1.55 }}>Everything runs on your device — no upload, no AI. Tweak colors, fonts, and the visual style freely.</p>
    </main>
  )
}
