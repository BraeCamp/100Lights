import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { isAdminEmail } from '@/lib/admin-auth'

// Admin-only lab: a sandbox for the consolidated "Project Hub" (music-admin) build,
// so the new direction can be dogfooded without touching the live app. Middleware
// already forces sign-in (/lab isn't public); this adds the admin gate. DEV_OPEN=1
// bypasses for local testing (mirrors middleware's dev bypass).
export const metadata: Metadata = { title: 'Lab', robots: { index: false, follow: false } }

export default async function LabLayout({ children }: { children: React.ReactNode }) {
  if (process.env.DEV_OPEN !== '1' && !(await isAdminEmail())) notFound()
  return <>{children}</>
}
