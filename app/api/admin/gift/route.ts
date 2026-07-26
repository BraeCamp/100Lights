import { isAdmin } from '@/lib/admin-auth'
import { sql } from '@/lib/db'
import { logAdmin } from '@/lib/admin-audit'

export const runtime = 'nodejs'

export async function POST(req: Request) {
  if (!await isAdmin()) return new Response('Unauthorized', { status: 401 })

  const body = await req.json().catch(() => ({})) as {
    userId?: string
    plan?: string | null
    days?: number | null
  }
  const { userId, plan, days } = body

  if (!userId) return Response.json({ error: 'userId required' }, { status: 400 })
  // The gift model only knows 'pro' (or null to remove); reject anything else
  // so a stray value can't become an "effective plan" downstream.
  if (plan !== null && plan !== undefined && plan !== 'pro') {
    return Response.json({ error: "plan must be 'pro' or null" }, { status: 400 })
  }

  let rows: Record<string, unknown>[]
  if (plan === null || plan === undefined) {
    // Remove gift entirely
    rows = await sql`
      UPDATE subscriptions
      SET gift_plan = NULL, gift_until = NULL, updated_at = NOW()
      WHERE user_id = ${userId}
      RETURNING user_id
    `
  } else if (days === null || days === undefined) {
    // Indefinite gift
    rows = await sql`
      UPDATE subscriptions
      SET gift_plan = ${plan}, gift_until = NULL, updated_at = NOW()
      WHERE user_id = ${userId}
      RETURNING user_id
    `
  } else {
    // Timed gift — extend from the later of NOW() and the current gift_until
    rows = await sql`
      UPDATE subscriptions
      SET gift_plan  = ${plan},
          gift_until = GREATEST(NOW(), COALESCE(gift_until, NOW())) + (${days}::int * INTERVAL '1 day'),
          updated_at = NOW()
      WHERE user_id = ${userId}
      RETURNING user_id
    `
  }

  // No row updated → this user has no subscriptions record (e.g. the Clerk
  // signup webhook never created one). Surface it instead of a false success.
  if (rows.length === 0) {
    return Response.json({ error: 'No subscription record for this user yet — they need to sign in once so their account is provisioned.' }, { status: 404 })
  }

  await logAdmin(plan ? 'gift.grant' : 'gift.remove', userId, plan ? { plan, days: days ?? 'indefinite' } : undefined)
  return Response.json({ ok: true })
}
