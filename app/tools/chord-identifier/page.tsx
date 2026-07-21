import type { Metadata } from 'next'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import ToolShell from '@/components/tools/ToolShell'

const ChordTeacher = dynamic(() => import('@/components/tools/ChordTeacher'))

export const metadata: Metadata = {
  title: 'Chord Identifier — Name Any Chord From the Notes, Free',
  description: 'A free chord identifier. Click the notes on a piano and it names the chord — major, minor, 7ths, extensions, and inversions. Part of the 100Lights Chord Teacher.',
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
      intro="Click the notes on the piano and it names the chord you've built — including sevenths, extensions, and inversions. It's the &ldquo;Identify a chord&rdquo; part of the Chord Teacher, which also plays every chord and progression the other way around."
      studioLabel="Write chords in the studio"
    >
      <ChordTeacher defaultSection="identify" />
      <div style={{ marginTop: 26, fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 8px' }}>How to use it</h2>
        <p style={{ margin: '0 0 10px' }}>
          Open <strong>Identify a chord</strong> and click any keys — the name appears the moment you have two or more. It reads inversions too: play C, E, G and you get C major; play E, G, C and it tells you it&rsquo;s C major with E in the bass. Tap a selected key again to remove it.
        </p>
        <p style={{ margin: 0 }}>
          Working the other way — you know the chord name and want the notes? The <Link href="/tools/chord-progressions" style={{ color: '#a78bfa', textDecoration: 'underline', textUnderlineOffset: 3 }}>Chord Teacher</Link> (same tool) shows every chord on any root and the progressions behind a thousand songs, ready to play.
        </p>
      </div>
    </ToolShell>
  )
}
