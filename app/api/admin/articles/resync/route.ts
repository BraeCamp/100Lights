import { isAdmin } from '@/lib/admin-auth'
import { sql } from '@/lib/db'
import { getRepoArticle } from '@/lib/learn-articles'
import { ensureLearnSchema } from '@/lib/learn-schema'

export const runtime = 'nodejs'

// Refresh a DB row's CONTENT from its committed .md file.
//
// Scheduling or publishing a repo article copies its body into the DB (the FS
// is read-only in production and the DB wins on slug), so later edits to the
// file stop showing on the live site. This copies the file's current content
// back over the row — leaving publish_at, draft, and deleted_at untouched, so
// the article keeps whatever published/scheduled state it already had.
export async function POST(req: Request) {
  if (!await isAdmin()) return new Response('Unauthorized', { status: 401 })
  await ensureLearnSchema()

  let body: { slug?: string }
  try { body = await req.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const slug = body.slug
  if (!slug) return Response.json({ error: 'slug required' }, { status: 400 })

  const repo = getRepoArticle(slug)
  if (!repo) return Response.json({ error: 'No committed .md file for this slug — nothing to sync from.' }, { status: 404 })

  const updated = new Date().toISOString().slice(0, 10)
  const [row] = await sql`
    UPDATE learn_articles
    SET title = ${repo.title}, description = ${repo.description}, date = ${repo.date},
        updated = ${updated}, tags = ${repo.tags.join(', ')}, body = ${repo.body}
    WHERE slug = ${slug}
    RETURNING slug
  `
  if (!row) return Response.json({ error: 'No DB row for this slug — the file is already the live source.' }, { status: 404 })
  return Response.json({ ok: true, slug })
}
