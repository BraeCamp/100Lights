import { isAdmin } from '@/lib/admin-auth'
import { sql } from '@/lib/db'
import { getArticles } from '@/lib/learn-articles'

export const runtime = 'nodejs'

// Admin article store. Articles here MERGE with the repo drafts in
// content/learn/ (DB wins on slug clashes), and publish instantly — no
// deploy needed. See lib/learn-articles.ts for the merge.

let schemaReady = false
async function ensureSchema() {
  if (schemaReady) return
  await sql`
    CREATE TABLE IF NOT EXISTS learn_articles (
      slug        TEXT PRIMARY KEY,
      title       TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      date        TEXT NOT NULL,
      updated     TEXT,
      tags        TEXT NOT NULL DEFAULT '',
      draft       BOOLEAN NOT NULL DEFAULT true,
      body        TEXT NOT NULL DEFAULT ''
    )
  `
  schemaReady = true
}

export async function GET() {
  if (!await isAdmin()) return new Response('Unauthorized', { status: 401 })
  await ensureSchema()
  // Merged view (repo drafts + DB rows, DB wins) — the same list /learn sees,
  // drafts included, with tags flattened for the editor
  const articles = (await getArticles({ includeDrafts: true })).map(a => ({
    slug: a.slug, title: a.title, description: a.description, date: a.date,
    tags: a.tags.join(', '), draft: a.draft, body: a.body, source: a.source,
  }))
  return Response.json({ articles })
}

export async function PUT(req: Request) {
  if (!await isAdmin()) return new Response('Unauthorized', { status: 401 })
  await ensureSchema()
  let a: { slug?: string; title?: string; description?: string; date?: string; tags?: string; draft?: boolean; body?: string }
  try { a = await req.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const slug = (a.slug ?? '').trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
  if (!slug || !a.title?.trim()) return Response.json({ error: 'Slug and title required' }, { status: 400 })
  const updated = new Date().toISOString().slice(0, 10)
  await sql`
    INSERT INTO learn_articles (slug, title, description, date, updated, tags, draft, body)
    VALUES (${slug}, ${a.title.trim()}, ${a.description ?? ''}, ${a.date ?? updated}, ${updated}, ${a.tags ?? ''}, ${a.draft ?? true}, ${a.body ?? ''})
    ON CONFLICT (slug) DO UPDATE SET
      title = EXCLUDED.title, description = EXCLUDED.description, date = EXCLUDED.date,
      updated = EXCLUDED.updated, tags = EXCLUDED.tags, draft = EXCLUDED.draft, body = EXCLUDED.body
  `
  return Response.json({ ok: true, slug })
}

export async function DELETE(req: Request) {
  if (!await isAdmin()) return new Response('Unauthorized', { status: 401 })
  await ensureSchema()
  const slug = new URL(req.url).searchParams.get('slug')
  if (!slug) return Response.json({ error: 'slug required' }, { status: 400 })
  await sql`DELETE FROM learn_articles WHERE slug = ${slug}`
  return Response.json({ ok: true })
}
