import { auth } from '@clerk/nextjs/server'
import { sql } from '@/lib/db'
import { deleteObjects } from '@/lib/r2'
import type { CfProjFile, SerializedMedia } from '@/lib/project-serializer'

// GET /api/projects/:id
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const rows = await sql`
    SELECT data FROM projects WHERE id = ${id} AND user_id = ${userId} AND deleted_at IS NULL
  `

  if (rows.length === 0) return Response.json({ error: 'Project not found' }, { status: 404 })
  return Response.json(rows[0].data as CfProjFile)
}

// DELETE /api/projects/:id
// ?permanent=true → hard-delete from DB and purge R2 files
// default → soft-delete (move to trash)
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const permanent = new URL(req.url).searchParams.get('permanent') === 'true'

  if (permanent) {
    const rows = await sql`
      SELECT data FROM projects WHERE id = ${id} AND user_id = ${userId}
    `
    if (rows.length === 0) return Response.json({ error: 'Project not found' }, { status: 404 })

    const data = rows[0].data as CfProjFile
    const r2Keys = (data.media as SerializedMedia[]).map(m => m.r2Key).filter(Boolean) as string[]
    await Promise.all([
      deleteObjects(r2Keys),
      sql`DELETE FROM projects WHERE id = ${id} AND user_id = ${userId}`,
    ])
  } else {
    const result = await sql`
      UPDATE projects SET deleted_at = NOW()
      WHERE id = ${id} AND user_id = ${userId} AND deleted_at IS NULL
    `
    if ((result as unknown as { rowCount?: number }).rowCount === 0) {
      return Response.json({ error: 'Project not found' }, { status: 404 })
    }
  }

  return Response.json({ ok: true })
}
