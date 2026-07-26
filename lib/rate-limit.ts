import { sql } from '@/lib/db'

interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetAt: Date
}

/**
 * Generic fixed-window attempt limiter over the `usage` counter table. Returns
 * allowed=false once `max` hits accrue within `windowSec` for a (key, action).
 * Used for abuse protection on public endpoints (e.g. code redemption) to stop
 * brute-force guessing. The caller decides whether to fail open on error.
 */
export async function checkAttemptLimit(
  key: string, action: string, max: number, windowSec: number,
): Promise<{ allowed: boolean; retryAfterSec: number }> {
  const resetAt = new Date(Date.now() + windowSec * 1000).toISOString()
  const rows = await sql`
    INSERT INTO usage (user_id, action, count, reset_at)
    VALUES (${key}, ${action}, 1, ${resetAt})
    ON CONFLICT (user_id, action) DO UPDATE
      SET count    = CASE WHEN usage.reset_at <= NOW() THEN 1        ELSE usage.count + 1 END,
          reset_at = CASE WHEN usage.reset_at <= NOW() THEN ${resetAt} ELSE usage.reset_at END
    RETURNING count, reset_at
  `
  const count = Number(rows[0].count)
  const reset = new Date(rows[0].reset_at as string)
  return { allowed: count <= max, retryAfterSec: Math.max(1, Math.ceil((reset.getTime() - Date.now()) / 1000)) }
}

export async function checkRateLimit(
  userId: string,
  action: 'transcribe',
  _legacyLimit?: number,
): Promise<RateLimitResult> {
  // Transcription is no longer a marketed plan feature; the caption
  // generator keeps a flat internal cap purely as abuse protection.
  const limitPerMonth = 30

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
