import { auth, currentUser } from '@clerk/nextjs/server'
import { after } from 'next/server'
import { sql } from '@/lib/db'
import { ensureTables, devTestUser, isUuid } from '@/lib/community-server'

export const runtime = 'nodejs'

interface CommentRow { id: string; author_name: string; body: string; created_at: string; user_id: string }
function toComment(r: Record<string, unknown>, userId: string | null) {
  return {
    id: r.id as string,
    authorName: r.author_name as string,
    body: r.body as string,
    createdAt: r.created_at as string,
    mine: userId !== null && r.user_id === userId,
  }
}

// GET /api/community/:id/comments — public list, oldest first
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId: clerkId } = await auth()
  const userId = clerkId ?? devTestUser(req)
  const { id } = await params
  if (!isUuid(id)) return Response.json({ error: 'Not found' }, { status: 404 })
  try {
    await ensureTables()
    const rows = await sql`
      SELECT id, author_name, body, created_at, user_id
      FROM community_comments WHERE item_id = ${id} ORDER BY created_at ASC
    ` as unknown as CommentRow[]
    return Response.json({ comments: rows.map(r => toComment(r as unknown as Record<string, unknown>, userId)) })
  } catch {
    return Response.json({ comments: [] })
  }
}

// POST /api/community/:id/comments — add a comment (requires a session)
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId: clerkId } = await auth()
  const userId = clerkId ?? devTestUser(req)
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  if (!isUuid(id)) return Response.json({ error: 'Not found' }, { status: 404 })

  let body: { body?: string; action?: string; commentId?: string; reason?: string }
  try { body = await req.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }

  // Report a comment to the moderators (one report per user per comment).
  if (body.action === 'report') {
    if (!body.commentId || !isUuid(body.commentId)) return Response.json({ error: 'Missing commentId' }, { status: 400 })
    await ensureTables()
    const c = await sql`SELECT 1 FROM community_comments WHERE id = ${body.commentId} AND item_id = ${id}`
    if (c.length === 0) return Response.json({ error: 'Not found' }, { status: 404 })
    await sql`
      INSERT INTO community_comment_reports (comment_id, item_id, user_id, reason)
      VALUES (${body.commentId}, ${id}, ${userId}, ${(body.reason ?? '').slice(0, 500)})
      ON CONFLICT (comment_id, user_id) DO UPDATE SET reason = EXCLUDED.reason, created_at = NOW()
    `
    return Response.json({ ok: true })
  }

  const text = body.body?.trim()
  if (!text) return Response.json({ error: 'Comment is empty' }, { status: 400 })

  await ensureTables()
  // The item must exist (and isn't deleted) before we hang a comment off it.
  const item = await sql`SELECT user_id, name FROM community_items WHERE id = ${id} AND removed_at IS NULL`
  if (item.length === 0) return Response.json({ error: 'Not found' }, { status: 404 })

  // Anti-spam: cap comments per user per hour (always on — comments are cheap
  // to flood and, unlike shares, aren't gated by the large-mode share limit).
  const recent = await sql`SELECT COUNT(*)::int AS n FROM community_comments WHERE user_id = ${userId} AND created_at > NOW() - INTERVAL '1 hour'`
  if ((recent[0]?.n ?? 0) >= 30) return Response.json({ error: 'You’re commenting a lot — take a short break and try again.' }, { status: 429 })

  const user = clerkId ? await currentUser() : null
  const authorName = user?.fullName ?? user?.username ?? (clerkId ? 'Anonymous' : userId)
  const rows = await sql`
    INSERT INTO community_comments (item_id, user_id, author_name, body)
    VALUES (${id}, ${userId}, ${authorName}, ${text.slice(0, 2000)})
    RETURNING id, author_name, body, created_at, user_id
  `

  // Notify the item's owner that someone commented (skip self-comments).
  const ownerId = item[0].user_id as string
  const itemName = item[0].name as string
  if (ownerId && ownerId !== userId) {
    const { notify } = await import('@/lib/notifications-server')
    await notify({
      userId: ownerId, type: 'comment', itemId: id, actorName: authorName,
      body: `${authorName} commented on “${itemName}”`,
    })
    // Email too, if a provider is configured — after the response so it never
    // slows the comment (no-op today: sendCommentEmail returns early with no key).
    after(async () => {
      const { sendCommentEmail } = await import('@/lib/email')
      await sendCommentEmail(ownerId, authorName, itemName, id)
    })
  }

  return Response.json({ comment: toComment(rows[0], userId) })
}

// DELETE /api/community/:id/comments?commentId=... — author of the comment or admin
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId: clerkId } = await auth()
  const userId = clerkId ?? devTestUser(req)
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  if (!isUuid(id)) return Response.json({ error: 'Not found' }, { status: 404 })
  const commentId = new URL(req.url).searchParams.get('commentId')
  if (!commentId || !isUuid(commentId)) return Response.json({ error: 'Missing commentId' }, { status: 400 })

  const { isAdmin } = await import('@/lib/admin-auth')
  const admin = await isAdmin()
  const rows = await sql`
    DELETE FROM community_comments
    WHERE id = ${commentId} AND item_id = ${id} AND (user_id = ${userId} OR ${admin})
    RETURNING id, user_id
  `
  if (rows.length === 0) return Response.json({ error: 'Not found or not yours' }, { status: 404 })
  await sql`DELETE FROM community_comment_reports WHERE comment_id = ${commentId}`
  if (admin && String(rows[0].user_id) !== userId) {
    const { logAdmin } = await import('@/lib/admin-audit')
    await logAdmin('community.remove_comment', commentId, { itemId: id, owner: String(rows[0].user_id) })
  }
  return Response.json({ ok: true })
}
