import { randomUUID } from 'crypto'
import { sql } from '@/lib/db'
import type { Musical } from './caption'

// The content queue — the marketing pipeline's review/approve/publish state,
// moved into the app backend (Postgres). Every row is one rendered song-video
// waiting to go out. Admin-only: nothing here is ever exposed to a normal user.

export type PostStatus = 'draft' | 'approved' | 'published' | 'failed'
export const PLATFORMS = ['youtube', 'instagram', 'tiktok'] as const
export type Platform = (typeof PLATFORMS)[number]

export interface ContentPost {
  id: string
  createdAt: string
  projectId: string | null
  slug: string
  format: string
  title: string
  caption: string
  platforms: Platform[]
  videoKey: string
  videoType: string
  musical: Musical | null
  status: PostStatus
  results: Record<string, { id?: string; url?: string; error?: string }>
  error: string | null
  publishedAt: string | null
}

let ready = false
async function ensure(): Promise<void> {
  if (ready) return
  await sql`
    CREATE TABLE IF NOT EXISTS content_posts (
      id           TEXT        PRIMARY KEY,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      project_id   TEXT,
      slug         TEXT        NOT NULL DEFAULT 'song-video',
      format       TEXT        NOT NULL DEFAULT 'falling-notes',
      title        TEXT        NOT NULL DEFAULT '',
      caption      TEXT        NOT NULL DEFAULT '',
      platforms    JSONB       NOT NULL DEFAULT '["youtube"]',
      video_key    TEXT        NOT NULL,
      video_type   TEXT        NOT NULL DEFAULT 'video/webm',
      musical      JSONB,
      status       TEXT        NOT NULL DEFAULT 'draft',
      results      JSONB       NOT NULL DEFAULT '{}',
      error        TEXT,
      published_at TIMESTAMPTZ
    )
  `
  ready = true
}

function map(r: Record<string, unknown>): ContentPost {
  const j = (v: unknown, d: unknown) => (v == null ? d : typeof v === 'string' ? JSON.parse(v) : v)
  return {
    id: String(r.id),
    createdAt: String(r.created_at),
    projectId: (r.project_id as string) ?? null,
    slug: (r.slug as string) || 'song-video',
    format: (r.format as string) || 'falling-notes',
    title: (r.title as string) || '',
    caption: (r.caption as string) || '',
    platforms: j(r.platforms, ['youtube']) as Platform[],
    videoKey: r.video_key as string,
    videoType: (r.video_type as string) || 'video/webm',
    musical: j(r.musical, null) as Musical | null,
    status: (r.status as PostStatus) || 'draft',
    results: j(r.results, {}) as ContentPost['results'],
    error: (r.error as string) ?? null,
    publishedAt: (r.published_at as string) ?? null,
  }
}

export async function createDraft(input: {
  projectId?: string | null; slug: string; format: string
  title: string; caption: string; platforms: Platform[]
  videoKey: string; videoType: string; musical: Musical | null
}): Promise<ContentPost> {
  await ensure()
  const id = randomUUID()
  const rows = await sql`
    INSERT INTO content_posts (id, project_id, slug, format, title, caption, platforms, video_key, video_type, musical, status)
    VALUES (${id}, ${input.projectId ?? null}, ${input.slug}, ${input.format}, ${input.title}, ${input.caption},
            ${JSON.stringify(input.platforms)}::jsonb, ${input.videoKey}, ${input.videoType},
            ${input.musical ? JSON.stringify(input.musical) : null}::jsonb, 'draft')
    RETURNING *
  `
  return map(rows[0])
}

export async function listPosts(): Promise<ContentPost[]> {
  await ensure()
  const rows = await sql`SELECT * FROM content_posts ORDER BY created_at DESC LIMIT 200`
  return rows.map(map)
}

export async function getPost(id: string): Promise<ContentPost | null> {
  await ensure()
  const rows = await sql`SELECT * FROM content_posts WHERE id = ${id}`
  return rows[0] ? map(rows[0]) : null
}

export async function updatePost(
  id: string,
  patch: { title?: string; caption?: string; platforms?: Platform[] },
): Promise<ContentPost | null> {
  await ensure()
  const rows = await sql`
    UPDATE content_posts SET
      title     = COALESCE(${patch.title ?? null}, title),
      caption   = COALESCE(${patch.caption ?? null}, caption),
      platforms = COALESCE(${patch.platforms ? JSON.stringify(patch.platforms) : null}::jsonb, platforms)
    WHERE id = ${id}
    RETURNING *
  `
  return rows[0] ? map(rows[0]) : null
}

export async function setStatus(
  id: string,
  status: PostStatus,
  extra: { results?: ContentPost['results']; error?: string | null; publishedAt?: string | null } = {},
): Promise<ContentPost | null> {
  await ensure()
  const rows = await sql`
    UPDATE content_posts SET
      status       = ${status},
      results      = COALESCE(${extra.results ? JSON.stringify(extra.results) : null}::jsonb, results),
      error        = ${extra.error ?? null},
      published_at = COALESCE(${extra.publishedAt ?? null}, published_at)
    WHERE id = ${id}
    RETURNING *
  `
  return rows[0] ? map(rows[0]) : null
}

export async function deletePost(id: string): Promise<string | null> {
  await ensure()
  const rows = await sql`DELETE FROM content_posts WHERE id = ${id} RETURNING video_key`
  return rows[0] ? (rows[0].video_key as string) : null
}
