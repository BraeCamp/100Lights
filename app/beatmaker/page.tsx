import type { Metadata } from 'next'
import dynamic from 'next/dynamic'
import AppChrome from '@/components/apps/AppChrome'

const BeatMakerApp = dynamic(() => import('@/components/apps/BeatMakerApp'))

export const metadata: Metadata = {
  title: 'Beat Maker — Free Online Drum Machine',
  description: 'Build a drum pattern on the step grid, or start from a preset groove — four on the floor, boom bap, trap, disco, funk — then export the loop as MIDI or WAV.',
  alternates: { canonical: 'https://100lights.com/beatmaker' },
  openGraph: {
    title: 'Beat Maker — 100Lights',
    description: 'A free browser drum machine: step grid, drum kits, pattern presets, tempo, and MIDI/WAV export. No download.',
    url: 'https://100lights.com/beatmaker',
    type: 'website',
    siteName: '100Lights',
  },
}

export default function BeatMakerPage() {
  return (
    <AppChrome slug="beatmaker">
      <BeatMakerApp />
    </AppChrome>
  )
}
