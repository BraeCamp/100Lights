import type { Metadata } from 'next'
import dynamic from 'next/dynamic'
import AppChrome from '@/components/apps/AppChrome'

const VoiceMidiApp = dynamic(() => import('@/components/apps/VoiceMidiApp'))

export const metadata: Metadata = {
  title: 'Sing to Instrument — Hum a Tune, Hear It as Any Instrument',
  description: 'Sing or hum into your mic and hear it played back as a piano, violin, synth, and more — with a metronome and a quantize button. Free, in your browser. No download.',
  alternates: { canonical: 'https://100lights.com/voicemidi' },
  openGraph: {
    title: 'Sing to Instrument — 100Lights',
    description: 'Hum a melody and it plays back as the instrument you pick. Metronome + quantize included. Free, in your browser.',
    url: 'https://100lights.com/voicemidi',
    type: 'website',
    siteName: '100Lights',
  },
}

export default function VoiceMidiPage() {
  return (
    <AppChrome slug="voicemidi">
      <VoiceMidiApp />
    </AppChrome>
  )
}
