import type { Metadata } from 'next'
import dynamic from 'next/dynamic'

const MusicVideo = dynamic(() => import('@/components/apps/MusicVideo'))

export const metadata: Metadata = {
  title: 'Lightning Bug — Live Visuals for Your Music',
  description: 'Turn any track into a glowing live visual — reactive bars, radial glow, artsy video backgrounds, and cinematic look modes. Full-screen it for a party, or lay visuals over your own video. Free, in your browser.',
  alternates: { canonical: 'https://100lights.com/apps/musicvideo' },
  openGraph: {
    title: 'Lightning Bug — 100Lights',
    description: 'Turn any track into a glowing live visual — reactive visuals, artsy video backgrounds, and cinematic look modes, synced to your music.',
    url: 'https://100lights.com/apps/musicvideo',
    type: 'website',
    siteName: '100Lights',
  },
}

export default function MusicVideoPage() {
  return <MusicVideo />
}
