import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { isAdmin } from '@/lib/admin-auth'
import AudioTuner from './AudioTuner'

// Admin-only, never indexed. Lets Brae tune the learn-article demo clips by ear
// — live browser playback — and save settings that drive the served clips.
export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'Audio tuner',
  robots: { index: false, follow: false },
}

export default async function AudioCheckPage() {
  if (!await isAdmin()) notFound()
  return <AudioTuner />
}
