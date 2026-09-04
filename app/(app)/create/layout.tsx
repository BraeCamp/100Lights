import type { Metadata, Viewport } from 'next'
import ZoomBlock from '@/components/ZoomBlock'
export const metadata: Metadata = { title: 'New Project', robots: { index: false, follow: false } }
// An editor: pinch and ctrl+wheel are editing gestures, so browser zoom is locked here.
export const viewport: Viewport = { width: 'device-width', initialScale: 1, maximumScale: 1, userScalable: false }
export default function Layout({ children }: { children: React.ReactNode }) { return <><ZoomBlock />{children}</> }
