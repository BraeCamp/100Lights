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
  title: '100Lights — Make a Beat',
  description: 'Make a beat in your browser, free — then finish the track on desktop.',
}

export default function MobileLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
