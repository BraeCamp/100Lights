import type { Metadata } from 'next'
import dynamic from 'next/dynamic'

const VoiceMidi = dynamic(() => import('@/components/apps/VoiceMidi'))

export const metadata: Metadata = {
  title: 'Sing to Instrument — Hum a Tune, Hear It as Any Instrument',
  description: 'Sing or hum into your mic and hear it played back as a piano, violin, synth, and more — with a metronome and a quantize button. Free, in your browser. No download.',
  alternates: { canonical: 'https://100lights.com/apps/voicemidi' },
  openGraph: {
    title: 'Sing to Instrument — 100Lights',
    description: 'Hum a melody and it plays back as the instrument you pick. Metronome + quantize included. Free, in your browser.',
    url: 'https://100lights.com/apps/voicemidi',
    type: 'website',
    siteName: '100Lights',
  },
}

export default function VoiceMidiPage() {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)' }}>
      <main id="main" className="max-w-2xl mx-auto px-6 py-14">
        <header style={{ marginBottom: 28 }}>
          <h1 style={{ fontSize: 32, fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 10px', letterSpacing: '-0.02em' }}>
            Sing to Instrument
          </h1>
          <p style={{ fontSize: 15, color: 'var(--text-secondary)', lineHeight: 1.65, margin: 0 }}>
            Sing or hum a melody into your mic and hear it back as the instrument you choose — piano,
            violin, synth, and more. Turn on the metronome to keep time, then quantize your take to snap
            it to the beat.
          </p>
        </header>

        <VoiceMidi />

        <div style={{ marginTop: 26, fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 8px' }}>How to use it</h2>
          <p style={{ margin: '0 0 10px' }}>
            Pick an instrument and set your tempo. Hit <strong>Sing a tune</strong> and hum a melody —
            you&rsquo;ll hear it played back through the instrument in real time, and the detected note
            shows as you go. Hit <strong>Stop</strong>, then <strong>Play</strong> to hear the whole take.
            If the timing is loose, tap a grid value and <strong>Quantize</strong> snaps every note onto
            the beat. Your raw take is kept, so you can toggle quantize off anytime.
          </p>
          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-muted)' }}>
            Pitch detection runs entirely in your browser — nothing is recorded or uploaded.
          </p>
        </div>
      </main>
    </div>
  )
}
