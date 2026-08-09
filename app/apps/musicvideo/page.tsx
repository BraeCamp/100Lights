import type { Metadata } from 'next'
import dynamic from 'next/dynamic'

const MusicVideo = dynamic(() => import('@/components/apps/MusicVideo'))

export const metadata: Metadata = {
  title: 'Music Video — Put a Transcription on Your Video',
  description: 'Upload a video and its melody becomes a visual overlay — falling notes, flowing shapes, colors, fonts — synced to playback. Free, in your browser.',
  alternates: { canonical: 'https://100lights.com/apps/musicvideo' },
  openGraph: {
    title: 'Music Video — 100Lights',
    description: 'Turn a video into a music visual — its melody drives falling notes, shapes, and more, synced to playback.',
    url: 'https://100lights.com/apps/musicvideo',
    type: 'website',
    siteName: '100Lights',
  },
}

export default function MusicVideoPage() {
  return <MusicVideo />
}
