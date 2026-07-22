import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { isAdmin } from '@/lib/admin-auth'
import AudioManager from './AudioManager'

// Admin-only, never indexed. Lets Brae replace any demo clip's audio file with
// his own corrected version (or revert to the generated one).
export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'Fix demo clips',
  robots: { index: false, follow: false },
}

export default async function AudioCheckPage() {
  if (!await isAdmin()) notFound()
  return <AudioManager />
}
