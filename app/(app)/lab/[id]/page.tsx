import { notFound } from 'next/navigation'
import { sql } from '@/lib/db'
import type { CfProjFile } from '@/lib/project-serializer'
import { isAudioClip } from '@/lib/daw-types'
import { songMetadata, sampleUsage } from '@/lib/project-admin'
import { HubClient } from './HubClient'

export const dynamic = 'force-dynamic'

// The lean Song-details view: auto metadata sheet + sample attribution for a
// saved project. (The heavy admin tabs were shelved; the same two pieces live in
// the studio export modal for every user via <SongDetails>.)
export default async function ProjectHubPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  let row: { name: string; data: CfProjFile } | undefined
  try {
    const rows = await sql`SELECT name, data FROM projects WHERE id = ${id} AND deleted_at IS NULL`
    row = rows[0] as typeof row
  } catch { /* fall through to notFound */ }
  if (!row) notFound()
  const daw = row.data?.dawProject
  if (!daw) notFound()

  // Community sample authors (for credits), resolved from the shared item ids.
  const communityItemIds = [...new Set(
    daw.arrangementClips
      .filter(isAudioClip)
      .map(c => (c.libraryId?.startsWith('community:') ? c.libraryId.split(':')[1] : null))
      .filter((x): x is string => !!x),
  )]
  const communityAuthorsByItem = new Map<string, string>()
  if (communityItemIds.length) {
    try {
      const rows = await sql`SELECT id, author_name FROM community_items WHERE id = ANY(${communityItemIds}::uuid[])`
      for (const r of rows) communityAuthorsByItem.set(r.id as string, r.author_name as string)
    } catch { /* ignore */ }
  }

  const metadata = songMetadata(daw)
  const samples = sampleUsage(daw, communityAuthorsByItem)

  return <HubClient projectId={id} metadata={metadata} samples={samples} />
}
