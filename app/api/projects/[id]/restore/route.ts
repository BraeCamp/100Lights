import { auth } from '@clerk/nextjs/server'
import { sql } from '@/lib/db'

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const result = await sql`
    UPDATE projects SET deleted_at = NULL
    WHERE id = ${id} AND user_id = ${userId} AND deleted_at IS NOT NULL
  `

  if ((result as unknown as { rowCount?: number }).rowCount === 0) {
    return Response.json({ error: 'Project not found in trash' }, { status: 404 })
  }
  return Response.json({ ok: true })
}
