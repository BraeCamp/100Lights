import type { Metadata } from 'next'
import dynamic from 'next/dynamic'
import ToolShell from '@/components/tools/ToolShell'

const Metronome = dynamic(() => import('@/components/tools/Metronome'))

export const metadata: Metadata = {
  title: 'Online Metronome — Free Metronome with Tap Tempo',
  description: 'A free online metronome with tap tempo, adjustable time signature, and a visual beat. 30–300 BPM, runs in your browser. No download, no sign-up.',
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
      intro="A clean, accurate metronome that runs in your browser. Set the tempo by dragging, tapping, or the − / + buttons, choose your beats per bar, and the first beat of every bar is accented so you never lose your place."
    >
      <Metronome />
      <div style={{ marginTop: 26, fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 8px' }}>How to use it</h2>
        <p style={{ margin: '0 0 10px' }}>
          Hit <strong>Start</strong>. The dots light up on each beat, with the downbeat a different colour so you can feel the bar. Don&rsquo;t know the tempo of a song? Tap the <strong>TAP</strong> button along with it four or five times and it&rsquo;ll work out the BPM for you.
        </p>
        <p style={{ margin: '0 0 10px' }}>
          Practising to a metronome is the single most boring and most effective thing you can do for your timing. Start a passage slower than feels necessary — slow enough that you never make a mistake — and only nudge the tempo up once it&rsquo;s clean. The click is honest in a way that a backing track isn&rsquo;t.
        </p>
        <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-muted)' }}>
          The click is scheduled against the audio clock, so it stays rock-steady and won&rsquo;t drift the way a simple timer would.
        </p>
      </div>
    </ToolShell>
  )
}
