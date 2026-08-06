import { auth } from '@clerk/nextjs/server'
import { sql } from '@/lib/db'
import { getSubscription, getPlanLimits } from '@/lib/subscription'

export async function GET() {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const sub = await getSubscription(userId)
  const limits = getPlanLimits(sub.plan)

  // Cloud storage used = sum of one (latest) row per R2 key, matching the
  // presign route's accounting (stable keys overwrite, so duplicate rows from
  // re-uploads must not double-count). Best-effort: 0 if the log isn't there.
  let usedBytes = 0
  try {
    const rows = await sql`
      SELECT COALESCE(SUM(sz), 0)::bigint AS total FROM (
        SELECT DISTINCT ON (key) size AS sz
        FROM upload_log WHERE user_id = ${userId}
        ORDER BY key, at DESC
      ) t`
    usedBytes = Number(rows[0]?.total ?? 0)
  } catch { /* upload_log not provisioned yet → 0 */ }

  return Response.json({
    plan: sub.plan,
    storage: {
      usedBytes,
      limitBytes: limits.storageMb * 1024 * 1024,
    },
  })
}
