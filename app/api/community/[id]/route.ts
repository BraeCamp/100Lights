import { auth } from '@clerk/nextjs/server'
import { sql } from '@/lib/db'
import { ensureTables, devTestUser, rowToItem, reactionMaps, REACTION_EMOJI, LARGE_MODE_LIMITS } from '@/lib/community-server'
import { getFlags } from '@/lib/platform-flags'

export const runtime = 'nodejs'

// GET /api/community/:id — public single-item fetch (powers /community/{id})
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId: clerkId } = await auth()
  const userId = clerkId ?? devTestUser(req)
  await ensureTables()

  const { id } = await params
  const rows = await sql`SELECT * FROM community_items WHERE id = ${id}`
  if (rows.length === 0) return Response.json({ error: 'Not found' }, { status: 404 })

  const votedIds = new Set<string>()
  if (userId) {
    const v = await sql`SELECT 1 FROM community_votes WHERE item_id = ${id} AND user_id = ${userId}`
    if (v.length) votedIds.add(id)
  }
  const { reactions, mine } = await reactionMaps([id], userId)
  return Response.json({ item: rowToItem(rows[0], userId, votedIds, reactions, mine) })
}

// POST /api/community/:id — actions: vote (auth), react (auth), download (public count)
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId: clerkId } = await auth()
  const userId = clerkId ?? devTestUser(req)

  const { id } = await params
  let body: { action?: string; emoji?: string; reason?: string }
  try { body = await req.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }

  if (body.action === 'download') {
    const rows = await sql`UPDATE community_items SET downloads = downloads + 1 WHERE id = ${id} RETURNING downloads`
    return Response.json({ downloads: rows[0]?.downloads ?? 0 })
  }

  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  // At scale, votes+reactions are rate limited per user via a sliding-window
  // action log (the vote/reaction tables themselves carry no timestamps).
  const { communityScale } = await getFlags()
  if (communityScale === 'large') {
    await ensureTables()
    await sql`
      CREATE TABLE IF NOT EXISTS community_action_log (
        user_id TEXT NOT NULL,
        at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `
    const n = await sql`SELECT COUNT(*)::int AS n FROM community_action_log WHERE user_id = ${userId} AND at > NOW() - INTERVAL '1 hour'`
    if ((n[0]?.n ?? 0) >= LARGE_MODE_LIMITS.actionsPerHour) {
      return Response.json({ error: 'Slow down — too many actions this hour' }, { status: 429 })
    }
    await sql`INSERT INTO community_action_log (user_id) VALUES (${userId})`
    // Opportunistic cleanup keeps the log tiny
    if (Math.random() < 0.02) await sql`DELETE FROM community_action_log WHERE at < NOW() - INTERVAL '2 hours'`
  }

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

  if (body.action === 'report') {
    await ensureTables()
    const reason = (body as { reason?: string }).reason?.slice(0, 500) ?? ''
    await sql`
      INSERT INTO community_reports (item_id, user_id, reason) VALUES (${id}, ${userId}, ${reason})
      ON CONFLICT (item_id, user_id) DO UPDATE SET reason = EXCLUDED.reason, created_at = NOW()
    `
    return Response.json({ ok: true })
  }

  if (body.action === 'react') {
    if (!body.emoji || !REACTION_EMOJI.includes(body.emoji)) return Response.json({ error: 'Unknown emoji' }, { status: 400 })
    await ensureTables()
    const existing = await sql`SELECT 1 FROM community_reactions WHERE item_id = ${id} AND user_id = ${userId} AND emoji = ${body.emoji}`
    if (existing.length > 0) {
      await sql`DELETE FROM community_reactions WHERE item_id = ${id} AND user_id = ${userId} AND emoji = ${body.emoji}`
    } else {
      await sql`INSERT INTO community_reactions (item_id, user_id, emoji) VALUES (${id}, ${userId}, ${body.emoji}) ON CONFLICT DO NOTHING`
    }
    const rows = await sql`SELECT emoji, COUNT(*)::int AS n FROM community_reactions WHERE item_id = ${id} GROUP BY emoji`
    const reactions: Record<string, number> = {}
    for (const r of rows) reactions[r.emoji as string] = r.n as number
    return Response.json({ reactions, mine: existing.length === 0 })
  }

  return Response.json({ error: 'Unknown action' }, { status: 400 })
}

// DELETE /api/community/:id — authors remove their own items; admins any item
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId: clerkId } = await auth()
  const userId = clerkId ?? devTestUser(req)
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const { isAdmin } = await import('@/lib/admin-auth')
  const admin = await isAdmin()
  const rows = await sql`DELETE FROM community_items WHERE id = ${id} AND (user_id = ${userId} OR ${admin}) RETURNING id`
  if (rows.length === 0) return Response.json({ error: 'Not found or not yours' }, { status: 404 })
  await sql`DELETE FROM community_votes WHERE item_id = ${id}`
  await sql`DELETE FROM community_reactions WHERE item_id = ${id}`
  await sql`DELETE FROM community_reports WHERE item_id = ${id}`
  return Response.json({ ok: true })
}
