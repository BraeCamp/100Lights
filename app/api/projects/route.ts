import { auth } from '@clerk/nextjs/server'
import { sql } from '@/lib/db'
import type { CfProjFile } from '@/lib/project-serializer'

// GET /api/projects — list the current user's projects
export async function GET() {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const rows = await sql`
    SELECT
      id, name, saved_at,
      data->'clips'            AS clips,
      data->'media'            AS media,
      data->'media'->0->>'thumbnail' AS thumbnail
    FROM projects
    WHERE user_id = ${userId}
    ORDER BY saved_at DESC
  `

  return Response.json(rows.map(r => ({
    id:        r.id,
    name:      r.name,
    savedAt:   r.saved_at,
    clips:     Array.isArray(r.clips) ? r.clips.length : 0,
    media:     Array.isArray(r.media) ? r.media.length : 0,
    thumbnail: r.thumbnail ?? null,
  })))
}

// POST /api/projects — upsert a project for the current user
export async function POST(req: Request) {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  let body: CfProjFile
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (body._type !== '100lights-project' || !body.id || !body.name) {
    return Response.json({ error: 'Not a valid 100Lights project file' }, { status: 400 })
  }

  const project: CfProjFile = { ...body, userId }
  const savedAt = new Date().toISOString()

  await sql`
    INSERT INTO projects (id, user_id, name, saved_at, data)
    VALUES (${project.id}, ${userId}, ${project.name}, ${savedAt}, ${JSON.stringify(project) as unknown as object})
    ON CONFLICT (id) DO UPDATE
      SET name     = EXCLUDED.name,
          saved_at = EXCLUDED.saved_at,
          data     = EXCLUDED.data
  `

  return Response.json({ ok: true, id: project.id, savedAt })
}
