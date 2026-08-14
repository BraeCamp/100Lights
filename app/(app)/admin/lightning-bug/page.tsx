import type { Metadata } from 'next'
import AdminShell from './AdminShell'

// Gated by app/(app)/admin/layout.tsx (account owner + ADMIN_CODE cookie).
export const metadata: Metadata = { title: 'Lightning Bug — Broadcast admin', robots: { index: false, follow: false } }

export default function LightningBugAdminPage() {
  return <AdminShell />
}
