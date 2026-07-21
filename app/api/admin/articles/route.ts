import { isAdmin } from '@/lib/admin-auth'
import { sql } from '@/lib/db'
import { getArticles, getRepoSlugs } from '@/lib/learn-articles'
import { ensureLearnSchema } from '@/lib/learn-schema'

export const runtime = 'nodejs'

// Admin article store. Articles here MERGE with the repo drafts in
// content/learn/ (DB wins on slug clashes), and publish instantly — no
// deploy needed. See lib/learn-articles.ts for the merge.

export async function GET() {
  if (!await isAdmin()) return new Response('Unauthorized', { status: 401 })
  await ensureLearnSchema()
  // Merged view (repo drafts + DB rows, DB wins) — the same list /learn sees,
  // drafts included, with tags flattened for the editor. `hasRepo` flags a DB
  // row that is shadowing a committed .md file, so the editor can offer to
  // resync its content from that file.
  const repoSlugs = getRepoSlugs()
  const articles = (await getArticles({ includeDrafts: true })).map(a => ({
    slug: a.slug, title: a.title, description: a.description, date: a.date,
    tags: a.tags.join(', '), draft: a.draft, scheduledFor: a.scheduledFor,
    body: a.body, source: a.source, hasRepo: repoSlugs.has(a.slug),
  }))
  return Response.json({ articles })
}

export async function PUT(req: Request) {
  if (!await isAdmin()) return new Response('Unauthorized', { status: 401 })
  await ensureLearnSchema()
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

// Soft delete into the trash, restorable for 7 days.
//
// Deleting a repo-backed article writes a shadow row rather than removing
// anything: the .md file is committed and can't be deleted at runtime, so a
// tombstone is the only way to hide it. Those rows are marked `repo_shadow`
// and survive the purge, because dropping one would bring the file back.
export async function DELETE(req: Request) {
  if (!await isAdmin()) return new Response('Unauthorized', { status: 401 })
  await ensureLearnSchema()
  const url = new URL(req.url)
  const slug = url.searchParams.get('slug')
  if (!slug) return Response.json({ error: 'slug required' }, { status: 400 })

  // ?permanent=1 empties the trash for one item ahead of the 7 days.
  if (url.searchParams.get('permanent') === '1') {
    const [row] = await sql`SELECT repo_shadow FROM learn_articles WHERE slug = ${slug}`
    if (row?.repo_shadow) {
      await sql`UPDATE learn_articles SET body = '', description = '' WHERE slug = ${slug}`
      return Response.json({ ok: true, keptAsTombstone: true })
    }
    await sql`DELETE FROM learn_articles WHERE slug = ${slug}`
    return Response.json({ ok: true })
  }

  const article = (await getArticles({ includeDrafts: true })).find(a => a.slug === slug)
  if (!article) return Response.json({ error: 'No such article' }, { status: 404 })

  await sql`
    INSERT INTO learn_articles (slug, title, description, date, updated, tags, draft, body, repo_shadow, deleted_at)
    VALUES (${article.slug}, ${article.title}, ${article.description}, ${article.date}, ${article.updated ?? null},
            ${article.tags.join(', ')}, ${article.draft}, ${article.body}, ${article.source === 'repo'}, NOW())
    ON CONFLICT (slug) DO UPDATE SET deleted_at = NOW()
  `
  return Response.json({ ok: true, trashed: true })
}

// Restore from the trash. Clears any schedule too — a slot that passed while
// the article sat in the trash would otherwise republish it the instant it
// came back, which is not what "restore" should mean.
export async function PATCH(req: Request) {
  if (!await isAdmin()) return new Response('Unauthorized', { status: 401 })
  await ensureLearnSchema()
  let body: { slug?: string }
  try { body = await req.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }
  if (!body.slug) return Response.json({ error: 'slug required' }, { status: 400 })

  const [row] = await sql`
    UPDATE learn_articles
    SET deleted_at = NULL,
        publish_at = CASE WHEN publish_at IS NOT NULL AND publish_at < ${new Date().toISOString()}
                          THEN NULL ELSE publish_at END
    WHERE slug = ${body.slug} AND deleted_at IS NOT NULL
    RETURNING slug, repo_shadow, body
  `
  if (!row) return Response.json({ error: 'Not in the trash' }, { status: 404 })

  // A purged repo shadow has no content left; dropping the row hands the
  // article back to its committed file.
  if (row.repo_shadow && !row.body) {
    await sql`DELETE FROM learn_articles WHERE slug = ${body.slug}`
    return Response.json({ ok: true, restoredFromRepo: true })
  }
  return Response.json({ ok: true })
}
