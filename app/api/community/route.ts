import { auth, currentUser } from '@clerk/nextjs/server'
import { sql } from '@/lib/db'
import { COMMUNITY_KINDS, ensureTables, devTestUser, rowToItem, reactionMaps, commentCounts, proUserIds, LARGE_MODE_LIMITS, isUuid, communityHandle } from '@/lib/community-server'
import { getFlags } from '@/lib/platform-flags'
import { isAdminEmail } from '@/lib/admin-auth'
import { getSubscription } from '@/lib/subscription'
import { entitlements } from '@/lib/entitlements'

export const runtime = 'nodejs'

// Community exchange: users share songs (rendered mixes), samples (R2-backed),
// presets (render specs, no blobs), recipes (note patterns), packs (sample
// bundles), and project starters (remixable arrangements) — browse, listen,
// vote, react, import. Reading is public; writing requires a session.

// GET /api/community?kind=&sort=top|new|trending&q=&tag=&author=&page=0
// Public: signed-out visitors browse and listen; votedByMe/mine are false.
export async function GET(req: Request) {
  const { userId: clerkId } = await auth()
  const userId = clerkId ?? devTestUser(req)
  await ensureTables()

  const url = new URL(req.url)
  const kind = url.searchParams.get('kind')
  const { communityScale } = await getFlags()
  // No explicit sort → the mode decides: a small community shows everything
  // newest-first (nothing gets buried); a large one leads with trending.
  const sortParam = url.searchParams.get('sort') ?? (communityScale === 'large' ? 'trending' : 'new')
  const q = url.searchParams.get('q')?.trim() || null
  const tag = url.searchParams.get('tag')?.trim() || null
  const author = url.searchParams.get('author')?.trim() || null
  // Comma-separated LibraryCategory values (a library category-group's members)
  const category = url.searchParams.get('category')?.trim() || null
  const page = Math.max(0, parseInt(url.searchParams.get('page') ?? '0', 10) || 0)
  const PAGE_SIZE = 50

  // Trending: votes tempered by age — a fresh item with a few votes beats an
  // ancient one that accumulated slowly.
  const order =
    sortParam === 'new' ? sql`created_at DESC` :
    sortParam === 'name' ? sql`LOWER(name) ASC` :
    sortParam === 'trending' ? sql`(votes + downloads * 0.5 + 1) / POWER(EXTRACT(EPOCH FROM (NOW() - created_at)) / 3600 + 2, 1.4) DESC` :
    sql`votes DESC, created_at DESC`

  // Library-style search: the query looks INSIDE items too — tags, the names
  // and categories of a pack's samples, and a song's musical key — not just
  // the title line.
  const like = q ? `%${q}%` : null
  const where = sql`
    (${kind}::text IS NULL OR kind = ${kind})
      AND (${author}::text IS NULL OR author_name = ${author})
      AND (${tag}::text IS NULL OR payload->'tags' ? ${tag})
      AND (${category}::text IS NULL
        OR payload->>'category' = ANY(string_to_array(${category ?? ''}, ','))
        OR EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(payload->'samples', '[]'::jsonb)) elem
                   WHERE elem->>'category' = ANY(string_to_array(${category ?? ''}, ','))))
      AND (${like}::text IS NULL
        OR name ILIKE ${like ?? ''} OR description ILIKE ${like ?? ''} OR author_name ILIKE ${like ?? ''}
        OR payload->>'key' ILIKE ${like ?? ''}
        OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(payload->'tags', '[]'::jsonb)) t WHERE t ILIKE ${like ?? ''})
        OR EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(payload->'samples', '[]'::jsonb)) elem WHERE elem->>'name' ILIKE ${like ?? ''}))
      AND removed_at IS NULL`

  const rows = await sql`
    SELECT * FROM community_items
    WHERE ${where}
    ORDER BY ${order}
    LIMIT ${PAGE_SIZE + 1} OFFSET ${page * PAGE_SIZE}
  `
  const totalRows = await sql`SELECT COUNT(*)::int AS n FROM community_items WHERE ${where}`
  const hasMore = rows.length > PAGE_SIZE
  const pageRows = rows.slice(0, PAGE_SIZE)

  const votedIds = new Set<string>()
  const pageIds = pageRows.map(r => r.id as string)
  if (userId && pageIds.length) {
    // Scope to the visible page (was: every vote the user ever cast) — only
    // pageRows consult votedIds, and this now uses the new user_id index.
    const myVotes = await sql`SELECT item_id FROM community_votes WHERE user_id = ${userId} AND item_id = ANY(${pageIds}::uuid[])`
    for (const r of myVotes) votedIds.add(r.item_id as string)
  }
  const { reactions, mine } = await reactionMaps(pageRows.map(r => r.id as string), userId)
  const comments = await commentCounts(pageRows.map(r => r.id as string))
  const proAuthors = await proUserIds(pageRows.map(r => r.user_id as string))

  // Community pulse for the feed header — makes a small feed feel alive
  const statRows = await sql`SELECT COUNT(*)::int AS items, COUNT(DISTINCT author_name)::int AS authors FROM community_items WHERE removed_at IS NULL`

  const res = Response.json({
    items: pageRows.map(r => rowToItem(r, userId, votedIds, reactions, mine, comments, proAuthors)),
    hasMore,
    total: totalRows[0]?.n ?? 0,
    scale: communityScale,
    sortUsed: sortParam,
    stats: { items: statRows[0]?.items ?? 0, authors: statRows[0]?.authors ?? 0 },
  })
  // At scale, anonymous reads are cacheable at the edge (no per-user data in them)
  if (communityScale === 'large' && !userId) {
    res.headers.set('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=120')
  }
  return res
}

