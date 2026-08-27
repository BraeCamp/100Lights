import { auth } from '@clerk/nextjs/server'
import { sql } from '@/lib/db'
import { ensureTables, devTestUser, rowToItem, reactionMaps, commentCounts, proUserIds, REACTION_EMOJI, LARGE_MODE_LIMITS, isUuid } from '@/lib/community-server'
import { getFlags } from '@/lib/platform-flags'
import { schemaManaged } from '@/lib/schema-guard'

// Was a CREATE TABLE on every large-mode community action — i.e. a DDL
// round-trip before each rate-limit check. Memoised per process, and skipped
// entirely once SCHEMA_MANAGED=1 (db/migrations owns this table).
let actionLogReady = false
async function ensureActionLog() {
  if (actionLogReady || schemaManaged) return
  await sql`
    CREATE TABLE IF NOT EXISTS community_action_log (
      user_id TEXT NOT NULL,
      at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  actionLogReady = true
}

export const runtime = 'nodejs'

// GET /api/community/:id — public single-item fetch (powers /community/{id})
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId: clerkId } = await auth()
  const userId = clerkId ?? devTestUser(req)
  await ensureTables()

  const { id } = await params
  if (!isUuid(id)) return Response.json({ error: 'Not found' }, { status: 404 })
  const rows = await sql`SELECT * FROM community_items WHERE id = ${id} AND removed_at IS NULL`
  if (rows.length === 0) return Response.json({ error: 'Not found' }, { status: 404 })

  const votedIds = new Set<string>()
  if (userId) {
    const v = await sql`SELECT 1 FROM community_votes WHERE item_id = ${id} AND user_id = ${userId}`
    if (v.length) votedIds.add(id)
  }
  const { reactions, mine } = await reactionMaps([id], userId)
  const comments = await commentCounts([id])
  const proAuthors = await proUserIds([rows[0].user_id as string])
  return Response.json({ item: rowToItem(rows[0], userId, votedIds, reactions, mine, comments, proAuthors) })
}

// PATCH /api/community/:id — author (or admin) edits an item's title/description.
// Used for text posts; harmless for any own item.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId: clerkId } = await auth()
  const userId = clerkId ?? devTestUser(req)
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  if (!isUuid(id)) return Response.json({ error: 'Not found' }, { status: 404 })

  let body: { name?: string; description?: string }
  try { body = await req.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }
  if (body.name === undefined && body.description === undefined) {
    return Response.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const { isAdmin } = await import('@/lib/admin-auth')
  const admin = await isAdmin()
  const rows = await sql`SELECT user_id, kind FROM community_items WHERE id = ${id}`
  if (rows.length === 0) return Response.json({ error: 'Not found' }, { status: 404 })
  if (rows[0].user_id !== userId && !admin) return Response.json({ error: 'Not yours' }, { status: 403 })

  const descLimit = rows[0].kind === 'post' ? 4000 : 500
  const name = body.name !== undefined ? body.name.trim().slice(0, 120) : undefined
  const description = body.description !== undefined ? body.description.slice(0, descLimit) : undefined
  if (name !== undefined && !name) return Response.json({ error: 'Name cannot be empty' }, { status: 400 })

  await sql`
    UPDATE community_items
    SET name = COALESCE(${name ?? null}, name),
        description = COALESCE(${description ?? null}, description)
    WHERE id = ${id}
  `
  return Response.json({ ok: true })
}

// POST /api/community/:id — actions: vote (auth), react (auth), download (public count)
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId: clerkId } = await auth()
  const userId = clerkId ?? devTestUser(req)

  const { id } = await params
  if (!isUuid(id)) return Response.json({ error: 'Not found' }, { status: 404 })
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
    await ensureActionLog()
    const n = await sql`SELECT COUNT(*)::int AS n FROM community_action_log WHERE user_id = ${userId} AND at > NOW() - INTERVAL '1 hour'`
    if ((n[0]?.n ?? 0) >= LARGE_MODE_LIMITS.actionsPerHour) {
      return Response.json({ error: 'Slow down — too many actions this hour' }, { status: 429 })
    }
    await sql`INSERT INTO community_action_log (user_id) VALUES (${userId})`
    // Opportunistic cleanup keeps the log tiny
    if (Math.random() < 0.02) await sql`DELETE FROM community_action_log WHERE at < NOW() - INTERVAL '2 hours'`
  }

  if (body.action === 'vote') {
    // Toggle, race-safe: the counter changes ONLY when the vote row actually
    // changed. Two concurrent double-clicks used to both increment (INSERT is
    // idempotent but the +1 was not gated on it), drifting the count above the
    // real row total — here we key the bump off the INSERT/DELETE row count.
    const existing = await sql`SELECT 1 FROM community_votes WHERE item_id = ${id} AND user_id = ${userId}`
    if (existing.length > 0) {
      const del = await sql`DELETE FROM community_votes WHERE item_id = ${id} AND user_id = ${userId} RETURNING 1`
      if (del.length === 0) {
        const cur = await sql`SELECT votes FROM community_items WHERE id = ${id}`
        return Response.json({ votes: cur[0]?.votes ?? 0, votedByMe: false })
      }
      const rows = await sql`UPDATE community_items SET votes = GREATEST(0, votes - 1) WHERE id = ${id} RETURNING votes`
      return Response.json({ votes: rows[0]?.votes ?? 0, votedByMe: false })
    }
    const ins = await sql`INSERT INTO community_votes (item_id, user_id) VALUES (${id}, ${userId}) ON CONFLICT DO NOTHING RETURNING 1`
    if (ins.length === 0) {
      const cur = await sql`SELECT votes FROM community_items WHERE id = ${id}`
      return Response.json({ votes: cur[0]?.votes ?? 0, votedByMe: true })
    }
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
  if (!isUuid(id)) return Response.json({ error: 'Not found' }, { status: 404 })
  const { isAdmin } = await import('@/lib/admin-auth')
  const admin = await isAdmin()

  const [item] = await sql`SELECT user_id FROM community_items WHERE id = ${id} AND removed_at IS NULL`
  if (!item) return Response.json({ error: 'Not found or not yours' }, { status: 404 })
  const owner = String(item.user_id)
  const isOwner = owner === userId
  if (!isOwner && !admin) return Response.json({ error: 'Not found or not yours' }, { status: 404 })

  if (isOwner) {
    // The author removing their own item — hard delete, as before.
    await sql`DELETE FROM community_items WHERE id = ${id}`
    await sql`DELETE FROM community_votes WHERE item_id = ${id}`
    await sql`DELETE FROM community_reactions WHERE item_id = ${id}`
    await sql`DELETE FROM community_reports WHERE item_id = ${id}`
    await sql`DELETE FROM community_comments WHERE item_id = ${id}`
    return Response.json({ ok: true })
  }

  // Admin moderation — soft remove so it can be restored. Votes/reactions/
  // comments are kept; the item just disappears from every public read.
  const reason = new URL(req.url).searchParams.get('reason')?.slice(0, 500) || null
  await sql`UPDATE community_items SET removed_at = NOW(), removed_by = ${userId}, removed_reason = ${reason} WHERE id = ${id}`
  const { logAdmin } = await import('@/lib/admin-audit')
  await logAdmin('community.remove_item', id, { owner, reason })
  return Response.json({ ok: true, softRemoved: true })
}
