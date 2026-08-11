'use client'

// Beat Maker — the app's own home screen (distinct to this app, not a shared template).
// A drum-machine identity: a live sequencer motif up top, one big "New beat", quick
// grooves to start from, and your saved beats. Reads saved work from the shell History.
import { Plus, Play, Trash2, ArrowRight } from 'lucide-react'
import { useAppShell } from '@/components/apps/AppChrome'
import { relTime } from '@/lib/app-history'
import { DRUM_PATTERNS } from '@/lib/drum-presets'
import type { BeatData } from '@/components/apps/BeatMaker'

// A tiny 3-lane sequencer with a sweeping playhead — the visual signature of the app.
const HERO_ROWS: { label: string; hits: number[] }[] = [
  { label: 'Hat', hits: [0, 2, 4, 6, 8, 10, 12, 14] },
  { label: 'Snare', hits: [4, 12] },
  { label: 'Kick', hits: [0, 6, 10] },
]
const HERO_STEPS = 16

export default function BeatMakerHome({ onNew, onPreset, onOpen }: {
  onNew: () => void
  onPreset: (id: string) => void
  onOpen: (data: BeatData) => void
}) {
  const { history } = useAppShell()
  const beats = history.entries

  return (
    <main id="main" style={{ maxWidth: 640, margin: '0 auto', padding: '18px 18px 56px' }}>
      <style>{`
        @keyframes bmh-sweep { 0% { left: 0 } 100% { left: calc(100% - 3px) } }
        @keyframes bmh-hit { 0%,100% { transform: scale(1); filter: brightness(1) } 50% { transform: scale(1.18); filter: brightness(1.4) } }
        .bmh-play:active { transform: scale(.97) }
        .bmh-card { transition: transform .14s ease, border-color .18s ease, background .18s ease }
        .bmh-card:hover { transform: translateY(-2px); border-color: var(--accent) }
      `}</style>

      {/* Hero */}
      <section style={{ position: 'relative', overflow: 'hidden', borderRadius: 20, border: '1px solid var(--border)', background: 'linear-gradient(160deg, var(--bg-card), var(--bg-base))', padding: '26px 22px 24px', marginBottom: 26 }}>
        <p style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--accent)', margin: '0 0 10px' }}>Drum Machine</p>
        <h1 style={{ fontSize: 34, fontWeight: 850, letterSpacing: '-0.03em', color: 'var(--text-primary)', margin: '0 0 8px', lineHeight: 1.05 }}>Beat Maker</h1>
        <p style={{ fontSize: 15, color: 'var(--text-secondary)', lineHeight: 1.55, margin: '0 0 20px', maxWidth: '42ch' }}>
          Tap out a groove on the step grid, pick a kit, and loop it. The fastest path from an empty page to a beat — export to any DAW when it&rsquo;s done.
        </p>

        {/* live sequencer motif */}
        <div style={{ position: 'relative', display: 'inline-flex', flexDirection: 'column', gap: 5, padding: 12, borderRadius: 12, background: 'var(--bg-base)', border: '1px solid var(--border)', marginBottom: 22, maxWidth: '100%', overflow: 'hidden' }}>
          {HERO_ROWS.map((row, r) => (
            <div key={r} style={{ display: 'flex', gap: 3 }}>
              {Array.from({ length: HERO_STEPS }).map((_, s) => {
                const on = row.hits.includes(s)
                return <span key={s} style={{ width: 11, height: 11, borderRadius: 3, background: on ? 'var(--accent)' : 'var(--bg-elevated, #20202a)', animation: on ? `bmh-hit 1.6s ease-in-out ${(s * 0.05).toFixed(2)}s infinite` : undefined }} />
              })}
            </div>
          ))}
          <span aria-hidden style={{ position: 'absolute', top: 6, bottom: 6, width: 3, borderRadius: 2, background: 'rgba(255,255,255,0.7)', boxShadow: '0 0 10px 2px var(--accent)', animation: 'bmh-sweep 2.4s linear infinite' }} />
        </div>

        <div>
          <button type="button" onClick={onNew} className="bmh-play"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 9, padding: '13px 24px', borderRadius: 12, border: 'none', background: 'var(--accent)', color: '#0e0d12', fontSize: 16, fontWeight: 850, cursor: 'pointer', boxShadow: '0 6px 20px rgba(0,0,0,0.25)' }}>
            <Plus size={19} /> New beat
          </button>
        </div>
      </section>

      {/* Quick start from a groove */}
      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', margin: '0 0 12px' }}>Start from a groove</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {DRUM_PATTERNS.slice(0, 8).map(p => (
            <button key={p.id} type="button" onClick={() => onPreset(p.id)} className="bmh-play"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 14px', borderRadius: 999, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-secondary)', fontSize: 13.5, fontWeight: 700, cursor: 'pointer' }}>
              <Play size={13} style={{ color: 'var(--accent)' }} /> {p.name}
            </button>
          ))}
        </div>
      </section>

      {/* Your beats */}
      <section>
        <h2 style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', margin: '0 0 12px' }}>Your beats</h2>
        {beats.length === 0 ? (
          <div style={{ padding: '22px 18px', borderRadius: 14, border: '1px dashed var(--border)', background: 'var(--bg-card)', textAlign: 'center' }}>
            <p style={{ fontSize: 14, color: 'var(--text-secondary)', margin: 0 }}>Beats you save land here — start one above and hit <strong style={{ color: 'var(--text-primary)' }}>Save</strong> when it grooves.</p>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {beats.map(b => (
              <div key={b.id} className="bmh-card" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 13, border: '1px solid var(--border)', background: 'var(--bg-card)' }}>
                <span style={{ display: 'grid', placeItems: 'center', width: 40, height: 40, borderRadius: 10, background: 'var(--bg-base)', color: 'var(--accent)', flexShrink: 0 }}><Play size={17} /></span>
                <button type="button" onClick={() => onOpen(b.data as BeatData)} style={{ flex: 1, minWidth: 0, textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.title}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{[b.subtitle, relTime(b.ts)].filter(Boolean).join(' · ')}</div>
                </button>
                <button type="button" onClick={() => onOpen(b.data as BeatData)} aria-label="Open" style={{ display: 'grid', placeItems: 'center', width: 34, height: 34, borderRadius: 9, background: 'var(--bg-base)', border: '1px solid var(--border)', color: 'var(--text-secondary)', cursor: 'pointer', flexShrink: 0 }}><ArrowRight size={16} /></button>
                <button type="button" onClick={() => history.remove(b.id)} aria-label="Delete" style={{ display: 'grid', placeItems: 'center', width: 34, height: 34, borderRadius: 9, background: 'var(--bg-base)', border: '1px solid var(--border)', color: 'var(--text-muted)', cursor: 'pointer', flexShrink: 0 }}><Trash2 size={15} /></button>
              </div>
            ))}
          </div>
        )}
      </section>

      <p style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 28, textAlign: 'center' }}>Runs in your browser · export MIDI/WAV to any DAW · your beats sync to your account when you sign in.</p>
    </main>
  )
}
