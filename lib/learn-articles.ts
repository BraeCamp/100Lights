// Learn-section content pipeline, two sources merged:
//  - content/learn/*.md — drafts written by Claude in working sessions,
//    published via git (deploys publish)
//  - the learn_articles DB table — created/edited in Admin → Articles,
//    published instantly (DB wins when a slug exists in both)
// Frontmatter: title / description / date / tags / draft (true unless
// explicitly false).

import fs from 'fs'
import path from 'path'
import { cache } from 'react'
import { sql } from './db'
import { parseTags } from './tags'

export interface LearnArticle {
  slug: string
  title: string
  description: string
  date: string          // ISO yyyy-mm-dd
  updated?: string
  tags: string[]
  /** Editorial voice/column this piece is written in (byline persona). */
  voice?: string
  /** EFFECTIVE draft state: false once a scheduled time has passed. */
  draft: boolean
  /** Set only while an article is still waiting for its slot (ISO datetime). */
  scheduledFor?: string
  minutes: number       // rough read time, computed
  body: string          // markdown after frontmatter
  source: 'repo' | 'db'
}

/**
 * Resolve a stored draft flag + optional publish time into the effective one.
 *
 * `draft` is what every consumer already reads, so scheduling collapses into
 * it rather than adding a second concept they'd all have to learn: an article
 * whose slot has passed simply isn't a draft any more. Pages revalidate every
 * 60s, so a slot goes live within about a minute of its time with no deploy.
 */
function resolvePublication(draft: boolean, publishAt: string | null | undefined, now: number) {
  if (!draft || !publishAt) return { draft, scheduledFor: undefined }
  const t = Date.parse(publishAt)
  if (Number.isNaN(t)) return { draft, scheduledFor: undefined }
  return t <= now
    ? { draft: false, scheduledFor: undefined }
    : { draft: true, scheduledFor: new Date(t).toISOString() }
}

const DIR = path.join(process.cwd(), 'content', 'learn')

function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  if (!raw.startsWith('---')) return { meta: {}, body: raw }
  const end = raw.indexOf('\n---', 3)
  if (end === -1) return { meta: {}, body: raw }
  const meta: Record<string, string> = {}
  for (const line of raw.slice(3, end).split('\n')) {
    const i = line.indexOf(':')
    if (i === -1) continue
    // Strip matching surrounding quotes — YAML treats them as delimiters, and
    // without this a quoted title carried its quotes into the <h1>, <title>,
    // and OG tags.
    const value = line.slice(i + 1).trim().replace(/^(['"])([\s\S]*)\1$/, '$2')
    meta[line.slice(0, i).trim()] = value
  }
  return { meta, body: raw.slice(end + 4).trim() }
}

function minutes(body: string): number {
  return Math.max(2, Math.round(body.split(/\s+/).length / 220))
}

function fromRepo(now: number): LearnArticle[] {
  let files: string[] = []
  try { files = fs.readdirSync(DIR).filter(f => f.endsWith('.md') && f !== 'IDEAS.md' && !f.startsWith('_')) } catch { return [] }
  return files.map(f => {
    const raw = fs.readFileSync(path.join(DIR, f), 'utf8')
    const { meta, body } = parseFrontmatter(raw)
    return {
      slug: f.replace(/\.md$/, ''),
      title: meta.title ?? f,
      description: meta.description ?? '',
      date: meta.date ?? '2026-01-01',
      updated: meta.updated,
      tags: parseTags(meta.tags ?? ''),
      voice: meta.voice || undefined,
      ...resolvePublication(meta.draft !== 'false', meta.publishAt, now),
      minutes: minutes(body),
      body,
      source: 'repo' as const,
    }
  })
}

/**
 * Live DB articles, plus the slugs of trashed ones.
 *
 * Deleted rows are returned separately rather than dropped, because a row
 * shadowing a repo file has to keep suppressing that file while it sits in
 * the trash. Filter them out of the query and the .md would spring back to
 * life the moment it was deleted.
 */
async function fromDb(now: number): Promise<{ live: LearnArticle[]; deleted: Set<string> }> {
  try {
    const rows = await sql`SELECT * FROM learn_articles`
    const deleted = new Set<string>()
    const live: LearnArticle[] = []
    for (const r of rows) {
      if (r.deleted_at != null) { deleted.add(r.slug as string); continue }
      live.push(toArticle(r, now))
    }
    return { live, deleted }
  } catch { return { live: [], deleted: new Set() } }
}

function toArticle(r: Record<string, unknown>, now: number): LearnArticle {
  return {
      slug: r.slug as string,
      title: r.title as string,
      description: (r.description as string) ?? '',
      date: r.date as string,
      updated: (r.updated as string) ?? undefined,
      tags: parseTags((r.tags as string) ?? ''),
      ...resolvePublication(!!r.draft, r.publish_at as string | null, now),
    minutes: minutes((r.body as string) ?? ''),
    body: (r.body as string) ?? '',
    source: 'db' as const,
  }
}

// Per-request memoised: generateMetadata + the page + recommendations each call
// getArticles/getArticle in one render — React cache() dedupes the three
// full-table reads down to one. Keyed by includeDrafts (a boolean) so the two
// variants stay distinct.
const getArticlesCached = cache(async (includeDrafts: boolean): Promise<LearnArticle[]> => {
  const now = Date.now()
  const { live, deleted } = await fromDb(now)
  // A slug is hidden if the DB has it live (that row wins) or trashed (the
  // tombstone suppresses the file).
  const claimed = new Set([...live.map(a => a.slug), ...deleted])
  const all = [...live, ...fromRepo(now).filter(a => !claimed.has(a.slug))]
  return all
    .filter(a => includeDrafts || !a.draft)
    .sort((a, b) => b.date.localeCompare(a.date))
})

export async function getArticles(opts?: { includeDrafts?: boolean }): Promise<LearnArticle[]> {
  return getArticlesCached(opts?.includeDrafts ?? process.env.NODE_ENV === 'development')
}

/** Trashed articles, newest first — for the admin trash view. */
export async function getTrashedArticles(): Promise<Array<LearnArticle & { deletedAt: string; repoShadow: boolean }>> {
  try {
    const rows = await sql`
      SELECT * FROM learn_articles
      WHERE deleted_at IS NOT NULL
      ORDER BY deleted_at DESC
    `
    const now = Date.now()
    return rows.map(r => ({
      ...toArticle(r, now),
      deletedAt: new Date(r.deleted_at as string).toISOString(),
      repoShadow: !!r.repo_shadow,
    }))
  } catch { return [] }
}

export async function getArticle(slug: string, opts?: { includeDrafts?: boolean }): Promise<LearnArticle | null> {
  return (await getArticles(opts)).find(a => a.slug === slug) ?? null
}

/**
 * A single article straight from its committed .md, ignoring the DB merge.
 *
 * Scheduling/publishing a repo article snapshots its body into a DB row, and
 * the DB then wins on slug — so later commits to the file stop showing. This
 * reads the file directly, so the admin "sync from repo" action can copy the
 * fresh content back over the frozen row.
 */
export function getRepoArticle(slug: string): LearnArticle | null {
  return fromRepo(Date.now()).find(a => a.slug === slug) ?? null
}

/** Slugs that have a committed .md file — lets the admin list flag which DB
 *  rows are shadowing a repo article (and so can be resynced from it). */
export function getRepoSlugs(): Set<string> {
  return new Set(fromRepo(Date.now()).map(a => a.slug))
}

export { parseTags, MAX_TAGS } from './tags'
