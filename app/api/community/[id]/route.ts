import { auth } from '@clerk/nextjs/server'
import { sql } from '@/lib/db'

export const runtime = 'nodejs'

function devTestUser(req: Request): string | null {
  return process.env.DEV_OPEN === '1' && process.env.NODE_ENV !== 'production'
    ? req.headers.get('x-test-user') && `test-${req.headers.get('x-test-user')}`
    : null
}

// POST /api/community/:id — actions: { action: 'vote' | 'download' }
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId: clerkId } = await auth()
  const userId = clerkId ?? devTestUser(req)
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  let body: { action?: string }
  try { body = await req.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }

  if (body.action === 'vote') {
    // Toggle: one vote per user per item, kept consistent with the count
    const existing = await sql`SELECT 1 FROM community_votes WHERE item_id = ${id} AND user_id = ${userId}`
    if (existing.length > 0) {
      await sql`DELETE FROM community_votes WHERE item_id = ${id} AND user_id = ${userId}`
      const rows = await sql`UPDATE community_items SET votes = votes - 1 WHERE id = ${id} RETURNING votes`
      return Response.json({ votes: rows[0]?.votes ?? 0, votedByMe: false })
    }
    await sql`INSERT INTO community_votes (item_id, user_id) VALUES (${id}, ${userId}) ON CONFLICT DO NOTHING`
    const rows = await sql`UPDATE community_items SET votes = votes + 1 WHERE id = ${id} RETURNING votes`
    return Response.json({ votes: rows[0]?.votes ?? 0, votedByMe: true })
  }

  if (body.action === 'download') {
    const rows = await sql`UPDATE community_items SET downloads = downloads + 1 WHERE id = ${id} RETURNING downloads`
    return Response.json({ downloads: rows[0]?.downloads ?? 0 })
  }

  return Response.json({ error: 'Unknown action' }, { status: 400 })
}

// DELETE /api/community/:id — authors remove their own items
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId: clerkId } = await auth()
  const userId = clerkId ?? devTestUser(req)
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const rows = await sql`DELETE FROM community_items WHERE id = ${id} AND user_id = ${userId} RETURNING id`
  if (rows.length === 0) return Response.json({ error: 'Not found or not yours' }, { status: 404 })
  await sql`DELETE FROM community_votes WHERE item_id = ${id}`
  return Response.json({ ok: true })
}
