import { sql } from '@/lib/db'

interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetAt: Date
}

/**
 * Check and increment a per-user daily rate limit.
 * Returns { allowed: false } when the limit is exceeded.
 */
export async function checkRateLimit(
  userId: string,
  action: string,
  limitPerDay: number,
): Promise<RateLimitResult> {
  const now = new Date()
  // Reset window = start of tomorrow UTC
  const resetAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1))

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
  const allowed = count <= limitPerDay

  return { allowed, remaining: Math.max(0, limitPerDay - count), resetAt: reset }
}
