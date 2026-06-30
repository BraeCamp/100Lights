import { auth } from '@clerk/nextjs/server'
import { sql } from '@/lib/db'
import { slugify } from '@/lib/slugify'
import type { CfProjFile } from '@/lib/project-serializer'

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  // Verify project belongs to user and is a podcast
  const rows = await sql`
    SELECT id, data FROM projects
    WHERE id = ${id} AND user_id = ${userId} AND deleted_at IS NULL
  `
  if (rows.length === 0) return Response.json({ error: 'Project not found' }, { status: 404 })

  const data = rows[0].data as CfProjFile
  if (data.audioMode !== 'podcast') {
    return Response.json({ error: 'Not a podcast project' }, { status: 400 })
  }

  // Idempotent table creation
  await sql`
    CREATE TABLE IF NOT EXISTS podcast_feeds (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL,
      project_id  TEXT NOT NULL UNIQUE,
      slug        TEXT NOT NULL UNIQUE,
      created_at  TIMESTAMPTZ DEFAULT NOW(),
      updated_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `

  const showName = data.podcastMeta?.showName ?? data.name ?? 'untitled'
  const baseSlug = slugify(showName)

  // Resolve a unique slug (may already exist for this project — that's fine)
  const existing = await sql`SELECT slug FROM podcast_feeds WHERE project_id = ${id}`
  let slug: string
  if (existing.length > 0) {
    slug = existing[0].slug as string
  } else {
    // Find an unused slug
    const taken = await sql`SELECT slug FROM podcast_feeds WHERE slug LIKE ${baseSlug + '%'}`
    const takenSet = new Set(taken.map(r => r.slug as string))
    if (!takenSet.has(baseSlug)) {
      slug = baseSlug
    } else {
      let i = 2
      while (takenSet.has(`${baseSlug}-${i}`)) i++
      slug = `${baseSlug}-${i}`
    }
  }

  await sql`
    INSERT INTO podcast_feeds (id, user_id, project_id, slug)
    VALUES (${id}, ${userId}, ${id}, ${slug})
    ON CONFLICT (project_id) DO UPDATE
      SET updated_at = NOW()
  `

  const feedUrl = `https://100lights.app/api/podcast/${id}/feed.xml`
  return Response.json({ feedUrl, ok: true })
}
