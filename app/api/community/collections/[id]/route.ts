import { auth } from '@clerk/nextjs/server'
import { sql } from '@/lib/db'
import { ensureTables, devTestUser, isUuid } from '@/lib/community-server'

export const runtime = 'nodejs'

// GET /api/community/collections/[id] → { collection, items } (public)
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await ensureTables()
  const { id } = await params
  if (!isUuid(id)) return Response.json({ error: 'Not found' }, { status: 404 })
  try {
    const c = await sql`SELECT id, name, description, author_name, user_id, created_at FROM community_collections WHERE id = ${id} AND removed_at IS NULL`
    if (!c.length) return Response.json({ error: 'Not found' }, { status: 404 })
    const items = await sql`
      SELECT i.id, i.name, i.kind, i.author_name FROM community_collection_items ci
      JOIN community_items i ON i.id = ci.item_id AND i.removed_at IS NULL
      WHERE ci.collection_id = ${id}
      ORDER BY ci.position, ci.added_at
    `
    return Response.json({ collection: c[0], items })
  } catch {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }
}

// DELETE /api/community/collections/[id] (owner only) — soft-remove.
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await ensureTables()
  const { userId: clerkId } = await auth()
  const userId = clerkId ?? devTestUser(req)
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  if (!isUuid(id)) return Response.json({ error: 'Not found' }, { status: 404 })
  const rows = await sql`UPDATE community_collections SET removed_at = NOW() WHERE id = ${id} AND user_id = ${userId} AND removed_at IS NULL RETURNING id`
  if (!rows.length) return Response.json({ error: 'Not found' }, { status: 404 })
  return Response.json({ ok: true })
}

// PATCH /api/community/collections/[id] { name?, description? } (owner only)
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await ensureTables()
  const { userId: clerkId } = await auth()
  const userId = clerkId ?? devTestUser(req)
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  if (!isUuid(id)) return Response.json({ error: 'Not found' }, { status: 404 })
  let body: { name?: string; description?: string }
  try { body = await req.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const name = body.name?.trim()
  if (!name) return Response.json({ error: 'A name is required' }, { status: 400 })
  const rows = await sql`
    UPDATE community_collections SET name = ${name.slice(0, 80)}, description = ${(body.description ?? '').slice(0, 300)}
    WHERE id = ${id} AND user_id = ${userId} AND removed_at IS NULL RETURNING id`
  if (!rows.length) return Response.json({ error: 'Not found' }, { status: 404 })
  return Response.json({ ok: true })
}