// POST /api/community — share an item (requires a session)
export async function POST(req: Request) {
  const { userId: clerkId } = await auth()
  const userId = clerkId ?? devTestUser(req)
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  await ensureTables()

  let body: { kind?: string; name?: string; description?: string; payload?: unknown; r2Key?: string; asOfficial?: boolean; remixedFrom?: string }
  try { body = await req.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { kind, name } = body
  if (!kind || !(COMMUNITY_KINDS as readonly string[]).includes(kind) || !name?.trim()) {
    return Response.json({ error: `kind (${COMMUNITY_KINDS.join('|')}) and name are required` }, { status: 400 })
  }
  const audioKind = kind === 'sample' || kind === 'song'
  // A 'post' is a plain text discussion/help item — carries its body in
  // `description`, so it needs neither audio nor a payload.
  if (audioKind && !body.r2Key) return Response.json({ error: `${kind} requires r2Key` }, { status: 400 })
  if (!audioKind && kind !== 'post' && !body.payload) return Response.json({ error: `${kind} requires payload` }, { status: 400 })
  if (kind === 'post' && !body.description?.trim()) return Response.json({ error: 'post requires a body' }, { status: 400 })
  const payloadJson = body.payload ? JSON.stringify(body.payload) : null
  if (payloadJson && payloadJson.length > 900_000) return Response.json({ error: 'payload too large' }, { status: 413 })

  const { communityScale } = await getFlags()
  // Daily share cap = the stricter of the plan limit (free is capped, Pro isn't)
  // and any large-community throttle. Free users hit their limit first.
  const sub = await getSubscription(userId)
  const planLimit  = entitlements(sub.plan).communityPostsPerDay
  const scaleLimit = communityScale === 'large' ? LARGE_MODE_LIMITS.sharesPerDay : Infinity
  const dailyCap   = Math.min(planLimit, scaleLimit)
  if (Number.isFinite(dailyCap)) {
    const recent = await sql`SELECT COUNT(*)::int AS n FROM community_items WHERE user_id = ${userId} AND created_at > NOW() - INTERVAL '24 hours'`
    if ((recent[0]?.n ?? 0) >= dailyCap) {
      const planBound = sub.plan === 'free' && planLimit <= scaleLimit
      return Response.json({
        error: planBound
          ? `You've reached the free limit of ${dailyCap} shares/day. Upgrade to Pro to share more.`
          : `Share limit reached (${dailyCap}/day) — try again tomorrow.`,
        upgrade: planBound,
      }, { status: 429 })
    }
  }

  const user = clerkId ? await currentUser() : null
  // Admin-only: publish under the official 100Lights byline (seed content)
  const official = body.asOfficial === true && await isAdminEmail()
  // Reserve the official byline: a non-admin whose Clerk display name is "100Lights"
  // would otherwise be treated as official everywhere it keys on author_name (the
  // sitemap + the always-index rule), impersonating the brand. Reject it here so
  // author_name='100Lights' stays a reliable official signal.
  const RESERVED_NAMES = new Set(['100lights', '100 lights'])
  let authorName = official ? '100Lights' : (user?.fullName ?? user?.username ?? (clerkId ? 'Anonymous' : userId))
  if (!official && RESERVED_NAMES.has(authorName.trim().toLowerCase())) authorName = 'Anonymous'
  const authorUsername = communityHandle(userId, official)

  // Remix lineage (best-effort): keep the source id only if it's a real,
  // non-removed item — never fail the share over it.
  let remixedFrom: string | null = null
  if (typeof body.remixedFrom === 'string' && isUuid(body.remixedFrom)) {
    try {
      const src = await sql`SELECT 1 FROM community_items WHERE id = ${body.remixedFrom} AND removed_at IS NULL LIMIT 1`
      if (src.length) remixedFrom = body.remixedFrom
    } catch { /* ignore — lineage is optional */ }
  }

  const rows = await sql`
    INSERT INTO community_items (user_id, author_name, author_username, kind, name, description, payload, r2_key, remixed_from)
    VALUES (${userId}, ${authorName}, ${authorUsername}, ${kind}, ${name.trim().slice(0, 120)}, ${(body.description ?? '').slice(0, kind === 'post' ? 4000 : 500)}, ${payloadJson}::jsonb, ${body.r2Key ?? null}, ${remixedFrom})
    RETURNING id
  `
  return Response.json({ id: rows[0].id })
}
