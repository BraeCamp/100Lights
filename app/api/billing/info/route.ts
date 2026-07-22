import { auth } from '@clerk/nextjs/server'
import { getSubscription } from '@/lib/subscription'

export async function GET() {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const sub = await getSubscription(userId)
  return Response.json({
    plan: sub.plan,
    status: sub.status,
    currentPeriodEnd: sub.currentPeriodEnd?.toISOString() ?? null,
    // Pro time from a redeemed code (distinct from a paid Stripe subscription).
    codeUntil: sub.codeUntil?.toISOString() ?? null,
  })
}
