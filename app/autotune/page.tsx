import type { Metadata } from 'next'
import dynamic from 'next/dynamic'
import AppChrome from '@/components/apps/AppChrome'

const AutotuneApp = dynamic(() => import('@/components/apps/AutotuneApp'))

export const metadata: Metadata = {
  title: 'Autotune — Record Your Voice and Pitch-Correct It in Your Browser',
  description: 'Record your voice, pitch-correct it to any key and scale, then compare original vs corrected and download the result. Free, all in your browser. No download, nothing uploaded.',
  alternates: { canonical: 'https://100lights.com/autotune' },
  openGraph: {
    title: 'Autotune — 100Lights',
    description: 'Sing a line and hear it snapped to your chosen key and scale. Original vs corrected A/B, adjustable strength, WAV download. Free, in your browser.',
    url: 'https://100lights.com/autotune',
    type: 'website',
    siteName: '100Lights',
  },
}

export default function AutotunePage() {
  return (
    <AppChrome slug="autotune">
      <AutotuneApp />
    </AppChrome>
  )
}
