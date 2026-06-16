import { sql } from '@/lib/db'
import type { CfProjFile } from '@/lib/project-serializer'

// GET /api/share/:token — public; returns project name + outputs + captions (no media URLs)
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!token) return Response.json({ error: 'Invalid link' }, { status: 400 })

  const rows = await sql`
    SELECT name, data FROM projects
    WHERE share_token = ${token} AND deleted_at IS NULL
    LIMIT 1
  `

  if (rows.length === 0) return Response.json({ error: 'Share link not found or has been revoked.' }, { status: 404 })

  const data = rows[0].data as CfProjFile
  return Response.json({
    name:     rows[0].name,
    outputs:  data.outputs ?? [],
    captions: data.captions ?? [],
  })
}
