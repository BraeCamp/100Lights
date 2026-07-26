import { sql } from '@/lib/db'
import { isAdmin } from '@/lib/admin-auth'
import { ensureTables } from '@/lib/community-server'

export const runtime = 'nodejs'

// GET /api/community/reports — the admin takedown queue: reported items with
// report counts and reasons, most-reported first.
export async function GET() {
  if (!await isAdmin()) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  await ensureTables()
  const rows = await sql`
    SELECT i.id, i.kind, i.name, i.author_name,
           COUNT(r.id)::int AS report_count,
           MAX(r.created_at) AS last_report,
           ARRAY_AGG(r.reason) FILTER (WHERE r.reason <> '') AS reasons
    FROM community_reports r
    JOIN community_items i ON i.id = r.item_id
    WHERE i.removed_at IS NULL
    GROUP BY i.id, i.kind, i.name, i.author_name
    ORDER BY report_count DESC, last_report DESC
    LIMIT 100
  `
  // Reported comments — grouped, most-reported first, with the offending text.
  let comments: unknown[] = []
  try {
    comments = await sql`
      SELECT c.id, c.item_id, c.author_name, c.body,
             COUNT(cr.id)::int AS report_count,
             MAX(cr.created_at) AS last_report,
             ARRAY_AGG(cr.reason) FILTER (WHERE cr.reason <> '') AS reasons
      FROM community_comment_reports cr
      JOIN community_comments c ON c.id = cr.comment_id
      GROUP BY c.id, c.item_id, c.author_name, c.body
      ORDER BY report_count DESC, last_report DESC
      LIMIT 100
    `
  } catch { /* table may not exist yet */ }
  return Response.json({ items: rows, comments })
}

// DELETE /api/community/reports?itemId=… (or ?commentId=…) — dismiss the reports
// on a piece of content the moderator has reviewed and decided is fine, so the
// takedown queue reflects reality instead of staying flagged forever.
export async function DELETE(req: Request) {
  if (!await isAdmin()) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  await ensureTables()
  const url = new URL(req.url)
  const itemId = url.searchParams.get('itemId')
  const commentId = url.searchParams.get('commentId')
  const { logAdmin } = await import('@/lib/admin-audit')
  if (itemId) {
    await sql`DELETE FROM community_reports WHERE item_id = ${itemId}`
    await logAdmin('community.dismiss_reports', itemId, { kind: 'item' })
    return Response.json({ ok: true })
  }
  if (commentId) {
    try { await sql`DELETE FROM community_comment_reports WHERE comment_id = ${commentId}` } catch { /* table may not exist */ }
    await logAdmin('community.dismiss_reports', commentId, { kind: 'comment' })
    return Response.json({ ok: true })
  }
  return Response.json({ error: 'itemId or commentId required' }, { status: 400 })
}
