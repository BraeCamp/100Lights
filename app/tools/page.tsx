import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Free Music Tools — Tuner, Metronome, Chord Generator',
  description: 'Free browser music tools from 100Lights: an online tuner, a metronome with tap tempo, and a chord progression generator. No downloads, no sign-up.',
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
  { href: '/tools/tuner', title: 'Online Tuner', blurb: 'Tune any instrument or your voice by ear, straight from your mic. Shows the note and how many cents sharp or flat.' },
  { href: '/tools/metronome', title: 'Metronome', blurb: 'A clean metronome with tap tempo, adjustable time signature, and a visual beat. 30 to 300 BPM.' },
  { href: '/tools/chord-progressions', title: 'Chord Progression Generator', blurb: 'Hear the progressions behind a thousand songs, transpose them to any key, and download the MIDI.' },
]

export default function ToolsIndex() {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)' }}>
      <main id="main" className="max-w-2xl mx-auto px-6 py-14">
        <nav style={{ marginBottom: 24 }}>
          <Link href="/" style={{ fontSize: 13, color: 'var(--text-muted)', textDecoration: 'none' }}>← 100Lights</Link>
        </nav>
        <header style={{ marginBottom: 30 }}>
          <h1 style={{ fontSize: 34, fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 10px', letterSpacing: '-0.02em' }}>Free music tools</h1>
          <p style={{ fontSize: 15, color: 'var(--text-secondary)', lineHeight: 1.65, margin: 0 }}>
            Small, focused tools that run in your browser — no downloads, no sign-up. Each one is a piece of the full 100Lights studio.
          </p>
        </header>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {TOOLS.map(t => (
            <Link key={t.href} href={t.href} style={{
              display: 'block', textDecoration: 'none', padding: '18px 20px', borderRadius: 14,
              border: '1px solid var(--border)', background: 'var(--bg-card)',
            }}>
              <h2 style={{ fontSize: 17, fontWeight: 750, color: 'var(--text-primary)', margin: '0 0 5px', letterSpacing: '-0.01em' }}>{t.title}</h2>
              <p style={{ fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0 }}>{t.blurb}</p>
            </Link>
          ))}
        </div>
      </main>
    </div>
  )
}
