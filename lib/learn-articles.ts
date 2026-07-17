// Learn-section content pipeline. Articles are markdown files in
// content/learn/ with a small frontmatter block — drafted by Claude in
// working sessions, reviewed by Brae, published by flipping `draft: false`.
// No CMS, no deps: the repo is the editorial workflow and deploys publish.

import fs from 'fs'
import path from 'path'

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
    meta[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  return { meta, body: raw.slice(end + 4).trim() }
}

export function getArticles(opts?: { includeDrafts?: boolean }): LearnArticle[] {
  const includeDrafts = opts?.includeDrafts ?? process.env.NODE_ENV === 'development'
  let files: string[] = []
  try { files = fs.readdirSync(DIR).filter(f => f.endsWith('.md') && f !== 'IDEAS.md' && !f.startsWith('_')) } catch { return [] }
  const out: LearnArticle[] = []
  for (const f of files) {
    const raw = fs.readFileSync(path.join(DIR, f), 'utf8')
    const { meta, body } = parseFrontmatter(raw)
    const draft = meta.draft !== 'false'   // draft unless explicitly published
    if (draft && !includeDrafts) continue
    out.push({
      slug: f.replace(/\.md$/, ''),
      title: meta.title ?? f,
      description: meta.description ?? '',
      date: meta.date ?? '2026-01-01',
      updated: meta.updated,
      tags: (meta.tags ?? '').split(',').map(t => t.trim()).filter(Boolean),
      draft,
      minutes: Math.max(2, Math.round(body.split(/\s+/).length / 220)),
      body,
    })
  }
  return out.sort((a, b) => b.date.localeCompare(a.date))
}

export function getArticle(slug: string, opts?: { includeDrafts?: boolean }): LearnArticle | null {
  return getArticles(opts).find(a => a.slug === slug) ?? null
}
