import { sql } from '@/lib/db'
import { getSubscription, getPlanLimits } from '@/lib/subscription'

interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetAt: Date
}

export async function checkRateLimit(
  userId: string,
  action: 'transcribe',
  _legacyLimit?: number,
): Promise<RateLimitResult> {
  const sub = await getSubscription(userId)
  const limits = getPlanLimits(sub.plan)

  const limitPerMonth = limits.transcriptionsPerMonth

  const now = new Date()
  const resetAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))

  const rows = await sql`
    INSERT INTO usage (user_id, action, count, reset_at)
    VALUES (${userId}, ${action}, 1, ${resetAt.toISOString()})
    ON CONFLICT (user_id, action) DO UPDATE
      SET count    = CASE WHEN usage.reset_at <= NOW() THEN 1       ELSE usage.count + 1 END,
          reset_at = CASE WHEN usage.reset_at <= NOW() THEN ${resetAt.toISOString()} ELSE usage.reset_at END
    RETURNING count, reset_at
  `

  const count   = Number(rows[0].count)
  const reset   = new Date(rows[0].reset_at as string)
  const allowed = count <= limitPerMonth

  return { allowed, remaining: Math.max(0, limitPerMonth - count), resetAt: reset }
}
