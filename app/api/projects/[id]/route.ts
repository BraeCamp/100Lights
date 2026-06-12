import { auth } from '@clerk/nextjs/server'
import { sql } from '@/lib/db'
import type { CfProjFile } from '@/lib/project-serializer'

// GET /api/projects/:id
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const rows = await sql`
    SELECT data FROM projects WHERE id = ${id} AND user_id = ${userId}
  `

  if (rows.length === 0) return Response.json({ error: 'Project not found' }, { status: 404 })
  return Response.json(rows[0].data as CfProjFile)
}

// DELETE /api/projects/:id
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const result = await sql`
    DELETE FROM projects WHERE id = ${id} AND user_id = ${userId}
  `

  if ((result as unknown as { rowCount?: number }).rowCount === 0) {
    return Response.json({ error: 'Project not found' }, { status: 404 })
  }
  return Response.json({ ok: true })
}
