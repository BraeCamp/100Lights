import { auth, currentUser } from '@clerk/nextjs/server'
import { sql } from '@/lib/db'

export const runtime = 'nodejs'

// Community exchange: users share samples (R2-backed), presets (render specs,
// no blobs), and recipes (note patterns) — browse, vote, import.

let tablesReady = false
async function ensureTables() {
  if (tablesReady) return
  await sql`
    CREATE TABLE IF NOT EXISTS community_items (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id TEXT NOT NULL,
      author_name TEXT NOT NULL DEFAULT 'Anonymous',
      kind TEXT NOT NULL CHECK (kind IN ('song', 'sample', 'preset', 'recipe')),
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      payload JSONB,
      r2_key TEXT,
      votes INT NOT NULL DEFAULT 0,
      downloads INT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  // Existing tables predate the 'song' kind — rebuild the check constraint
  await sql`ALTER TABLE community_items DROP CONSTRAINT IF EXISTS community_items_kind_check`
  await sql`ALTER TABLE community_items ADD CONSTRAINT community_items_kind_check CHECK (kind IN ('song', 'sample', 'preset', 'recipe'))`
  await sql`
    CREATE TABLE IF NOT EXISTS community_votes (
      item_id UUID NOT NULL,
      user_id TEXT NOT NULL,
      PRIMARY KEY (item_id, user_id)
    )
  `
  tablesReady = true
}

function devTestUser(req: Request): string | null {
  return process.env.DEV_OPEN === '1' && process.env.NODE_ENV !== 'production'
    ? req.headers.get('x-test-user') && `test-${req.headers.get('x-test-user')}`
    : null
}

// GET /api/community?kind=sample|preset|recipe&sort=top|new
export async function GET(req: Request) {
  const { userId: clerkId } = await auth()
  const userId = clerkId ?? devTestUser(req)
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  await ensureTables()

  const url = new URL(req.url)
  const kind = url.searchParams.get('kind')
  const sort = url.searchParams.get('sort') === 'new' ? 'new' : 'top'

  const rows = kind
    ? await sql`SELECT * FROM community_items WHERE kind = ${kind} ORDER BY ${sort === 'top' ? sql`votes DESC, created_at DESC` : sql`created_at DESC`} LIMIT 100`
    : await sql`SELECT * FROM community_items ORDER BY ${sort === 'top' ? sql`votes DESC, created_at DESC` : sql`created_at DESC`} LIMIT 100`

  const myVotes = await sql`SELECT item_id FROM community_votes WHERE user_id = ${userId}`
  const votedIds = new Set(myVotes.map(r => r.item_id as string))

  return Response.json({
    items: rows.map(r => ({
      id: r.id, kind: r.kind, name: r.name, description: r.description,
      authorName: r.author_name, votes: r.votes, downloads: r.downloads,
      createdAt: r.created_at, payload: r.payload, r2Key: r.r2_key,
      votedByMe: votedIds.has(r.id as string), mine: r.user_id === userId,
    })),
  })
}

// POST /api/community — share an item
export async function POST(req: Request) {
  const { userId: clerkId } = await auth()
  const userId = clerkId ?? devTestUser(req)
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  await ensureTables()

  let body: { kind?: string; name?: string; description?: string; payload?: unknown; r2Key?: string }
  try { body = await req.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { kind, name } = body
  if (!kind || !['song', 'sample', 'preset', 'recipe'].includes(kind) || !name?.trim()) {
    return Response.json({ error: 'kind (song|sample|preset|recipe) and name are required' }, { status: 400 })
  }
  const audioKind = kind === 'sample' || kind === 'song'
  if (audioKind && !body.r2Key) return Response.json({ error: `${kind} requires r2Key` }, { status: 400 })
  if (!audioKind && !body.payload) return Response.json({ error: `${kind} requires payload` }, { status: 400 })
  const payloadJson = body.payload ? JSON.stringify(body.payload) : null
  if (payloadJson && payloadJson.length > 500_000) return Response.json({ error: 'payload too large' }, { status: 413 })

  const user = clerkId ? await currentUser() : null
  const authorName = user?.fullName ?? user?.username ?? (clerkId ? 'Anonymous' : userId)

  const rows = await sql`
    INSERT INTO community_items (user_id, author_name, kind, name, description, payload, r2_key)
    VALUES (${userId}, ${authorName}, ${kind}, ${name.trim().slice(0, 120)}, ${(body.description ?? '').slice(0, 500)}, ${payloadJson}::jsonb, ${body.r2Key ?? null})
    RETURNING id
  `
  return Response.json({ id: rows[0].id })
}
