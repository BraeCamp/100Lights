import type { Metadata } from 'next'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import ToolShell from '@/components/tools/ToolShell'

const ChordGenerator = dynamic(() => import('@/components/tools/ChordGenerator'))

export const metadata: Metadata = {
  title: 'Chord Progression Generator — Free, Hear & Transpose Any Key',
  description: 'A free chord progression generator. Hear the progressions behind a thousand songs, transpose them to any key, and download the MIDI. Pop, jazz, blues, and more.',
  alternates: { canonical: 'https://100lights.com/tools/chord-progressions' },
  openGraph: {
    title: 'Free Chord Progression Generator — 100Lights',
    description: 'Hear famous chord progressions, transpose to any key, download the MIDI. Free.',
    url: 'https://100lights.com/tools/chord-progressions',
    type: 'website',
    siteName: '100Lights',
  },
}

export default function ChordProgressionsPage() {
  return (
    <ToolShell
      title="Chord progression generator"
      intro="The chord progressions behind a thousand songs, ready to hear. Pick one, play it on the piano, transpose it to any key with a click, and download the MIDI to drop straight into your own track."
      studioHref="/new?modules=audio"
      studioLabel="Build a track around one"
    >
      <ChordGenerator />
      <div style={{ marginTop: 26, fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 8px' }}>How to use it</h2>
        <p style={{ margin: '0 0 10px' }}>
          Filter by genre, pick a progression, and hit <strong>Play chords</strong> to hear it. The keys light up as it goes. Change the <strong>KEY</strong> to move it into whatever key suits your voice or your song — the progression stays the same, only the pitch changes. Tap any individual key to hear that note on its own.
        </p>
        <p style={{ margin: '0 0 10px' }}>
          When you find one you like, <strong>download the MIDI</strong> and open it in any DAW or notation app. It carries the exact notes in the key you picked, so it&rsquo;s a real starting point rather than a screenshot to copy by hand.
        </p>
        <p style={{ margin: 0 }}>
          Want to know <em>why</em> these work? The <Link href="/learn/five-chord-progressions-every-producer-should-know" style={{ color: '#a78bfa', textDecoration: 'underline', textUnderlineOffset: 3 }}>five progressions behind most records</Link> breaks down the ones you&rsquo;ll keep coming back to.
        </p>
      </div>
    </ToolShell>
  )
}
