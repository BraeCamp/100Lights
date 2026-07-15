import { auth, currentUser } from '@clerk/nextjs/server'
import { sql } from '@/lib/db'
import { COMMUNITY_KINDS, ensureTables, devTestUser, rowToItem, reactionMaps, LARGE_MODE_LIMITS } from '@/lib/community-server'
import { getFlags } from '@/lib/platform-flags'
import { isAdminEmail } from '@/lib/admin-auth'

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
        OR EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(payload->'samples', '[]'::jsonb)) elem WHERE elem->>'name' ILIKE ${like ?? ''}))`

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
  if (userId) {
    const myVotes = await sql`SELECT item_id FROM community_votes WHERE user_id = ${userId}`
    for (const r of myVotes) votedIds.add(r.item_id as string)
  }
  const { reactions, mine } = await reactionMaps(pageRows.map(r => r.id as string), userId)

  // Community pulse for the feed header — makes a small feed feel alive
  const statRows = await sql`SELECT COUNT(*)::int AS items, COUNT(DISTINCT author_name)::int AS authors FROM community_items`

  const res = Response.json({
    items: pageRows.map(r => rowToItem(r, userId, votedIds, reactions, mine)),
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

  let body: { kind?: string; name?: string; description?: string; payload?: unknown; r2Key?: string; asOfficial?: boolean }
  try { body = await req.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { kind, name } = body
  if (!kind || !(COMMUNITY_KINDS as readonly string[]).includes(kind) || !name?.trim()) {
    return Response.json({ error: `kind (${COMMUNITY_KINDS.join('|')}) and name are required` }, { status: 400 })
  }
  const audioKind = kind === 'sample' || kind === 'song'
  if (audioKind && !body.r2Key) return Response.json({ error: `${kind} requires r2Key` }, { status: 400 })
  if (!audioKind && !body.payload) return Response.json({ error: `${kind} requires payload` }, { status: 400 })
  const payloadJson = body.payload ? JSON.stringify(body.payload) : null
  if (payloadJson && payloadJson.length > 900_000) return Response.json({ error: 'payload too large' }, { status: 413 })

  const { communityScale } = await getFlags()
  if (communityScale === 'large') {
    const recent = await sql`SELECT COUNT(*)::int AS n FROM community_items WHERE user_id = ${userId} AND created_at > NOW() - INTERVAL '24 hours'`
    if ((recent[0]?.n ?? 0) >= LARGE_MODE_LIMITS.sharesPerDay) {
      return Response.json({ error: `Share limit reached (${LARGE_MODE_LIMITS.sharesPerDay}/day) — try again tomorrow` }, { status: 429 })
    }
  }

  const user = clerkId ? await currentUser() : null
  // Admin-only: publish under the official 100Lights byline (seed content)
  const official = body.asOfficial === true && await isAdminEmail()
  const authorName = official ? '100Lights' : (user?.fullName ?? user?.username ?? (clerkId ? 'Anonymous' : userId))

  const rows = await sql`
    INSERT INTO community_items (user_id, author_name, kind, name, description, payload, r2_key)
    VALUES (${userId}, ${authorName}, ${kind}, ${name.trim().slice(0, 120)}, ${(body.description ?? '').slice(0, 500)}, ${payloadJson}::jsonb, ${body.r2Key ?? null})
    RETURNING id
  `
  return Response.json({ id: rows[0].id })
}
