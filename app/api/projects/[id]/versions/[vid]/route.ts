import { auth } from '@clerk/nextjs/server'
import { sql } from '@/lib/db'

export const runtime = 'nodejs'

function testUser(req: Request): string | null {
  return process.env.DEV_OPEN === '1' && process.env.NODE_ENV !== 'production'
    ? req.headers.get('x-test-user')
    : null
}

async function requireOwner(projectId: string, userId: string | null): Promise<boolean> {
  if (!userId) return false
  const rows = await sql`SELECT 1 FROM projects WHERE id = ${projectId} AND user_id = ${userId} AND deleted_at IS NULL`
  return rows.length > 0
}

// GET /api/projects/:id/versions/:vid — the full snapshot (for restore)
export async function GET(req: Request, { params }: { params: Promise<{ id: string; vid: string }> }) {
  const { userId: clerkId } = await auth()
  const userId = clerkId ?? testUser(req)
  const { id, vid } = await params
  if (!await requireOwner(id, userId)) return Response.json({ error: 'Not found' }, { status: 404 })

  const rows = await sql`SELECT data FROM project_versions WHERE id = ${vid} AND project_id = ${id}`
  if (!rows.length) return Response.json({ error: 'Not found' }, { status: 404 })
  return Response.json(rows[0].data)
}

// DELETE /api/projects/:id/versions/:vid
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string; vid: string }> }) {
  const { userId: clerkId } = await auth()
  const userId = clerkId ?? testUser(req)
  const { id, vid } = await params
  if (!await requireOwner(id, userId)) return Response.json({ error: 'Not found' }, { status: 404 })

  await sql`DELETE FROM project_versions WHERE id = ${vid} AND project_id = ${id}`
  return Response.json({ ok: true })
}
