// Content-performance corpus for the social test. One row per posted Short (per platform), tagged by
// format/hook so we can rank what retains and later feed the program's content engine. DISPOSABLE by
// design — `purgeAll()` wipes it once the learning is extracted (Brae: "we can get rid of it after").
//
// Metrics come from each platform's analytics (entered/imported, not scraped). Lazy self-creating table
// (mirrors lib/ai-cache.ts / lib/stt-corrections.ts); every read fails soft.
import { sql } from '@/lib/db'

let ready = false
async function ensure(): Promise<void> {
  if (ready) return
  await sql`
    CREATE TABLE IF NOT EXISTS content_perf (
      id                TEXT PRIMARY KEY,          -- platform video id, or any stable key
      platform          TEXT NOT NULL DEFAULT 'youtube',
      format_tag        TEXT,                      -- lib/content-formats CONTENT_FORMATS.id
      hook_type         TEXT,                      -- lib/content-formats HOOK_TYPES
      title             TEXT,
      length_s          REAL,
      posted_at         TIMESTAMPTZ,
      views             BIGINT DEFAULT 0,
      avg_pct_viewed    REAL,                      -- completion % (the king metric)
      first3s_retention REAL,                      -- % still watching at 3s
      avg_view_s        REAL,                      -- average view duration (seconds)
      likes             INTEGER DEFAULT 0,
      comments          INTEGER DEFAULT 0,
      shares            INTEGER DEFAULT 0,
      subs_gained       INTEGER DEFAULT 0,
      notes             TEXT,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`
  ready = true
}

export interface ContentPost {
  id: string; platform?: string; formatTag?: string; hookType?: string; title?: string
  lengthS?: number; postedAt?: string; views?: number; avgPctViewed?: number; first3sRetention?: number
  avgViewS?: number; likes?: number; comments?: number; shares?: number; subsGained?: number; notes?: string
}

/** Upsert a post + its metrics (safe to call repeatedly as analytics update). */
export async function recordPost(p: ContentPost): Promise<void> {
  await ensure()
  await sql`
    INSERT INTO content_perf (id, platform, format_tag, hook_type, title, length_s, posted_at, views,
      avg_pct_viewed, first3s_retention, avg_view_s, likes, comments, shares, subs_gained, notes, updated_at)
    VALUES (${p.id}, ${p.platform ?? 'youtube'}, ${p.formatTag ?? null}, ${p.hookType ?? null}, ${p.title ?? null},
      ${p.lengthS ?? null}, ${p.postedAt ?? null}, ${p.views ?? 0}, ${p.avgPctViewed ?? null}, ${p.first3sRetention ?? null},
      ${p.avgViewS ?? null}, ${p.likes ?? 0}, ${p.comments ?? 0}, ${p.shares ?? 0}, ${p.subsGained ?? 0}, ${p.notes ?? null}, NOW())
    ON CONFLICT (id) DO UPDATE SET
      platform = EXCLUDED.platform, format_tag = COALESCE(EXCLUDED.format_tag, content_perf.format_tag),
      hook_type = COALESCE(EXCLUDED.hook_type, content_perf.hook_type), title = COALESCE(EXCLUDED.title, content_perf.title),
      length_s = COALESCE(EXCLUDED.length_s, content_perf.length_s), posted_at = COALESCE(EXCLUDED.posted_at, content_perf.posted_at),
      views = EXCLUDED.views, avg_pct_viewed = EXCLUDED.avg_pct_viewed, first3s_retention = EXCLUDED.first3s_retention,
      avg_view_s = EXCLUDED.avg_view_s, likes = EXCLUDED.likes, comments = EXCLUDED.comments, shares = EXCLUDED.shares,
      subs_gained = EXCLUDED.subs_gained, notes = COALESCE(EXCLUDED.notes, content_perf.notes), updated_at = NOW()`
}

export async function listPosts(limit = 1000): Promise<Record<string, unknown>[]> {
  try { await ensure(); return await sql`SELECT * FROM content_perf ORDER BY posted_at DESC NULLS LAST, created_at DESC LIMIT ${limit}` }
  catch { return [] }
}

/** Which FORMAT is winning: per-format averages + the growth-efficiency ratios that decide what to scale. */
export async function rankFormats(): Promise<Record<string, unknown>[]> {
  try {
    await ensure()
    return await sql`
      SELECT format_tag,
             COUNT(*)::int posts,
             ROUND(AVG(avg_pct_viewed)::numeric, 1) avg_completion_pct,
             ROUND(AVG(first3s_retention)::numeric, 1) avg_hook_pct,
             SUM(views)::bigint views,
             SUM(subs_gained)::int subs,
             ROUND((SUM(subs_gained)::numeric / NULLIF(SUM(views), 0)) * 1000, 2) subs_per_1k,
             ROUND((SUM(likes)::numeric / NULLIF(SUM(views), 0)) * 1000, 1) likes_per_1k
      FROM content_perf
      WHERE format_tag IS NOT NULL
      GROUP BY format_tag
      ORDER BY subs_per_1k DESC NULLS LAST, avg_completion_pct DESC NULLS LAST`
  } catch { return [] }
}

/** Wipe the corpus — it's disposable research data. Returns rows removed. */
export async function purgeAll(): Promise<number> {
  try { await ensure(); const r = await sql`DELETE FROM content_perf`; return (r as unknown as { length?: number }).length ?? 0 }
  catch { return 0 }
}
