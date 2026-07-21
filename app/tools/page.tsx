import type { Metadata } from 'next'
import Link from 'next/link'
import { Guitar, Gauge, Piano, ArrowRight, Search, RefreshCw, Grid3x3, Timer, Ear, Mic } from 'lucide-react'

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
  {
    href: '/tools/bpm-key-finder',
    icon: Search,
    title: 'BPM & Key Finder',
    hook: 'Drop in a song, get its tempo and key',
    blurb: 'Detects the BPM and musical key of any audio file, right in your browser. Nothing gets uploaded.',
    from: '#fbbf24', to: '#f59e0b',
  },
  {
    href: '/tools/chord-identifier',
    icon: Piano,
    title: 'Chord Identifier',
    hook: 'Click the notes, it names the chord',
    blurb: 'Build a chord on the piano and it tells you what it is — sevenths, extensions, and inversions included.',
    from: '#a78bfa', to: '#7c3aed',
  },
  {
    href: '/tools/circle-of-fifths',
    icon: RefreshCw,
    title: 'Circle of Fifths',
    hook: 'Hear every key and its chords',
    blurb: 'An interactive circle of fifths — click a key to hear it, see its relative minor, and play the chords in it.',
    from: '#f472b6', to: '#ec4899',
  },
  {
    href: '/tools/scales',
    icon: Grid3x3,
    title: 'Guitar Scales',
    hook: 'Any scale, any key, on the neck',
    blurb: 'An interactive fretboard for every scale — major, minor, pentatonic, blues, and the modes. Click to hear.',
    from: '#fb923c', to: '#ea580c',
  },
  {
    href: '/tools/ear-training',
    icon: Ear,
    title: 'Ear Trainer',
    hook: 'Name the interval you hear',
    blurb: 'Hear two notes and name the distance — ascending, descending, or harmonic. Tracks your score.',
    from: '#38bdf8', to: '#0ea5e9',
  },
  {
    href: '/tools/vocal-range',
    icon: Mic,
    title: 'Vocal Range Finder',
    hook: 'Sing low and high, find your range',
    blurb: 'Sing your lowest and highest notes and it finds your range and closest voice type. Nothing recorded.',
    from: '#c084fc', to: '#9333ea',
  },
  {
    href: '/tools/delay-calculator',
    icon: Timer,
    title: 'Delay Calculator',
    hook: 'BPM to delay time in milliseconds',
    blurb: 'Every note value in ms for your tempo — straight, dotted, and triplet. Tap a value to copy it.',
    from: '#2dd4bf', to: '#0d9488',
  },
]

export default function ToolsIndex() {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)' }}>
      <main id="main" className="max-w-4xl mx-auto px-6 py-14">
        <nav style={{ marginBottom: 28 }}>
          <Link href="/" style={{ fontSize: 13, color: 'var(--text-muted)', textDecoration: 'none' }}>← 100Lights</Link>
        </nav>

        <header style={{ marginBottom: 32 }}>
          <h1 style={{ fontSize: 38, fontWeight: 800, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.02em' }}>
            100Lights Tools
          </h1>
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
