import type { Metadata } from 'next'
import { getSitePages } from '@/lib/site-pages'
import PageDirectory from './PageDirectory'

// Gated by app/(app)/admin/layout.tsx (account owner + ADMIN_CODE cookie).
export const metadata: Metadata = { title: 'Site Directory', robots: { index: false, follow: false } }
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export default function SiteDirectoryPage() {
  const { pages, source } = getSitePages()
  return <PageDirectory entries={pages} source={source} />
}
