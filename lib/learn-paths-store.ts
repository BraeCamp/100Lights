import { sql } from '@/lib/db'
import { LEARN_PATHS, type LearnPath, type PathLevel } from './learn-paths'

// Admin-editable layer over the code registry (lib/learn-paths.ts), mirroring
// how Learn articles merge repo files with DB rows: the built-in paths are the
// defaults, and a `learn_paths` row overrides a built-in by slug (or adds a new
// custom path). DB wins. Deleting a row reverts a built-in to its code default
// or removes a custom path. Everything is fault-tolerant — if the DB is
// unavailable, pages fall back to the built-ins so Learn never breaks.

const LEVELS: PathLevel[] = ['beginner', 'intermediate', 'advanced']

export interface AdminPath extends LearnPath {
  active: boolean
  sortOrder: number | null
  /** Where this path's current definition comes from. */
  source: 'builtin' | 'edited' | 'custom'
}

let ready = false
async function ensure(): Promise<void> {
  if (ready) return
  await sql`
    CREATE TABLE IF NOT EXISTS learn_paths (
      slug          TEXT        PRIMARY KEY,
      title         TEXT        NOT NULL,
      goal          TEXT        NOT NULL DEFAULT '',
      description   TEXT        NOT NULL DEFAULT '',
      emoji         TEXT        NOT NULL DEFAULT '📚',
      level         TEXT        NOT NULL DEFAULT 'beginner',
      article_slugs JSONB       NOT NULL DEFAULT '[]',
      sort_order    INTEGER,
      active        BOOLEAN     NOT NULL DEFAULT TRUE,
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  ready = true
}

function asStrings(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(x => String(x).trim()).filter(Boolean)
  if (typeof v === 'string') { try { return asStrings(JSON.parse(v)) } catch { return [] } }
  return []
}

/** Merge built-ins with DB rows into the full admin view (incl. inactive). */
async function loadMerged(): Promise<AdminPath[]> {
  await ensure()
  const rows = await sql`SELECT * FROM learn_paths`
  const dbBySlug = new Map(rows.map(r => [r.slug as string, r]))
  const builtinIndex = new Map(LEARN_PATHS.map((p, i) => [p.slug, i]))
  const slugs = [...new Set([...LEARN_PATHS.map(p => p.slug), ...rows.map(r => r.slug as string)])]

  const out: AdminPath[] = slugs.map(slug => {
    const b = LEARN_PATHS.find(p => p.slug === slug) ?? null
    const r = dbBySlug.get(slug) ?? null
    if (r) {
      return {
        slug,
        title: r.title as string,
        goal: (r.goal as string) ?? '',
        description: (r.description as string) ?? '',
        emoji: (r.emoji as string) || '📚',
        level: (LEVELS.includes(r.level as PathLevel) ? r.level : 'beginner') as PathLevel,
        articleSlugs: asStrings(r.article_slugs),
        active: r.active !== false,
        sortOrder: r.sort_order != null ? Number(r.sort_order) : (b ? builtinIndex.get(slug)! : null),
        source: b ? 'edited' : 'custom',
      }
    }
    return { ...b!, active: true, sortOrder: builtinIndex.get(slug)!, source: 'builtin' }
  })

  out.sort((a, b) => (a.sortOrder ?? 9999) - (b.sortOrder ?? 9999))
  return out
}

function strip(p: AdminPath): LearnPath {
  return { slug: p.slug, title: p.title, goal: p.goal, description: p.description, emoji: p.emoji, level: p.level, articleSlugs: p.articleSlugs }
}

/** Public: active, ordered paths for the Learn pages. Falls back to built-ins. */
export async function getLearnPaths(): Promise<LearnPath[]> {
  try { return (await loadMerged()).filter(p => p.active).map(strip) }
  catch { return LEARN_PATHS }
}

export async function getLearnPath(slug: string): Promise<LearnPath | null> {
  return (await getLearnPaths()).find(p => p.slug === slug) ?? null
}

/** Paths (active) containing an article, with the article's position. */
export async function getPathsForArticle(articleSlug: string): Promise<Array<{ path: LearnPath; index: number }>> {
  const paths = await getLearnPaths()
  const out: Array<{ path: LearnPath; index: number }> = []
  for (const path of paths) {
    const index = path.articleSlugs.indexOf(articleSlug)
    if (index !== -1) out.push({ path, index })
  }
  return out
}

// ── Admin ────────────────────────────────────────────────────────────────────

export async function listLearnPathsAdmin(): Promise<AdminPath[]> {
  try { return await loadMerged() } catch { return LEARN_PATHS.map((p, i) => ({ ...p, active: true, sortOrder: i, source: 'builtin' as const })) }
}

export type UpsertPathResult = { ok: true; slug: string } | { ok: false; error: string }

export async function upsertLearnPath(input: {
  slug?: string; title?: string; goal?: string; description?: string
  emoji?: string; level?: string; articleSlugs?: string[]; active?: boolean; sortOrder?: number | null
}): Promise<UpsertPathResult> {
  await ensure()
  const slug = (input.slug || '').trim().toLowerCase().replace(/\s+/g, '-')
  const title = (input.title || '').trim()
  if (!/^[a-z0-9-]{3,60}$/.test(slug)) return { ok: false, error: 'Slug must be 3–60 chars: lowercase letters, numbers, hyphens.' }
  if (!title) return { ok: false, error: 'A title is required.' }
  const level = LEVELS.includes(input.level as PathLevel) ? input.level! : 'beginner'
  const slugs = asStrings(input.articleSlugs)
  const active = input.active !== false
  const sortOrder = input.sortOrder == null ? null : Math.round(input.sortOrder)

  await sql`
    INSERT INTO learn_paths (slug, title, goal, description, emoji, level, article_slugs, active, sort_order, updated_at)
    VALUES (${slug}, ${title}, ${input.goal ?? ''}, ${input.description ?? ''}, ${input.emoji || '📚'},
            ${level}, ${JSON.stringify(slugs)}, ${active}, ${sortOrder}, NOW())
    ON CONFLICT (slug) DO UPDATE SET
      title = EXCLUDED.title, goal = EXCLUDED.goal, description = EXCLUDED.description,
      emoji = EXCLUDED.emoji, level = EXCLUDED.level, article_slugs = EXCLUDED.article_slugs,
      active = EXCLUDED.active, sort_order = EXCLUDED.sort_order, updated_at = NOW()
  `
  return { ok: true, slug }
}

/** Delete the DB row: reverts a built-in to its code default, or removes a custom path. */
export async function deleteLearnPath(slug: string): Promise<void> {
  await ensure()
  await sql`DELETE FROM learn_paths WHERE slug = ${slug}`
}
