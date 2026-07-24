import type { Metadata, Viewport } from 'next'

// The mobile studio route (/m) — app-like: fills the screen, no pinch-zoom,
// dark status bar, and respects the notch (viewport-fit: cover). Lives outside
// the (app) group so it doesn't inherit the desktop editor chrome.

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#0e0d12',
}

export const metadata: Metadata = {
  title: '100Lights — Make a Beat on Your Phone',
  description: 'Make a beat in your browser, free — layer drums, melodies, and your own recordings on your phone, then finish the track on desktop.',
  alternates: { canonical: 'https://100lights.com/m' },
  openGraph: {
    title: '100Lights — Make a Beat on Your Phone',
    description: 'Make a beat in your browser, free — layer drums, melodies, and your own recordings on your phone, then finish the track on desktop.',
    type: 'website',
    siteName: '100Lights',
    url: 'https://100lights.com/m',
  },
  twitter: { card: 'summary_large_image', title: '100Lights — Make a Beat on Your Phone', description: 'Make a beat in your browser, free — then finish the track on desktop.' },
}

export default function MobileLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
