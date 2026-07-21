import type { Metadata } from 'next'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import ToolShell from '@/components/tools/ToolShell'

const ChordIdentifier = dynamic(() => import('@/components/tools/ChordIdentifier'))

export const metadata: Metadata = {
  title: 'Chord Identifier — Name Any Chord From the Notes, Free',
  description: 'A free chord identifier. Click the notes on a piano and it names the chord — major, minor, 7ths, extensions, and inversions. Hear it too. No download, no sign-up.',
  alternates: { canonical: 'https://100lights.com/tools/chord-identifier' },
  openGraph: {
    title: 'Chord Identifier — 100Lights',
    description: 'Click notes on a piano and it names the chord. Free, in your browser.',
    url: 'https://100lights.com/tools/chord-identifier',
    type: 'website',
    siteName: '100Lights',
  },
}

export default function ChordIdentifierPage() {
  return (
    <ToolShell
      title="Chord identifier"
      intro="Click the notes on the piano and it names the chord you've built — including sevenths, extensions, and inversions. Every note you add plays, so you hear the chord take shape."
      studioLabel="Write chords in the studio"
    >
      <ChordIdentifier />
      <div style={{ marginTop: 26, fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 8px' }}>How to use it</h2>
        <p style={{ margin: '0 0 10px' }}>
          Click any keys to select them — the name appears the moment you have two or more. It reads inversions too: play C, E, G and you get C major; play E, G, C and it&rsquo;ll tell you it&rsquo;s a C major with E in the bass. Tap a selected key again to remove it.
        </p>
        <p style={{ margin: 0 }}>
          Working the other way — you know the chord name and want the notes? The <Link href="/tools/chord-progressions" style={{ color: '#a78bfa', textDecoration: 'underline', textUnderlineOffset: 3 }}>Chord Teacher</Link> shows every chord on any root, ready to play.
        </p>
      </div>
    </ToolShell>
  )
}
