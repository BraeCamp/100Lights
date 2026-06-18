import { auth } from '@clerk/nextjs/server'
import { sql } from '@/lib/db'
import type { CfProjFile } from '@/lib/project-serializer'

// PUT /api/projects/:id/autosave
// Writes to autosave_data column — never touches the manually-saved data column.
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  let body: CfProjFile
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const rows = await sql`
    UPDATE projects
    SET autosave_data = ${JSON.stringify(body) as unknown as object}
    WHERE id = ${id} AND user_id = ${userId} AND deleted_at IS NULL
    RETURNING id
  `
  if (rows.length === 0) return Response.json({ error: 'Project not found' }, { status: 404 })
  return Response.json({ ok: true })
}

// DELETE /api/projects/:id/autosave — clears the cloud autosave after a manual save
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  await sql`
    UPDATE projects
    SET autosave_data = NULL
    WHERE id = ${id} AND user_id = ${userId} AND deleted_at IS NULL
  `
  return Response.json({ ok: true })
}
