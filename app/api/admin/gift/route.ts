import { isAdmin } from '@/lib/admin-auth'
import { sql } from '@/lib/db'

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

  if (plan === null || plan === undefined) {
    // Remove gift entirely
    await sql`
      UPDATE subscriptions
      SET gift_plan = NULL, gift_until = NULL, updated_at = NOW()
      WHERE user_id = ${userId}
    `
  } else if (days === null || days === undefined) {
    // Indefinite gift
    await sql`
      UPDATE subscriptions
      SET gift_plan = ${plan}, gift_until = NULL, updated_at = NOW()
      WHERE user_id = ${userId}
    `
  } else {
    // Timed gift — extend from the later of NOW() and the current gift_until
    await sql`
      UPDATE subscriptions
      SET gift_plan  = ${plan},
          gift_until = GREATEST(NOW(), COALESCE(gift_until, NOW())) + (${days}::int * INTERVAL '1 day'),
          updated_at = NOW()
      WHERE user_id = ${userId}
    `
  }

  return Response.json({ ok: true })
}
