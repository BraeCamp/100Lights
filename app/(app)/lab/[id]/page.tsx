import { notFound } from 'next/navigation'
import { auth, clerkClient } from '@clerk/nextjs/server'
import { sql } from '@/lib/db'
import type { CfProjFile } from '@/lib/project-serializer'
import { isAudioClip } from '@/lib/daw-types'
import { ensureSharingSchema } from '@/lib/project-access'
import {
  getProjectAdmin, songMetadata, splitSheet, credits, sampleUsage, provenanceTimeline,
  type Contributor,
} from '@/lib/project-admin'
import { HubClient } from './HubClient'

export const dynamic = 'force-dynamic'

export default async function ProjectHubPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { userId } = await auth()

  let row: { user_id: string; owner_username: string | null; name: string; saved_at: string; data: CfProjFile } | undefined
  try {
    const rows = await sql`SELECT user_id, owner_username, name, saved_at, data FROM projects WHERE id = ${id} AND deleted_at IS NULL`
    row = rows[0] as typeof row
  } catch { /* fall through to notFound */ }
  if (!row) notFound()
  const daw = row.data?.dawProject
  if (!daw) notFound()

  // ── Collaborators (owner + members), names resolved via Clerk ──────────────
  await ensureSharingSchema()
  let members: Array<{ email: string; user_id: string | null; role: string; added_at: string }> = []
  try {
    members = await sql`SELECT email, user_id, role, added_at FROM project_members WHERE project_id = ${id}` as typeof members
  } catch { members = [] }

  const idsToResolve = [row.user_id, ...members.map(m => m.user_id).filter((x): x is string => !!x)]
  const nameById = new Map<string, string>()
  const emailById = new Map<string, string>()
  try {
    if (idsToResolve.length) {
      const cc = await clerkClient()
      const list = await cc.users.getUserList({ userId: [...new Set(idsToResolve)], limit: 100 })
      for (const u of list.data) {
        const email = u.emailAddresses?.[0]?.emailAddress ?? ''
        nameById.set(u.id, u.fullName || u.username || email || u.id)
        if (email) emailById.set(u.id, email)
      }
    }
  } catch { /* Clerk unavailable (dev) — fall back to usernames/emails */ }

  const contributors: Contributor[] = [
    { userId: row.user_id, name: nameById.get(row.user_id) ?? row.owner_username ?? emailById.get(row.user_id) ?? 'Owner', email: emailById.get(row.user_id), role: 'owner' },
    ...members
      .filter(m => m.role !== 'owner')
      .map((m): Contributor => ({
        userId: m.user_id ?? undefined,
        email: m.email,
        name: (m.user_id && nameById.get(m.user_id)) || m.email,
        role: m.role === 'edit' ? 'edit' : 'view',
      })),
  ]

  // ── Community sample authors (for credits + clearance) ─────────────────────
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

  // ── Overlay + generated Tier-1 documents ───────────────────────────────────
  const overlay = await getProjectAdmin(id)
  const metadata = songMetadata(daw)
  const splits = splitSheet(contributors, overlay.splitOverrides)
  const samples = sampleUsage(daw, communityAuthorsByItem)
  const creditLines = credits(contributors, samples.map(s => s.author ?? '').filter(Boolean))
  const timeline = provenanceTimeline(
    daw, row.saved_at,
    members.map(m => ({ name: (m.user_id && nameById.get(m.user_id)) || m.email, at: m.added_at })),
  )

  const canEdit = !userId || row.user_id === userId // admin/dev can edit; owner can edit

  return (
    <HubClient
      projectId={id}
      metadata={metadata}
      contributors={contributors}
      splits={splits}
      credits={creditLines}
      samples={samples}
      timeline={timeline}
      overlay={overlay}
      canEdit={canEdit}
    />
  )
}
