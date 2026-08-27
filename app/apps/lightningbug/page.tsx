import type { Metadata } from 'next'
import dynamic from 'next/dynamic'

const LightningBug = dynamic(() => import('@/components/apps/LightningBug'))

export const metadata: Metadata = {
  title: 'Lightning Bug — Live Visuals for Your Music',
  description: 'Turn any track into a glowing live visual — reactive bars, radial glow, artsy video backgrounds, and cinematic look modes. Full-screen it for a party, or lay visuals over your own video. Free, in your browser.',
  alternates: { canonical: 'https://100lights.com/apps/lightningbug' },
  keywords: ['music visualizer', 'live visuals', 'audio reactive video', 'party visuals', 'VJ app', 'D&D ambience visuals', 'lofi study visuals', 'beat detection visualizer', 'browser music visualizer'],
  openGraph: {
    title: 'Lightning Bug — 100Lights',
    description: 'Turn any track into a glowing live visual — reactive visuals, artsy video backgrounds, and cinematic look modes, synced to your music.',
    url: 'https://100lights.com/apps/lightningbug',
    type: 'website',
    siteName: '100Lights',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Lightning Bug — Live Visuals for Your Music',
    description: 'Turn any track into a glowing live visual — reactive visuals, artsy video backgrounds, and cinematic look modes. Free, in your browser.',
  },
}

export default function LightningBugPage() {
  return (
    <>
      <LightningBug />
    </>
  )
}
