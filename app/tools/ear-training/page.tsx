import type { Metadata } from 'next'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import ToolShell from '@/components/tools/ToolShell'

const IntervalTrainer = dynamic(() => import('@/components/tools/IntervalTrainer'))

export const metadata: Metadata = {
  title: 'Ear Training — Free Interval Trainer, Learn to Hear Intervals',
  description: 'A free interval ear trainer. Hear two notes and name the interval — ascending, descending, or harmonic. Tracks your score. Train your ear in the browser, no sign-up.',
  alternates: { canonical: 'https://100lights.com/tools/ear-training' },
  openGraph: {
    title: 'Interval Ear Trainer — 100Lights',
    description: 'Hear two notes, name the interval, track your score. Free ear training.',
    url: 'https://100lights.com/tools/ear-training',
    type: 'website',
    siteName: '100Lights',
  },
}

export default function EarTrainingPage() {
  return (
    <ToolShell
      title="Interval ear trainer"
      intro="Hear two notes and name the distance between them. Recognising intervals by ear is the foundation of playing by ear, transcribing, and knowing what a melody is doing — and it's pure practice, which is what this is for."
      studioLabel="Make music in the studio"
    >
      <IntervalTrainer />
      <div style={{ marginTop: 26, fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 8px' }}>How to use it</h2>
        <p style={{ margin: '0 0 10px' }}>
          Press start and it plays two notes; pick the interval you think you heard. Start with just a few — a perfect 5th, a major 3rd, an octave — and add more as those get easy (open the &ldquo;choose which intervals&rdquo; list at the bottom). The trick most people use is anchoring each interval to a song they know: a perfect 4th is the start of <em>Here Comes the Bride</em>, a perfect 5th is <em>Twinkle Twinkle</em>.
        </p>
        <p style={{ margin: 0 }}>
          Switch between ascending, descending, and harmonic (both notes together) — harmonic is the hardest and the most useful, because it&rsquo;s how intervals actually show up in chords. If you want to test the same ears on mixing rather than pitch, try <Link href="/learn/can-you-hear-the-difference" style={{ color: '#a78bfa', textDecoration: 'underline', textUnderlineOffset: 3 }}>Can You Hear the Difference?</Link>
        </p>
      </div>
    </ToolShell>
  )
}
