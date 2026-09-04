import type { Metadata } from 'next'
import dynamic from 'next/dynamic'

const LightningBug = dynamic(() => import('@/components/apps/LightningBug'))

export const metadata: Metadata = {
  title: 'Lightning Bug — Live Visuals for Your Music',
  description: 'Add a video and get a synced visual overlay from its melody, or run party mode to react to the room\'s music on a TV. Runs on your device, no upload, no AI.',
  alternates: { canonical: 'https://100lights.com/lightningbug' },
  keywords: ['music visualizer', 'live visuals', 'audio reactive video', 'party visuals', 'VJ app', 'D&D ambience visuals', 'lofi study visuals', 'beat detection visualizer', 'browser music visualizer'],
  openGraph: {
    title: 'Lightning Bug — 100Lights',
    description: 'Turn any track into a glowing live visual — reactive visuals, artsy video backgrounds, and cinematic look modes, synced to your music.',
    url: 'https://100lights.com/lightningbug',
    type: 'website',
    siteName: '100Lights',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Lightning Bug — Live Visuals for Your Music',
    description: 'Turn any track into a glowing live visual — reactive visuals, artsy video backgrounds, and cinematic look modes. Free, in your browser.',
  },
}

// Structured data so search engines understand this is a free browser app (helps rich results).
const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'WebApplication',
  name: 'Lightning Bug',
  url: 'https://100lights.com/lightningbug',
  applicationCategory: 'MultimediaApplication',
  operatingSystem: 'Any (web browser)',
  browserRequirements: 'Requires a modern browser with Web Audio support',
  description: 'Turn any track into a glowing live visual — reactive bars and radial glow, artsy video backgrounds, cinematic look modes, and auto-shuffling scenes. Full-screen it for a party, or lay visuals over your own video.',
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  publisher: { '@type': 'Organization', name: '100Lights', url: 'https://100lights.com' },
}

export default function LightningBugPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <LightningBug />
    </>
  )
}
