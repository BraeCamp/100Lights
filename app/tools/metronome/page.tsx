import type { Metadata } from 'next'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import ToolShell from '@/components/tools/ToolShell'

const Metronome = dynamic(() => import('@/components/tools/Metronome'))

// Popular jump-off tempos, deep-linking into the per-tempo pages.
const COMMON = [60, 80, 90, 100, 110, 120, 128, 140, 160, 174]

export const metadata: Metadata = {
  title: 'Online Metronome — Free, with Tap Tempo & Tempo Trainer',
  description: 'A free online metronome with tap tempo, a tempo trainer that speeds up as you play, subdivisions, and editable accents. 20–400 BPM, in your browser. No download.',
  alternates: { canonical: 'https://100lights.com/tools/metronome' },
  openGraph: {
    title: 'Free Online Metronome — 100Lights',
    description: 'A clean metronome with tap tempo and a visual beat. Free, in your browser.',
    url: 'https://100lights.com/tools/metronome',
    type: 'website',
    siteName: '100Lights',
  },
}

export default function MetronomePage() {
  return (
    <ToolShell
      title="Metronome"
      intro="A clean, accurate metronome that runs in your browser — with a tempo trainer that speeds up as you play, subdivisions, and beats you can accent, quiet, or silence. Set the tempo by dragging, tapping, typing, or the arrow keys."
    >
      <Metronome />

      <div style={{ marginTop: 22 }}>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 8 }}>Jump to a tempo</div>
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
          {COMMON.map(b => (
            <Link key={b} href={`/tools/metronome/${b}`} style={{
              fontSize: 12.5, fontWeight: 700, padding: '5px 12px', borderRadius: 99, textDecoration: 'none',
              border: '1px solid var(--border)', color: 'var(--text-secondary)', background: 'var(--bg-card)',
            }}>{b} BPM</Link>
          ))}
        </div>
      </div>

      <div style={{ marginTop: 26, fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 8px' }}>How to use it</h2>
        <p style={{ margin: '0 0 10px' }}>
          Hit <strong>Start</strong> — or just press the spacebar. The dots light up on each beat, with the downbeat a different colour. Click a dot to accent, quiet, or silence that beat, which is how you set up odd meters like 5/4 or 7/8. Don&rsquo;t know a song&rsquo;s tempo? Tap the <strong>TAP</strong> button along with it, or click the big number to type it in.
        </p>
        <p style={{ margin: '0 0 10px' }}>
          The <strong>tempo trainer</strong> is the real practice tool: set a starting tempo and a target, and it climbs a few BPM at a time as you play. That&rsquo;s how you build speed without drilling your mistakes faster — start slow enough that it&rsquo;s always clean, and let the tempo come to you. Turn on <strong>subdivisions</strong> to hear the eighths or sixteenths between beats when you&rsquo;re tightening up fast passages.
        </p>
        <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-muted)' }}>
          Every click is scheduled against the audio clock, so it stays rock-steady and won&rsquo;t drift the way a simple timer would.
        </p>
      </div>
    </ToolShell>
  )
}
