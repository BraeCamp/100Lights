import { auth } from '@clerk/nextjs/server'
import { sql } from '@/lib/db'
import { ensureTables, devTestUser, isUuid } from '@/lib/community-server'

export const runtime = 'nodejs'

// Owner-only guard: the collection must exist, not be removed, and belong to the
// caller. Returns true if the caller may modify it.
async function ownsCollection(id: string, userId: string): Promise<boolean> {
  const rows = await sql`SELECT 1 FROM community_collections WHERE id = ${id} AND user_id = ${userId} AND removed_at IS NULL LIMIT 1`
  return rows.length > 0
}

// POST /api/community/collections/[id]/items { itemId } — add an item.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await ensureTables()
  const { userId: clerkId } = await auth()
  const userId = clerkId ?? devTestUser(req)
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  let body: { itemId?: string }
  try { body = await req.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const itemId = body.itemId
  if (!isUuid(id) || !itemId || !isUuid(itemId)) return Response.json({ error: 'Bad request' }, { status: 400 })
  if (!(await ownsCollection(id, userId))) return Response.json({ error: 'Not found' }, { status: 404 })

  const exists = await sql`SELECT 1 FROM community_items WHERE id = ${itemId} AND removed_at IS NULL LIMIT 1`
  if (!exists.length) return Response.json({ error: 'Item not found' }, { status: 404 })

  // Append at the end; ignore if already present.
  await sql`
    INSERT INTO community_collection_items (collection_id, item_id, position)
    VALUES (${id}, ${itemId}, COALESCE((SELECT MAX(position) + 1 FROM community_collection_items WHERE collection_id = ${id}), 0))
    ON CONFLICT (collection_id, item_id) DO NOTHING
  `
  return Response.json({ ok: true })
}

// DELETE /api/community/collections/[id]/items?itemId=X — remove an item.
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await ensureTables()
  const { userId: clerkId } = await auth()
  const userId = clerkId ?? devTestUser(req)
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const itemId = new URL(req.url).searchParams.get('itemId')
  if (!isUuid(id) || !itemId || !isUuid(itemId)) return Response.json({ error: 'Bad request' }, { status: 400 })
  if (!(await ownsCollection(id, userId))) return Response.json({ error: 'Not found' }, { status: 404 })
  await sql`DELETE FROM community_collection_items WHERE collection_id = ${id} AND item_id = ${itemId}`
  return Response.json({ ok: true })
}
