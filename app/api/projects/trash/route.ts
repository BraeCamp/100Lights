import { auth } from '@clerk/nextjs/server'
import { sql } from '@/lib/db'

export async function GET() {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const rows = await sql`
    SELECT id, name, deleted_at,
      data->'media' AS media
    FROM projects
    WHERE user_id = ${userId} AND deleted_at IS NOT NULL
    ORDER BY deleted_at DESC
  `

  return Response.json(rows.map(r => ({
    id:        r.id,
    name:      r.name,
    deletedAt: r.deleted_at,
    expiresAt: new Date(new Date(r.deleted_at as string).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    mediaCount: Array.isArray(r.media) ? r.media.length : 0,
  })))
}
