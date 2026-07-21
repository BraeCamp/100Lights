import type { Metadata } from 'next'
import dynamic from 'next/dynamic'
import ToolShell from '@/components/tools/ToolShell'

const DelayCalculator = dynamic(() => import('@/components/tools/DelayCalculator'))

export const metadata: Metadata = {
  title: 'Delay Time Calculator — Free BPM to MS for Delay & Reverb',
  description: 'A free delay time calculator. Enter your BPM and get delay and reverb times in milliseconds for every note value — straight, dotted, and triplet. Plus LFO Hz.',
  alternates: { canonical: 'https://100lights.com/tools/delay-calculator' },
  openGraph: { title: 'Delay Time Calculator — 100Lights', description: 'BPM to delay time in ms for every note value. Free, in your browser.', url: 'https://100lights.com/tools/delay-calculator', type: 'website', siteName: '100Lights' },
}

export default function Page() {
  return (
    <ToolShell
      title="Delay time calculator"
      intro="Set your tempo and get the delay and reverb times in milliseconds for every note value — straight, dotted, and triplet. Tap any value to copy it."
    >
      <DelayCalculator />

      <div style={{ marginTop: 26, fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 8px' }}>How to use it</h2>
        <p style={{ margin: '0 0 10px' }}>
          Match a delay to your song&rsquo;s tempo and the echoes land on the beat instead of muddying it. Set your BPM above, then copy the millisecond value for the note you want and paste it into your delay plugin&rsquo;s time field. A <strong>dotted-eighth</strong> delay is the classic rhythmic trick — it&rsquo;s the sound behind The Edge&rsquo;s guitar on countless U2 records, filling the space between your notes without stepping on them. Triplet and straight feels give you swung or on-grid repeats.
        </p>
        <p style={{ margin: 0 }}>
          Reverb sits on the same clock. Tempo-match the <strong>pre-delay</strong> — often a sixteenth or eighth — so the tail starts in time, and set the <strong>decay</strong> to a note value (a half or a whole note) so the reverb clears just before the next phrase. The Hz column does the same job for anything that moves in cycles: dial it into a tremolo, auto-pan, or filter LFO to lock the wobble to your groove.
        </p>
      </div>
    </ToolShell>
  )
}
