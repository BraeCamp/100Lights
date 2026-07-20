// Learn-section content pipeline, two sources merged:
//  - content/learn/*.md — drafts written by Claude in working sessions,
//    published via git (deploys publish)
//  - the learn_articles DB table — created/edited in Admin → Articles,
//    published instantly (DB wins when a slug exists in both)
// Frontmatter: title / description / date / tags / draft (true unless
// explicitly false).

import fs from 'fs'
import path from 'path'
import { sql } from './db'

export interface LearnArticle {
  slug: string
  title: string
  description: string
  date: string          // ISO yyyy-mm-dd
  updated?: string
  tags: string[]
  draft: boolean
  minutes: number       // rough read time, computed
  body: string          // markdown after frontmatter
  source: 'repo' | 'db'
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

function fromRepo(): LearnArticle[] {
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
      tags: (meta.tags ?? '').split(',').map(t => t.trim()).filter(Boolean),
      draft: meta.draft !== 'false',
      minutes: minutes(body),
      body,
      source: 'repo' as const,
    }
  })
}

async function fromDb(): Promise<LearnArticle[]> {
  try {
    const rows = await sql`SELECT * FROM learn_articles`
    return rows.map(r => ({
      slug: r.slug as string,
      title: r.title as string,
      description: (r.description as string) ?? '',
      date: r.date as string,
      updated: (r.updated as string) ?? undefined,
      tags: ((r.tags as string) ?? '').split(',').map(t => t.trim()).filter(Boolean),
      draft: !!r.draft,
      minutes: minutes((r.body as string) ?? ''),
      body: (r.body as string) ?? '',
      source: 'db' as const,
    }))
  } catch { return [] }   // table absent / DB down / build time — repo still ships
}

export async function getArticles(opts?: { includeDrafts?: boolean }): Promise<LearnArticle[]> {
  const includeDrafts = opts?.includeDrafts ?? process.env.NODE_ENV === 'development'
  const db = await fromDb()
  const dbSlugs = new Set(db.map(a => a.slug))
  const all = [...db, ...fromRepo().filter(a => !dbSlugs.has(a.slug))]
  return all
    .filter(a => includeDrafts || !a.draft)
    .sort((a, b) => b.date.localeCompare(a.date))
}

export async function getArticle(slug: string, opts?: { includeDrafts?: boolean }): Promise<LearnArticle | null> {
  return (await getArticles(opts)).find(a => a.slug === slug) ?? null
}
