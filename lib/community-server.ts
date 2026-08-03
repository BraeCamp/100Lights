import { sql } from './db'

// Server-side shared helpers for the community API routes.

export const COMMUNITY_KINDS = ['song', 'sample', 'preset', 'recipe', 'pack', 'project', 'theme', 'kit', 'pattern', 'post', 'clip'] as const
export const REACTION_EMOJI = ['🔥', '❤️', '🎧']

let tablesReady = false
/** Route ids come straight from the URL — reject non-UUIDs before they hit
 *  Postgres, which throws (500) instead of returning no rows. */
export function isUuid(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
}

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
  // Soft removal for admin moderation — a takedown hides the item everywhere but
  // keeps its row (and votes/reactions/comments) so it can be restored. Public
  // reads filter on `removed_at IS NULL`.
  await sql`ALTER TABLE community_items ADD COLUMN IF NOT EXISTS removed_at     TIMESTAMPTZ`
  await sql`ALTER TABLE community_items ADD COLUMN IF NOT EXISTS removed_by     TEXT`
  await sql`ALTER TABLE community_items ADD COLUMN IF NOT EXISTS removed_reason TEXT`
  // Remix lineage: a project shared after opening another shared project as a
  // starter records the source id, so item pages can show "remixed from" +
  // the tree of remixes. Nullable; indexed for the derivatives lookup.
  await sql`ALTER TABLE community_items ADD COLUMN IF NOT EXISTS remixed_from UUID`
  await sql`CREATE INDEX IF NOT EXISTS community_items_remixed_from_idx ON community_items (remixed_from)`
  // Older tables carry a narrower kind constraint — rebuild it only when it
  // actually differs, and tolerate the race where two requests migrate at
  // once (page render + generateMetadata run ensureTables in parallel).
  try {
    const con = await sql`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'community_items_kind_check'`
    const def = (con[0]?.def as string | undefined) ?? ''
    if (!COMMUNITY_KINDS.every(k => def.includes(`'${k}'`))) {
      await sql`ALTER TABLE community_items DROP CONSTRAINT IF EXISTS community_items_kind_check`
      // Keep this list in sync with COMMUNITY_KINDS above.
      await sql`ALTER TABLE community_items ADD CONSTRAINT community_items_kind_check CHECK (kind IN ('song', 'sample', 'preset', 'recipe', 'pack', 'project', 'theme', 'kit', 'pattern', 'post', 'clip'))`
    }
  } catch { /* concurrent migration won the race — constraint is in place */ }
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
  await sql`
    CREATE TABLE IF NOT EXISTS community_reports (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      item_id UUID NOT NULL,
      user_id TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (item_id, user_id)
    )
  `
  await sql`
    CREATE TABLE IF NOT EXISTS community_comments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      item_id UUID NOT NULL,
      user_id TEXT NOT NULL,
      author_name TEXT NOT NULL DEFAULT 'Anonymous',
      body TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  await sql`CREATE INDEX IF NOT EXISTS community_comments_item_idx ON community_comments (item_id, created_at)`
  await sql`CREATE INDEX IF NOT EXISTS community_comments_user_idx ON community_comments (user_id, created_at)`
  await sql`
    CREATE TABLE IF NOT EXISTS community_comment_reports (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      comment_id UUID NOT NULL,
      item_id UUID NOT NULL,
      user_id TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (comment_id, user_id)
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

export function rowToItem(r: Record<string, unknown>, userId: string | null, votedIds: Set<string>, reactions: Map<string, Record<string, number>>, myReactions: Map<string, string[]>, comments?: Map<string, number>, proAuthors?: Set<string>) {
  return {
    id: r.id, kind: r.kind, name: r.name, description: r.description,
    authorName: r.author_name, votes: r.votes, downloads: r.downloads,
    createdAt: r.created_at, payload: r.payload, r2Key: r.r2_key,
    votedByMe: votedIds.has(r.id as string),
    mine: userId !== null && r.user_id === userId,
    authorPro: proAuthors?.has(r.user_id as string) ?? false,
    reactions: reactions.get(r.id as string) ?? {},
    myReactions: myReactions.get(r.id as string) ?? [],
    commentCount: comments?.get(r.id as string) ?? 0,
  }
}

/** Which of these user_ids are on an active Pro plan (for the author badge).
 *  One query; empty on any error so a missing table never breaks the feed. */
export async function proUserIds(userIds: string[]): Promise<Set<string>> {
  const set = new Set<string>()
  const ids = [...new Set(userIds.filter(Boolean))]
  if (ids.length === 0) return set
  try {
    const rows = await sql`
      SELECT user_id FROM subscriptions
      WHERE user_id = ANY(${ids}) AND plan = 'pro' AND status = 'active'
        AND (current_period_end IS NULL OR current_period_end > NOW())`
    for (const r of rows) set.add(r.user_id as string)
  } catch { /* subscriptions table absent in some envs */ }
  return set
}

/** Comment counts for a batch of items (one grouped query). Empty on any error
 *  (e.g. the comments table not existing yet). */
export async function commentCounts(itemIds: string[]): Promise<Map<string, number>> {
  const m = new Map<string, number>()
  if (itemIds.length === 0) return m
  try {
    const rows = await sql`SELECT item_id, COUNT(*)::int AS n FROM community_comments WHERE item_id = ANY(${itemIds}::uuid[]) GROUP BY item_id`
    for (const r of rows) m.set(r.item_id as string, r.n as number)
  } catch { /* table may not exist yet */ }
  return m
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

// First page of items for server-rendering /community — anonymous shaping (no
// votes/reactions), newest first. Gives crawlers real feed content and internal
// links to every item page instead of an empty client-loaded list.
export async function getInitialCommunityItems(limit = 30) {
  await ensureTables()
  try {
    const rows = await sql`SELECT * FROM community_items WHERE removed_at IS NULL ORDER BY created_at DESC LIMIT ${limit}`
    return rows.map(r => rowToItem(r, null, new Set<string>(), new Map(), new Map()))
  } catch { return [] }
}
