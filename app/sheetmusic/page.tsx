import type { Metadata } from 'next'
import dynamic from 'next/dynamic'

const SheetMusic = dynamic(() => import('@/components/apps/SheetMusic'))

export const metadata: Metadata = {
  title: 'Hear Sheet Music — Turn a Score Into Sound',
  description: 'Upload a photo, PDF, or MusicXML of sheet music and hear it played back on any instrument. Then open it in the studio or export WAV/MIDI. Free, in your browser.',
  alternates: { canonical: 'https://100lights.com/sheetmusic' },
  openGraph: {
    title: 'Hear Sheet Music — 100Lights',
    description: 'Upload a score and hear it played back. Photo, PDF, or MusicXML → sound. Free, in your browser.',
    url: 'https://100lights.com/sheetmusic',
    type: 'website',
    siteName: '100Lights',
  },
}

export default function SheetMusicPage() {
  return <SheetMusic />
}
