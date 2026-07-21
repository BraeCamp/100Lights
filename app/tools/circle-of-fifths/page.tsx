import type { Metadata } from 'next'
import dynamic from 'next/dynamic'
import ToolShell from '@/components/tools/ToolShell'

const CircleOfFifths = dynamic(() => import('@/components/tools/CircleOfFifths'))

export const metadata: Metadata = {
  title: 'Circle of Fifths — Interactive, Hear Every Key & Its Chords',
  description: 'An interactive circle of fifths. Click any key to hear it, see its relative minor, and play the chords that belong to it. Free, in your browser.',
  alternates: { canonical: 'https://100lights.com/tools/circle-of-fifths' },
  openGraph: {
    title: 'Circle of Fifths — Interactive, Hear Every Key & Its Chords',
    description: 'An interactive circle of fifths. Click any key to hear it, see its relative minor, and play the chords that belong to it. Free, in your browser.',
    url: 'https://100lights.com/tools/circle-of-fifths',
    type: 'website',
    siteName: '100Lights',
  },
}

export default function CircleOfFifthsPage() {
  return (
    <ToolShell
      title="Circle of fifths"
      intro="Click any key to hear it and see the chords that belong to it. Keys next to each other on the circle share the most notes, which is why moving between neighbours always sounds smooth."
    >
      <CircleOfFifths />
      <div style={{ marginTop: 30 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 8px' }}>How to read it</h2>
        <p style={{ fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.7, margin: '0 0 10px' }}>
          Move one step clockwise and the key gains a sharp; one step anticlockwise and it gains a flat.
          Because neighbours differ by only that single note, they share almost their whole set of chords —
          that shared overlap is why a song can drift from one key to the next without ever sounding like it lurched.
        </p>
        <p style={{ fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.7, margin: 0 }}>
          The inner ring is each key&rsquo;s relative minor: the same seven notes as the major beside it, just
          centred on a darker home note. The chords shown below the circle are the ones built from those seven
          notes — the ones that sound &ldquo;in key&rdquo; and won&rsquo;t fight the melody.
        </p>
      </div>
    </ToolShell>
  )
}
