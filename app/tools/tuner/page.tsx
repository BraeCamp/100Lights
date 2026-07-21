import type { Metadata } from 'next'
import dynamic from 'next/dynamic'
import ToolShell from '@/components/tools/ToolShell'

const StandaloneTuner = dynamic(() => import('@/components/tools/StandaloneTuner'))

export const metadata: Metadata = {
  title: 'Online Tuner — Free Chromatic Tuner for Any Instrument',
  description: 'A free online chromatic tuner. Tune guitar, bass, violin, ukulele, or your voice from your browser mic — shows the note and cents. No download, no sign-up.',
  alternates: { canonical: 'https://100lights.com/tools/tuner' },
  openGraph: {
    title: 'Free Online Tuner — 100Lights',
    description: 'Tune any instrument or your voice from your browser mic. Free, no download.',
    url: 'https://100lights.com/tools/tuner',
    type: 'website',
    siteName: '100Lights',
  },
}

export default function TunerPage() {
  return (
    <ToolShell
      title="Online tuner"
      intro="Tune any instrument — guitar, bass, violin, ukulele — or your own voice, straight from your browser microphone. It shows the note you're playing and how many cents sharp or flat you are, in real time."
    >
      <StandaloneTuner />
      <div style={{ marginTop: 26, fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 8px' }}>How to use it</h2>
        <p style={{ margin: '0 0 10px' }}>
          Click <strong>Start</strong> and allow microphone access. Play a single note and hold it. The big letter is the nearest note; the dial shows how far off you are. Green and &ldquo;in tune&rdquo; means you&rsquo;re within a few cents — close enough that no one will hear the difference.
        </p>
        <p style={{ margin: '0 0 10px' }}>
          It&rsquo;s chromatic, so it works for any instrument and any tuning. For standard guitar you&rsquo;re aiming for E, A, D, G, B, E from the lowest string; for bass, E, A, D, G. Sing into it and it&rsquo;ll tell you the note you&rsquo;re hitting, which is the fastest way to find out whether you can actually pitch the note you think you can.
        </p>
        <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-muted)' }}>
          Nothing is recorded or uploaded — pitch detection runs entirely in your browser.
        </p>
      </div>
    </ToolShell>
  )
}
