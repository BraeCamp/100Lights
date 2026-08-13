import type { Metadata } from 'next'
import RadioAdmin from './RadioAdmin'

// Gated by app/(app)/admin/layout.tsx (account owner + ADMIN_CODE cookie).
export const metadata: Metadata = { title: 'Lightning Bug — Radio', robots: { index: false, follow: false } }

export default function LightningBugRadioAdminPage() {
  return <RadioAdmin />
}
