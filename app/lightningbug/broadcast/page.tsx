import type { Metadata } from 'next'
import BroadcastLauncher from './BroadcastLauncher'

export const metadata: Metadata = {
  title: 'Lightning Bug Broadcast — 24/7 Radio Stations',
  description: 'Launch Lightning Bug radio-with-visuals stations for YouTube/Twitch — D&D ambience, study/focus, and more. Preview or copy the OBS Browser-Source URL.',
  alternates: { canonical: 'https://100lights.com/lightningbug/broadcast' },
  robots: { index: false, follow: true },   // operator page, not a marketing landing
}

export default function BroadcastLauncherPage() {
  return <BroadcastLauncher />
}
