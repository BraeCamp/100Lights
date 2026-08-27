import type { Metadata } from 'next'
import dynamic from 'next/dynamic'
import { AppPageSeo } from '@/components/apps/AppChrome'

const Firefly = dynamic(() => import('@/components/apps/Firefly'))

export const metadata: Metadata = {
  title: 'Firefly — Sketch a Song with Your Voice',
  description: 'Hum a melody and it becomes playable notes, add a beat, then open the sketch in the 100Lights studio to finish it. Free, in your browser. No download.',
  alternates: { canonical: 'https://100lights.com/apps/firefly' },
  openGraph: {
    title: 'Firefly — 100Lights',
    description: 'Sing a melody, add a beat, finish it in the studio. A voice-first music sketchpad. Free, in your browser.',
    url: 'https://100lights.com/apps/firefly',
    type: 'website',
    siteName: '100Lights',
  },
}

export default function FireflyPage() {
  // Firefly builds its own chrome (it imports only Sheet/CustomizeSheet from
  // AppChrome), so it does not get the shell's <h1> and JSON-LD automatically.
  return (
    <>
      <AppPageSeo slug="firefly" />
      <Firefly />
    </>
  )
}
