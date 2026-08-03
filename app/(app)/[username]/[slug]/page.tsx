import { auth } from '@clerk/nextjs/server'
import { notFound } from 'next/navigation'
import { sql } from '@/lib/db'
import ProjectEditor from '@/components/editor/ProjectEditor'
import { codeFromSlug } from '@/lib/project-url'

// Canonical project URL: /@username/<readable-slug>-<code>. The slug is cosmetic;
// the project is resolved by the trailing <code> (a stable prefix of its id), so a
// renamed project's old links keep working. Access (owner vs. shared collaborator)
// is enforced downstream by /api/projects/[id], so this resolves by the OWNER's
// username without filtering on the viewer — a shared collaborator can open it too.
export default async function ProjectBySlugPage({
  params,
}: {
  params: Promise<{ username: string; slug: string }>
}) {
  const { username, slug } = await params
  const { userId } = await auth()
  if (!userId) return null // middleware handles the sign-in redirect

  // Project URLs are @-prefixed; a bare two-segment path isn't one of ours.
  if (!username.startsWith('@')) notFound()
  const owner = decodeURIComponent(username).replace(/^@/, '')
  const code = codeFromSlug(slug)
  if (!owner || !code) notFound()

  let rows: { id: string }[]
  try {
    rows = await sql`
      SELECT id FROM projects
      WHERE owner_username = ${owner}
        AND id LIKE ${code + '%'}
        AND deleted_at IS NULL
      ORDER BY saved_at DESC
      LIMIT 1
    ` as { id: string }[]
  } catch {
    notFound()
  }

  if (!rows!.length) notFound()

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <ProjectEditor
        projectId={rows![0].id}
        projectName="…"
        allowImport
      />
    </div>
  )
}
