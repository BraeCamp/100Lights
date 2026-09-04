import type { Metadata } from 'next'
import dynamic from 'next/dynamic'
import AppChrome from '@/components/apps/AppChrome'

const AutotuneApp = dynamic(() => import('@/components/apps/AutotuneApp'))

export const metadata: Metadata = {
  title: 'Autotune: Pitch-Correct Your Voice in Your Browser',
  description: 'Record a vocal and snap it to the nearest note in your key, from a subtle touch-up to hard tune. A/B against the original and download a WAV.',
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
