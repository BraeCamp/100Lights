import type { Metadata, Viewport } from 'next'
import { notFound } from 'next/navigation'
import { isAdminEmail } from '@/lib/admin-auth'
import ZoomBlock from '@/components/ZoomBlock'

// Admin-only lab: a sandbox for the consolidated "Project Hub" (music-admin) build,
// so the new direction can be dogfooded without touching the live app. Middleware
// already forces sign-in (/lab isn't public); this adds the admin gate. DEV_OPEN=1
// bypasses for local testing (mirrors middleware's dev bypass).
export const metadata: Metadata = { title: 'Lab', robots: { index: false, follow: false } }
// An editor sandbox: pinch and ctrl+wheel are editing gestures, so browser zoom is locked here.
export const viewport: Viewport = { width: 'device-width', initialScale: 1, maximumScale: 1, userScalable: false }

export default async function LabLayout({ children }: { children: React.ReactNode }) {
  if (process.env.DEV_OPEN !== '1' && !(await isAdminEmail())) notFound()
  return <><ZoomBlock />{children}</>
}
