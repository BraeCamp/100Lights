import { isAdmin } from '@/lib/admin-auth'
import { sql } from '@/lib/db'
import { getArticles, getRepoArticle } from '@/lib/learn-articles'
import { ensureLearnSchema } from '@/lib/learn-schema'

export const runtime = 'nodejs'

// Scheduled publishing: give a draft a `publish_at` and it goes live on its
// own, no deploy and no visit to the admin panel.
//
// Two things make this work without a cron job. Publication is *derived* —
// `learn-articles.ts` compares publish_at to now on every read, so nothing has
// to run at the appointed time. And repo articles get copied into the DB when
// scheduled, because the filesystem is read-only in production and the DB
// already wins on slug collision; that copy carries the schedule.
//
// Timestamps arrive as explicit ISO strings from the client, which knows the
// editor's timezone. Computing "9am daily" server-side would silently mean
// 9am UTC.

interface Slot { slug: string; publishAt: string | null }

export async function POST(req: Request) {
  if (!await isAdmin()) return Response.json({ error: 'Not signed in as admin' }, { status: 401 })
  await ensureLearnSchema()

  let body: { slots?: Slot[] }
  try { body = await req.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const slots = body.slots ?? []
  if (!Array.isArray(slots) || slots.length === 0) {
    return Response.json({ error: 'Nothing to schedule' }, { status: 400 })
  }
  for (const s of slots) {
    if (!s?.slug) return Response.json({ error: 'Every slot needs a slug' }, { status: 400 })
    if (s.publishAt != null && Number.isNaN(Date.parse(s.publishAt))) {
      return Response.json({ error: `Bad date for ${s.slug}: ${s.publishAt}` }, { status: 400 })
    }
  }

  // Merged view so repo-only articles can be copied in with their content.
  const all = await getArticles({ includeDrafts: true })
  const bySlug = new Map(all.map(a => [a.slug, a]))

  let scheduled = 0, cleared = 0
  const skipped: string[] = []
  for (const s of slots) {
    const merged = bySlug.get(s.slug)
    if (!merged) continue
    // Snapshot the committed file's CURRENT content when one exists — the
    // merged view can hand back a stale DB copy that already shadows the file.
    const a = getRepoArticle(s.slug) ?? merged
    // Scheduling something already live would pull it back off the site until
    // its slot — never what's intended, so refuse rather than surprise.
    if (s.publishAt && !merged.draft) { skipped.push(a.slug); continue }
    const at = s.publishAt ? new Date(s.publishAt).toISOString() : null

    // Upsert carries the article's content so a repo article keeps working
    // once the DB row shadows it.
    await sql`
      INSERT INTO learn_articles (slug, title, description, date, updated, tags, draft, body, publish_at)
      VALUES (${a.slug}, ${a.title}, ${a.description}, ${a.date}, ${a.updated ?? null},
              ${a.tags.join(', ')}, true, ${a.body}, ${at})
      ON CONFLICT (slug) DO UPDATE SET publish_at = EXCLUDED.publish_at
    `
    if (at) scheduled++; else cleared++
  }

  return Response.json({ ok: true, scheduled, cleared, skipped })
}
