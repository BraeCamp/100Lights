import type { CommunityItem } from '@/lib/community'
import { getInitialCommunityItems } from '@/lib/community-server'
import CommunityClient from './CommunityClient'

// Server shell for the community feed: fetches the first page of items so they
// (and their internal links to /community/[id]) are in the SSR HTML for
// crawlers, then hands them to the interactive client feed. Metadata lives in
// layout.tsx. ISR keeps the server-rendered feed reasonably fresh.
export const runtime = 'nodejs'
// One regeneration an hour, not one every five minutes. The feed is not
// changing that fast, and each rebuild is a database read you pay compute for.
export const revalidate = 3600

export default async function CommunityPage() {
  const initialItems = (await getInitialCommunityItems(30)) as unknown as CommunityItem[]
  return <CommunityClient initialItems={initialItems} />
}
