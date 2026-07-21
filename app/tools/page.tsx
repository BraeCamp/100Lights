import type { Metadata } from 'next'
import Link from 'next/link'
import { Guitar, Gauge, Piano, ArrowRight, Sparkles } from 'lucide-react'

export const metadata: Metadata = {
  title: 'Free Music Tools — Tuner, Metronome, Chord Teacher',
  description: 'Free browser music tools from 100Lights: an online tuner, a metronome with tempo trainer, and a chord teacher for progressions and every chord. No downloads, no sign-up.',
  alternates: { canonical: 'https://100lights.com/tools' },
  openGraph: {
    title: '100Lights — Free Music Tools',
    description: 'A tuner, a metronome, and a chord progression generator that run in your browser. Free, no sign-up.',
    url: 'https://100lights.com/tools',
    type: 'website',
    siteName: '100Lights',
  },
}

const TOOLS = [
  {
    href: '/tools/tuner',
    icon: Guitar,
    title: 'Online Tuner',
    hook: 'Sing or play — it names the note',
    blurb: 'Tune any instrument or your own voice from your mic. Shows the note and how many cents sharp or flat, live.',
    from: '#f472b6', to: '#a855f7',
  },
  {
    href: '/tools/metronome',
    icon: Gauge,
    title: 'Metronome',
    hook: 'Tap along and it finds the tempo',
    blurb: 'A rock-steady click with tap tempo, adjustable time signature, and a visual beat. 30 to 300 BPM.',
    from: '#38bdf8', to: '#3b82f6',
  },
  {
    href: '/tools/chord-progressions',
    icon: Piano,
    title: 'Chord Teacher',
    hook: 'Every chord, played and explained',
    blurb: 'The progressions behind a thousand songs — play them, transpose with a click, and download the MIDI.',
    from: '#34d399', to: '#10b981',
  },
]

export default function ToolsIndex() {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)' }}>
      <main id="main" className="max-w-4xl mx-auto px-6 py-14">
        <nav style={{ marginBottom: 28 }}>
          <Link href="/" style={{ fontSize: 13, color: 'var(--text-muted)', textDecoration: 'none' }}>← 100Lights</Link>
        </nav>

        <header style={{ textAlign: 'center', marginBottom: 44 }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 16,
            fontSize: 12, fontWeight: 600, padding: '5px 12px', borderRadius: 99,
            color: 'var(--accent-light)', background: 'var(--accent-subtle)', border: '1px solid rgba(139,92,246,0.25)',
          }}>
            <Sparkles size={12} /> Free · no sign-up · in your browser
          </div>
          <h1 style={{ fontSize: 42, fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 14px', letterSpacing: '-0.03em', lineHeight: 1.05 }}>
            Little tools that{' '}
            <span style={{ background: 'linear-gradient(135deg, #8b5cf6, #3b82f6)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              pull their weight
            </span>
          </h1>
          <p style={{ fontSize: 16, color: 'var(--text-secondary)', lineHeight: 1.6, margin: '0 auto', maxWidth: 520 }}>
            Each one does a single thing well — and each is a genuine piece of the full 100Lights studio, not a demo.
          </p>
        </header>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
          {TOOLS.map(t => {
            const Icon = t.icon
            return (
              <Link key={t.href} href={t.href} className="tool-card" style={{
                position: 'relative', display: 'flex', flexDirection: 'column', textDecoration: 'none',
                padding: '24px 22px', borderRadius: 18, overflow: 'hidden',
                border: '1px solid var(--border)', background: 'var(--bg-card)',
              }}>
                {/* Colour wash top-corner */}
                <div aria-hidden="true" style={{
                  position: 'absolute', top: -40, right: -40, width: 120, height: 120, borderRadius: '50%',
                  background: `radial-gradient(circle, ${t.from}33, transparent 70%)`,
                }} />
                <div style={{
                  width: 48, height: 48, borderRadius: 13, marginBottom: 16,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: `linear-gradient(135deg, ${t.from}, ${t.to})`, color: '#fff',
                }}>
                  <Icon size={24} />
                </div>
                <h2 style={{ fontSize: 19, fontWeight: 750, color: 'var(--text-primary)', margin: '0 0 4px', letterSpacing: '-0.01em' }}>{t.title}</h2>
                <p style={{ fontSize: 13, fontWeight: 600, color: t.to, margin: '0 0 10px' }}>{t.hook}</p>
                <p style={{ fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.6, margin: '0 0 16px', flex: 1 }}>{t.blurb}</p>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
                  Open <ArrowRight size={14} />
                </span>
              </Link>
            )
          })}
        </div>

        <aside style={{
          marginTop: 32, padding: '22px 24px', borderRadius: 16, textAlign: 'center',
          background: 'linear-gradient(135deg, rgba(124,58,237,0.10), rgba(59,130,246,0.06))',
          border: '1px solid rgba(139,92,246,0.25)',
        }}>
          <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 4px' }}>These are the warm-up.</p>
          <p style={{ fontSize: 13.5, color: 'var(--text-secondary)', margin: '0 0 16px', lineHeight: 1.55 }}>
            The full studio is a browser DAW — record, sequence, mix, and finish a whole track. Free to start.
          </p>
          <Link href="/new?modules=audio" style={{
            display: 'inline-block', padding: '11px 24px', borderRadius: 11,
            background: 'var(--accent)', color: '#fff', fontSize: 14, fontWeight: 700, textDecoration: 'none',
          }}>Open the studio</Link>
        </aside>
      </main>

      <style>{`
        .tool-card { transition: transform 0.15s ease, border-color 0.15s ease; }
        .tool-card:hover { transform: translateY(-3px); border-color: var(--border-light); }
      `}</style>
    </div>
  )
}
