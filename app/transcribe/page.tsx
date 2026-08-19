import type { Metadata } from 'next'
import dynamic from 'next/dynamic'

const Transcribe = dynamic(() => import('@/components/apps/Transcribe'))

export const metadata: Metadata = {
  title: 'Audio to MIDI — Turn Audio Into MIDI Notes',
  description: 'Upload an audio file or record a melody and turn it into editable MIDI notes you can hear on any instrument and export. Free, in your browser. No download.',
  alternates: { canonical: 'https://100lights.com/transcribe' },
  openGraph: {
    title: 'Audio to MIDI — 100Lights',
    description: 'Audio → MIDI. Upload or record a melody line and turn it into editable notes. Free, in your browser.',
    url: 'https://100lights.com/transcribe',
    type: 'website',
    siteName: '100Lights',
  },
}

export default function TranscribePage() {
  return <Transcribe />
}
