import type { Metadata } from 'next'
import dynamic from 'next/dynamic'
import AppChrome from '@/components/apps/AppChrome'

const CaptionsApp = dynamic(() => import('@/components/apps/CaptionsApp'))

export const metadata: Metadata = {
  title: 'Captions — Turn Speech Into Timed Captions',
  description: 'Add a video from your camera roll and get timed, animated captions transcribed on your device — nothing uploads. Edit the words, export SRT/VTT, or send them to the video editor to burn them in.',
  alternates: { canonical: 'https://100lights.com/captions' },
  openGraph: {
    title: 'Captions — 100Lights',
    description: 'Speech → timed captions in your browser. Edit and export SRT/VTT/TXT, or caption a video.',
    url: 'https://100lights.com/captions',
    type: 'website',
    siteName: '100Lights',
  },
}

export default function CaptionsPage() {
  return (
    <AppChrome slug="captions">
      <CaptionsApp />
    </AppChrome>
  )
}
