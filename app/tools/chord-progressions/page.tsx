import type { Metadata } from 'next'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import ToolShell from '@/components/tools/ToolShell'

const ChordTeacher = dynamic(() => import('@/components/tools/ChordTeacher'))

export const metadata: Metadata = {
  title: 'Chord Teacher — Chord Progressions & Every Chord in Any Key',
  description: 'A free chord teacher: hear the progressions behind a thousand songs, browse every chord on any root note, transpose to any key, and download the MIDI.',
  alternates: { canonical: 'https://100lights.com/tools/chord-progressions' },
  openGraph: {
    title: 'Chord Teacher — 100Lights',
    description: 'Hear famous chord progressions, browse every chord in any key, transpose, and download MIDI. Free.',
    url: 'https://100lights.com/tools/chord-progressions',
    type: 'website',
    siteName: '100Lights',
  },
}

export default function ChordTeacherPage() {
  return (
    <ToolShell
      title="Chord Teacher"
      intro="Learn chords by hearing them. The piano at the top plays whatever you pick — a whole progression from the library, or a single chord from every one that exists on a given note. Transpose to any key and take the MIDI with you."
      studioHref="/new?modules=audio"
      studioLabel="Build a track around one"
    >
      <ChordTeacher />
      <div style={{ marginTop: 26, fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 8px' }}>How to use it</h2>
        <p style={{ margin: '0 0 10px' }}>
          Open <strong>Chord progressions</strong> to browse the moves behind a thousand songs, filtered by genre. Click one and it loads onto the piano at the top — hit <strong>Play chords</strong> to hear it, and change the <strong>KEY</strong> to move it wherever suits your voice or song.
        </p>
        <p style={{ margin: '0 0 10px' }}>
          Open <strong>All chords</strong>, pick a root note, and you&rsquo;ll see every common chord built on it — triads, sevenths, and extensions, laid out by row. Tap any one to hear it on the piano and see its notes light up. It&rsquo;s the fastest way to find, say, what a Dm7♭5 actually sounds like.
        </p>
        <p style={{ margin: 0 }}>
          Want to know <em>why</em> these progressions work? The <Link href="/learn/five-chord-progressions-every-producer-should-know" style={{ color: '#a78bfa', textDecoration: 'underline', textUnderlineOffset: 3 }}>five progressions behind most records</Link> breaks down the ones you&rsquo;ll keep coming back to.
        </p>
      </div>
    </ToolShell>
  )
}
