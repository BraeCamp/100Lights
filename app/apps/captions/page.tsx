import type { Metadata } from 'next'
import dynamic from 'next/dynamic'
import AppChrome from '@/components/apps/AppChrome'

const Captions = dynamic(() => import('@/components/apps/Captions'))

export const metadata: Metadata = {
  title: 'Captions — Turn Speech Into Timed Captions',
  description: 'Drop in audio or video and get timed captions on-device (free, private, no upload). Edit the words, export SRT/VTT/TXT, or send them to the video editor to caption your clip.',
  alternates: { canonical: 'https://100lights.com/apps/captions' },
  openGraph: {
    title: 'Captions — 100Lights',
    description: 'Speech → timed captions in your browser. Edit and export SRT/VTT/TXT, or caption a video.',
    url: 'https://100lights.com/apps/captions',
    type: 'website',
    siteName: '100Lights',
  },
}

export default function CaptionsPage() {
  return (
    <AppChrome slug="captions">
      <Captions />
    </AppChrome>
  )
}
