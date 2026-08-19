import type { Metadata } from 'next'
import AlwaysOnStudio from './AlwaysOnStudio'

export const metadata: Metadata = {
  title: 'Always-On Studio — Run Your Creations Live 24/7',
  description: 'Hand a broadcast, render, or bot to the cloud and it runs around the clock — no OBS, no machine left on. The offline-live engine behind 100Lights channels.',
  alternates: { canonical: 'https://100lights.com/lightningbug/live' },
}

export default function AlwaysOnStudioPage() {
  return <AlwaysOnStudio />
}
