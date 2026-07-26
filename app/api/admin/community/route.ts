import { sql } from '@/lib/db'
import { isAdmin } from '@/lib/admin-auth'
import { ensureTables } from '@/lib/community-server'
import { logAdmin } from '@/lib/admin-audit'

export const runtime = 'nodejs'

// GET /api/admin/community/removed — soft-removed items awaiting restore/purge.
export async function GET() {
  if (!await isAdmin()) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  await ensureTables()
  const rows = await sql`
    SELECT id, kind, name, author_name, votes, downloads, removed_at, removed_by, removed_reason
    FROM community_items
    WHERE removed_at IS NOT NULL
    ORDER BY removed_at DESC
    LIMIT 100
  `
  return Response.json({ items: rows })
}

// POST /api/admin/community — { id, action: 'restore' | 'purge' }.
// restore: clear the soft-removal so it's public again.
// purge:   permanently delete the item + its votes/reactions/reports/comments.
export async function POST(req: Request) {
  if (!await isAdmin()) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  await ensureTables()
  const { id, action } = await req.json().catch(() => ({})) as { id?: string; action?: string }
  if (!id) return Response.json({ error: 'id required' }, { status: 400 })

  if (action === 'restore') {
    const rows = await sql`UPDATE community_items SET removed_at = NULL, removed_by = NULL, removed_reason = NULL WHERE id = ${id} AND removed_at IS NOT NULL RETURNING id`
    if (rows.length === 0) return Response.json({ error: 'Not in the removed list' }, { status: 404 })
    await logAdmin('community.restore', id)
    return Response.json({ ok: true })
  }

  if (action === 'purge') {
    const rows = await sql`DELETE FROM community_items WHERE id = ${id} RETURNING id`
    if (rows.length === 0) return Response.json({ error: 'Not found' }, { status: 404 })
    await sql`DELETE FROM community_votes WHERE item_id = ${id}`
    await sql`DELETE FROM community_reactions WHERE item_id = ${id}`
    await sql`DELETE FROM community_reports WHERE item_id = ${id}`
    await sql`DELETE FROM community_comments WHERE item_id = ${id}`
    await logAdmin('community.purge', id)
    return Response.json({ ok: true })
  }

  return Response.json({ error: "action must be 'restore' or 'purge'" }, { status: 400 })
}
