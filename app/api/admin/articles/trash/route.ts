import { isAdmin } from '@/lib/admin-auth'
import { getTrashedArticles } from '@/lib/learn-articles'
import { ensureLearnSchema, purgeExpiredArticleTrash, TRASH_DAYS } from '@/lib/learn-schema'

export const runtime = 'nodejs'

// Trashed articles, with how long each has left.
//
// The purge runs opportunistically here rather than on a schedule, matching
// how projects handle it (app/api/projects/route.ts) — there's no cron in this
// app, and the trash view is the one place someone reliably looks.
export async function GET() {
  if (!await isAdmin()) return Response.json({ error: 'Not signed in as admin' }, { status: 401 })
  await ensureLearnSchema()
  await purgeExpiredArticleTrash().catch(() => {})

  const items = (await getTrashedArticles()).map(a => {
    const expires = new Date(Date.parse(a.deletedAt) + TRASH_DAYS * 86400_000)
    return {
      slug: a.slug,
      title: a.title,
      deletedAt: a.deletedAt,
      expiresAt: expires.toISOString(),
      daysLeft: Math.max(0, Math.ceil((expires.getTime() - Date.now()) / 86400_000)),
      /** A shadow row hides a committed .md file, so it can't fully go away. */
      repoShadow: a.repoShadow,
    }
  })
  return Response.json({ items, retentionDays: TRASH_DAYS })
}
