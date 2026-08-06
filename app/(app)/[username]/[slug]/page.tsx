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

  // Project URLs are @-prefixed; a bare two-segment path isn't one of ours.
  // (This route is public, matching /projects/{id}; access is enforced by
  // /api/projects/[id] when ProjectEditor fetches, so a signed-out visitor gets
  // the editor's own sign-in prompt rather than a hard 404.)
  if (!username.startsWith('@')) notFound()
  const owner = decodeURIComponent(username).replace(/^@/, '')
  const code = codeFromSlug(slug)
  if (!code) notFound()

  // The trailing code (a prefix of the globally-unique project id) is what
  // actually resolves the project; the username + slug are cosmetic. Resolve by
  // code and merely PREFER the owner match — otherwise a project whose stored
  // owner_username doesn't exactly match what built the URL (a since-changed
  // username, an email-prefix/userId fallback, a missing backfill) 404s on
  // reload even though the link is valid. Access is still enforced downstream by
  // /api/projects/[id], so resolving by code alone is safe.
  let rows: { id: string }[]
  try {
    rows = await sql`
      SELECT id FROM projects
      WHERE id LIKE ${code + '%'}
        AND deleted_at IS NULL
      ORDER BY CASE WHEN owner_username = ${owner} THEN 0 ELSE 1 END, saved_at DESC
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
