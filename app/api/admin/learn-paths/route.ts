import { isAdmin } from '@/lib/admin-auth'
import { listLearnPathsAdmin, upsertLearnPath } from '@/lib/learn-paths-store'
import { getArticles } from '@/lib/learn-articles'
import { logAdmin } from '@/lib/admin-audit'

export const runtime = 'nodejs'

// GET /api/admin/learn-paths — all paths (built-in + edits) + the article list
// to pick from (includes drafts, so a path can be laid out before it's written).
export async function GET() {
  if (!await isAdmin()) return new Response('Unauthorized', { status: 401 })
  const [paths, articles] = await Promise.all([
    listLearnPathsAdmin(),
    getArticles({ includeDrafts: true }),
  ])
  return Response.json({
    paths,
    articles: articles.map(a => ({ slug: a.slug, title: a.title, draft: a.draft })),
  })
}

// POST /api/admin/learn-paths — create or edit a path.
export async function POST(req: Request) {
  if (!await isAdmin()) return new Response('Unauthorized', { status: 401 })
  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const result = await upsertLearnPath({
    slug: body.slug as string,
    title: body.title as string,
    goal: body.goal as string,
    description: body.description as string,
    emoji: body.emoji as string,
    level: body.level as string,
    articleSlugs: Array.isArray(body.articleSlugs) ? body.articleSlugs as string[] : [],
    active: body.active !== false,
    sortOrder: body.sortOrder == null ? null : Number(body.sortOrder),
  })
  if (!result.ok) return Response.json({ error: result.error }, { status: 400 })
  await logAdmin('learn_path.upsert', result.slug, {})
  return Response.json({ ok: true, slug: result.slug })
}
