import { auth, currentUser } from '@clerk/nextjs/server'
import { sql } from '@/lib/db'
import { ensureTables, devTestUser, isUuid } from '@/lib/community-server'

export const runtime = 'nodejs'

// Collections = user-curated, named, shareable sets of community items.
// Reading a specific collection is public (see the [id] route + the page);
// listing "mine" and all writes require a session.

// GET /api/community/collections?mine=1   → the caller's collections
// GET /api/community/collections?author=X → a creator's non-empty collections
export async function GET(req: Request) {
  await ensureTables()
  const { userId: clerkId } = await auth()
  const userId = clerkId ?? devTestUser(req)
  const url = new URL(req.url)
  const mine = url.searchParams.get('mine') === '1'
  const author = url.searchParams.get('author')
  try {
    if (mine) {
      if (!userId) return Response.json({ collections: [] })
      // `item` (optional) → each collection also reports whether it already
      // contains that item, so the save-picker can pre-check the right boxes.
      // Validate as a UUID first: an invalid value would make Postgres throw and
      // the surrounding catch would blank the user's whole collection list.
      const itemParam = url.searchParams.get('item')
      const item = itemParam && isUuid(itemParam) ? itemParam : null
      const rows = await sql`
        SELECT c.id, c.name, c.description, c.author_name, c.created_at,
               COUNT(ci.item_id)::int AS count,
               EXISTS(SELECT 1 FROM community_collection_items x WHERE x.collection_id = c.id AND x.item_id = ${item}) AS contains
        FROM community_collections c
        LEFT JOIN community_collection_items ci ON ci.collection_id = c.id
        WHERE c.user_id = ${userId} AND c.removed_at IS NULL
        GROUP BY c.id ORDER BY c.created_at DESC
      `
      return Response.json({ collections: rows })
    }
    if (author) {
      const rows = await sql`
        SELECT c.id, c.name, c.description, c.author_name, c.created_at,
               COUNT(ci.item_id)::int AS count
        FROM community_collections c
        JOIN community_collection_items ci ON ci.collection_id = c.id
        WHERE c.author_name = ${author} AND c.removed_at IS NULL
        GROUP BY c.id ORDER BY c.created_at DESC
      `
      return Response.json({ collections: rows })
    }
    return Response.json({ collections: [] })
  } catch {
    return Response.json({ collections: [] })
  }
}

// POST /api/community/collections { name, description? } → { id }
export async function POST(req: Request) {
  await ensureTables()
  const { userId: clerkId } = await auth()
  const userId = clerkId ?? devTestUser(req)
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  let body: { name?: string; description?: string }
  try { body = await req.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const name = body.name?.trim()
  if (!name) return Response.json({ error: 'A name is required' }, { status: 400 })

  const cnt = await sql`SELECT COUNT(*)::int AS n FROM community_collections WHERE user_id = ${userId} AND removed_at IS NULL`
  if ((cnt[0]?.n ?? 0) >= 100) return Response.json({ error: 'Collection limit reached (100).' }, { status: 429 })

  const user = clerkId ? await currentUser() : null
  const authorName = user?.fullName ?? user?.username ?? (clerkId ? 'Anonymous' : userId)
  const rows = await sql`
    INSERT INTO community_collections (user_id, author_name, name, description)
    VALUES (${userId}, ${authorName}, ${name.slice(0, 80)}, ${(body.description ?? '').slice(0, 300)})
    RETURNING id, name, description, author_name, created_at
  `
  return Response.json({ collection: { ...rows[0], count: 0 } })
}
