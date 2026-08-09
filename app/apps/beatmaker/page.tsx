import type { Metadata } from 'next'
import dynamic from 'next/dynamic'

const BeatMaker = dynamic(() => import('@/components/apps/BeatMaker'))

export const metadata: Metadata = {
  title: 'Beat Maker — Free Online Drum Machine & Step Sequencer',
  description: 'Make a beat in your browser: tap out a groove on the step grid, pick a drum kit, load a pattern, set the tempo, and export your loop as MIDI or WAV. Free, no download.',
  alternates: { canonical: 'https://100lights.com/apps/beatmaker' },
  openGraph: {
    title: 'Beat Maker — 100Lights',
    description: 'A free browser drum machine: step grid, drum kits, pattern presets, tempo, and MIDI/WAV export. No download.',
    url: 'https://100lights.com/apps/beatmaker',
    type: 'website',
    siteName: '100Lights',
  },
}

export default function BeatMakerPage() {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)' }}>
      <main id="main" className="max-w-3xl mx-auto px-6 py-14">
        <header style={{ marginBottom: 28 }}>
          <h1 style={{ fontSize: 32, fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 10px', letterSpacing: '-0.02em' }}>
            Beat Maker
          </h1>
          <p style={{ fontSize: 15, color: 'var(--text-secondary)', lineHeight: 1.65, margin: 0 }}>
            A drum machine in your browser. Click the grid to place hits, pick a kit, load a
            starter groove, and set your tempo. Hit play to hear it loop, then export your beat
            as a MIDI or WAV file to drop into any DAW.
          </p>
        </header>

        <BeatMaker />

        <div style={{ marginTop: 26, fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 8px' }}>How to use it</h2>
          <p style={{ margin: '0 0 10px' }}>
            Each row is a drum. Each column is a 16th-note step across one bar. Click cells to turn
            hits on and off. Choose a <strong>kit</strong> to re-voice the same pattern, or load a
            <strong> preset</strong> to start from a known groove. Set the <strong>tempo</strong>,
            add a little <strong>swing</strong> for feel, and press <strong>Play</strong>. When you
            like it, <strong>Download MIDI</strong> or <strong>Download WAV</strong>.
          </p>
          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-muted)' }}>
            Everything runs in your browser — nothing is uploaded. Your pattern is saved locally so
            it&rsquo;s here when you come back.
          </p>
        </div>
      </main>
    </div>
  )
}
