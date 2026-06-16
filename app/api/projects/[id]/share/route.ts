import { auth } from '@clerk/nextjs/server'
import { sql } from '@/lib/db'
import { randomBytes } from 'crypto'

// POST /api/projects/:id/share — generate (or return existing) share token
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  // Check ownership
  const rows = await sql`SELECT share_token FROM projects WHERE id = ${id} AND user_id = ${userId} AND deleted_at IS NULL`
  if (rows.length === 0) return Response.json({ error: 'Project not found' }, { status: 404 })

  // Reuse existing token or generate new one
  const token = (rows[0].share_token as string | null) ?? randomBytes(16).toString('hex')

  await sql`UPDATE projects SET share_token = ${token} WHERE id = ${id} AND user_id = ${userId}`

  return Response.json({ token, url: `/share/${token}` })
}

// DELETE /api/projects/:id/share — revoke share link
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  await sql`UPDATE projects SET share_token = NULL WHERE id = ${id} AND user_id = ${userId}`
  return Response.json({ ok: true })
}
