import type { Metadata } from 'next'
import PexelsAdmin from './PexelsAdmin'

// Gated by app/(app)/admin/layout.tsx (account owner + ADMIN_CODE cookie).
export const metadata: Metadata = { title: 'Lightning Bug — Background Library', robots: { index: false, follow: false } }

export default function LightningBugAdminPage() {
  return <PexelsAdmin />
}
