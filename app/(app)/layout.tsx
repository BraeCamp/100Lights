import type { Viewport } from 'next'
import AppLayoutClient from './AppLayoutClient'

// Zoom stays allowed here. This group also holds the dashboard, library,
// projects list, settings and profiles — ordinary pages where pinch zoom is a
// low-vision user's tool (WCAG 1.4.4). The editors, where pinch and ctrl+wheel
// are editing gestures, re-lock it in their own layouts: create/, projects/[id]/
// and lab/ (a zoom-locking `viewport` export plus ZoomBlock).
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppLayoutClient>{children}</AppLayoutClient>
}
