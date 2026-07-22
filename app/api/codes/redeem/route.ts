import { auth } from '@clerk/nextjs/server'
import { redeemCode, hasUsedStarterCode } from '@/lib/codes'
import { getSubscription } from '@/lib/subscription'

export const runtime = 'nodejs'

// GET /api/codes/redeem — eligibility for the signup starter-code prompt.
export async function GET() {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const [usedStarter, sub] = await Promise.all([
    hasUsedStarterCode(userId),
    getSubscription(userId),
  ])
  return Response.json({
    usedStarter,
    plan: sub.plan,
    codeUntil: sub.codeUntil?.toISOString() ?? null,
  })
}

// POST /api/codes/redeem — redeem a code for the signed-in user. Body: { code }
export async function POST(req: Request) {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Sign in to redeem a code.' }, { status: 401 })

  const body = await req.json().catch(() => ({})) as { code?: string }
  const result = await redeemCode(userId, body.code ?? '')

  if (!result.ok) {
    return Response.json({ error: result.error, reason: result.reason }, { status: 400 })
  }
  return Response.json({
    ok: true,
    kind: result.kind,
    grantDays: result.grantDays,
    until: result.until,
  })
}
