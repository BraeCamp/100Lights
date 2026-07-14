import { sql } from './db'

// Server-side shared helpers for the community API routes.

export const COMMUNITY_KINDS = ['song', 'sample', 'preset', 'recipe', 'pack', 'project'] as const
export const REACTION_EMOJI = ['🔥', '❤️', '🎧']

let tablesReady = false
export async function ensureTables() {
  if (tablesReady) return
  await sql`
    CREATE TABLE IF NOT EXISTS community_items (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id TEXT NOT NULL,
      author_name TEXT NOT NULL DEFAULT 'Anonymous',
      kind TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      payload JSONB,
      r2_key TEXT,
      votes INT NOT NULL DEFAULT 0,
      downloads INT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  // Older tables carry a narrower kind constraint — rebuild it
  await sql`ALTER TABLE community_items DROP CONSTRAINT IF EXISTS community_items_kind_check`
  await sql`ALTER TABLE community_items ADD CONSTRAINT community_items_kind_check CHECK (kind IN ('song', 'sample', 'preset', 'recipe', 'pack', 'project'))`
  await sql`
    CREATE TABLE IF NOT EXISTS community_votes (
      item_id UUID NOT NULL,
      user_id TEXT NOT NULL,
      PRIMARY KEY (item_id, user_id)
    )
  `
  await sql`
    CREATE TABLE IF NOT EXISTS community_reactions (
      item_id UUID NOT NULL,
      user_id TEXT NOT NULL,
      emoji TEXT NOT NULL,
      PRIMARY KEY (item_id, user_id, emoji)
    )
  `
  // Indexes for the feed's hot paths — cheap at any size, needed at scale
  await sql`CREATE INDEX IF NOT EXISTS community_items_kind_idx ON community_items (kind, created_at DESC)`
  await sql`CREATE INDEX IF NOT EXISTS community_items_created_idx ON community_items (created_at DESC)`
  await sql`CREATE INDEX IF NOT EXISTS community_items_author_idx ON community_items (author_name)`
  await sql`CREATE INDEX IF NOT EXISTS community_items_user_idx ON community_items (user_id)`
  tablesReady = true
}

// Per-user write limits applied in 'large' mode. Small communities stay
// unthrottled — a handful of enthusiastic users IS the community.
export const LARGE_MODE_LIMITS = {
  sharesPerDay: 20,
  actionsPerHour: 240,   // votes + reactions combined
}

export function devTestUser(req: Request): string | null {
  return process.env.DEV_OPEN === '1' && process.env.NODE_ENV !== 'production'
    ? req.headers.get('x-test-user') && `test-${req.headers.get('x-test-user')}`
    : null
}

export function rowToItem(r: Record<string, unknown>, userId: string | null, votedIds: Set<string>, reactions: Map<string, Record<string, number>>, myReactions: Map<string, string[]>) {
  return {
    id: r.id, kind: r.kind, name: r.name, description: r.description,
    authorName: r.author_name, votes: r.votes, downloads: r.downloads,
    createdAt: r.created_at, payload: r.payload, r2Key: r.r2_key,
    votedByMe: votedIds.has(r.id as string),
    mine: userId !== null && r.user_id === userId,
    reactions: reactions.get(r.id as string) ?? {},
    myReactions: myReactions.get(r.id as string) ?? [],
  }
}

export async function reactionMaps(itemIds: string[], userId: string | null): Promise<{ reactions: Map<string, Record<string, number>>; mine: Map<string, string[]> }> {
  const reactions = new Map<string, Record<string, number>>()
  const mine = new Map<string, string[]>()
  if (itemIds.length === 0) return { reactions, mine }
  const rows = await sql`SELECT item_id, emoji, COUNT(*)::int AS n FROM community_reactions WHERE item_id = ANY(${itemIds}::uuid[]) GROUP BY item_id, emoji`
  for (const r of rows) {
    const m = reactions.get(r.item_id as string) ?? {}
    m[r.emoji as string] = r.n as number
    reactions.set(r.item_id as string, m)
  }
  if (userId) {
    const my = await sql`SELECT item_id, emoji FROM community_reactions WHERE item_id = ANY(${itemIds}::uuid[]) AND user_id = ${userId}`
    for (const r of my) {
      const a = mine.get(r.item_id as string) ?? []
      a.push(r.emoji as string)
      mine.set(r.item_id as string, a)
    }
  }
  return { reactions, mine }
}
