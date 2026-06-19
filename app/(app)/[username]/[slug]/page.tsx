import { auth } from '@clerk/nextjs/server'
import { notFound } from 'next/navigation'
import { sql } from '@/lib/db'
import ProjectEditor from '@/components/editor/ProjectEditor'

export default async function ProjectBySlugPage({
  params,
}: {
  params: Promise<{ username: string; slug: string }>
}) {
  const { username, slug } = await params
  const { userId } = await auth()
  if (!userId) return null // middleware handles redirect

  let rows: { id: string }[]
  try {
    rows = await sql`
      SELECT id FROM projects
      WHERE owner_username = ${username}
        AND slug           = ${slug}
        AND user_id        = ${userId}
        AND deleted_at IS NULL
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
