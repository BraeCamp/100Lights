import type { Metadata } from 'next'
import dynamic from 'next/dynamic'
import ToolShell from '@/components/tools/ToolShell'

const Fretboard = dynamic(() => import('@/components/tools/Fretboard'))

export const metadata: Metadata = {
  title: 'Guitar Scales — Free Interactive Fretboard for Every Scale & Key',
  description:
    'A free interactive guitar fretboard. See any scale — major, minor, pentatonic, blues, modes — in any key, and click any note to hear it. No download.',
  alternates: { canonical: 'https://100lights.com/tools/scales' },
  openGraph: {
    title: 'Guitar Scales — Free Interactive Fretboard for Every Scale & Key',
    description:
      'A free interactive guitar fretboard. See any scale — major, minor, pentatonic, blues, modes — in any key, and click any note to hear it. No download.',
    url: 'https://100lights.com/tools/scales',
    type: 'website',
    siteName: '100Lights',
  },
}

export default function ScalesPage() {
  return (
    <ToolShell
      title="Guitar scales"
      intro="See any scale on the fretboard in any key, and click any note to hear it. Root notes are highlighted so you can find your anchor points anywhere on the neck."
    >
      <Fretboard />
      <div style={{ marginTop: 26, fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 8px' }}>How to use it</h2>
        <p style={{ margin: '0 0 10px' }}>
          Pick a <strong>root note</strong> and a <strong>scale</strong>. The board lights up every place that scale lives across all six strings, from the open position up to the 15th fret. The strings run low E at the bottom to high E at the top, exactly as they face you when the guitar is in your lap. Click any dot to hear the note through a soft acoustic guitar.
        </p>
        <p style={{ margin: '0 0 10px' }}>
          The solid, brightly ringed dots are the <strong>root notes</strong> — your home base. Learn where those sit and you can always find your way back to a note that sounds resolved. When you&rsquo;re starting out, the two <strong>pentatonic</strong> scales are the easiest to solo with: only five notes, no wrong-sounding ones, and they map into tidy box shapes you can slide anywhere up the neck.
        </p>
      </div>
    </ToolShell>
  )
}
