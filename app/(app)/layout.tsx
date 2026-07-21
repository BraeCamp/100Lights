import type { Viewport } from 'next'
import AppLayoutClient from './AppLayoutClient'
import ZoomBlock from '@/components/ZoomBlock'

// The DAW re-locks zoom (the root layout allows it for public pages): editing
// gestures — pinch, ctrl+wheel — conflict with browser zoom inside the editor.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ZoomBlock />
      <AppLayoutClient>{children}</AppLayoutClient>
    </>
  )
}
