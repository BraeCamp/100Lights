import type { Metadata } from 'next'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import ToolShell from '@/components/tools/ToolShell'

const BpmKeyFinder = dynamic(() => import('@/components/tools/BpmKeyFinder'))

export const metadata: Metadata = {
  title: 'BPM & Key Finder — Free Song Tempo and Key Detector',
  description: 'A free BPM and key finder. Drop in an audio file and it detects the tempo and musical key of the song, right in your browser. Nothing is uploaded. No sign-up.',
  alternates: { canonical: 'https://100lights.com/tools/bpm-key-finder' },
  openGraph: {
    title: 'BPM & Key Finder — 100Lights',
    description: "Drop in a song and find its BPM and key. Free, and the file never leaves your device.",
    url: 'https://100lights.com/tools/bpm-key-finder',
    type: 'website',
    siteName: '100Lights',
  },
}

export default function BpmKeyFinderPage() {
  return (
    <ToolShell
      title="BPM & key finder"
      intro="Drop in a track and it works out the tempo and the key. Everything happens in your browser — the file is never uploaded, so it works on anything, including your own unreleased demos."
      studioLabel="Open a project in the studio"
    >
      <BpmKeyFinder />
      <div style={{ marginTop: 26, fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 8px' }}>How it works</h2>
        <p style={{ margin: '0 0 10px' }}>
          Drag an audio file onto the box, or click to choose one. It decodes the audio and analyses the first stretch of the song: the tempo comes from the spacing of the beats, and the key from which notes turn up most. Both are estimates — a strong starting point, not a certified answer.
        </p>
        <p style={{ margin: '0 0 10px' }}>
          A couple of honest caveats: tempo detection can land on half or double the real BPM on tracks with a busy or a sparse beat, so if 85 looks wrong, try 170. And key detection leans on there being a clear tonal centre — it&rsquo;s confident on most songs and hedges when a track is ambiguous.
        </p>
        <p style={{ margin: 0 }}>
          Once you know the key, the <Link href="/tools/chord-progressions" style={{ color: '#a78bfa', textDecoration: 'underline', textUnderlineOffset: 3 }}>Chord Teacher</Link> will show you every chord that fits it, and the <Link href="/tools/metronome" style={{ color: '#a78bfa', textDecoration: 'underline', textUnderlineOffset: 3 }}>metronome</Link> will hold the tempo while you play along.
        </p>
      </div>
    </ToolShell>
  )
}
