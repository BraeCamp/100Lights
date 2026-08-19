import type { Metadata } from 'next'
import ModuleHome from '@/components/site/ModuleHome'

export const metadata: Metadata = {
  title: 'Beacon — The Music Studio',
  description: 'Beacon is the 100Lights music studio: a full DAW in your browser — Session and Arrangement views, piano roll, mixer, effects, and recording.',
  alternates: { canonical: 'https://100lights.com/beacon' },
}

export default function BeaconPage() {
  return <ModuleHome moduleKey="audio" />
}
