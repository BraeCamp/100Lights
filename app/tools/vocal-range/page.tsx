import type { Metadata } from 'next'
import dynamic from 'next/dynamic'
import ToolShell from '@/components/tools/ToolShell'

const VocalRange = dynamic(() => import('@/components/tools/VocalRange'))

export const metadata: Metadata = {
  title: 'Vocal Range Finder — Free, Find Your Range & Voice Type',
  description: 'A free vocal range finder. Sing your lowest and highest notes and it shows your range and closest voice type — bass, tenor, alto, soprano. In your browser, nothing recorded.',
  alternates: { canonical: 'https://100lights.com/tools/vocal-range' },
  openGraph: {
    title: 'Vocal Range Finder — 100Lights',
    description: 'Sing low and high; find your range and voice type. Free, in your browser.',
    url: 'https://100lights.com/tools/vocal-range',
    type: 'website',
    siteName: '100Lights',
  },
}

export default function VocalRangePage() {
  return (
    <ToolShell
      title="Vocal range finder"
      intro="Sing your lowest note, then your highest, and this finds your range and the voice type it's closest to. It listens through your mic and detects the pitch live — nothing is recorded or uploaded."
      studioLabel="Record your voice in the studio"
    >
      <VocalRange />
      <div style={{ marginTop: 26, fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 8px' }}>How to use it</h2>
        <p style={{ margin: '0 0 10px' }}>
          Press start and allow microphone access. Sing a steady &ldquo;ah&rdquo; and slide slowly down to the lowest note you can hold cleanly — not a creaky growl, a real note. Then slide up to your highest comfortable note. Hold each end for a second so it registers. Your lowest and highest lock in as you go.
        </p>
        <p style={{ margin: '0 0 10px' }}>
          The voice type is a best-fit estimate from your range, not a verdict — singers regularly sit between categories, and range isn&rsquo;t the whole story (tone and where your voice feels easy matter too). Treat it as a starting point.
        </p>
        <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-muted)' }}>
          Detection runs entirely in your browser — the microphone audio never leaves your device.
        </p>
      </div>
    </ToolShell>
  )
}
