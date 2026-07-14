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
    GROUP BY i.id, i.kind, i.name, i.author_name
    ORDER BY report_count DESC, last_report DESC
    LIMIT 100
  `
  return Response.json({ items: rows })
}
