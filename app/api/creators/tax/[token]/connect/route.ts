import { affiliateTaxContext } from '@/lib/affiliates'
import { connectOnboardingLink } from '@/lib/affiliate-payouts'

export const runtime = 'nodejs'

// POST /api/creators/tax/:token/connect — start Stripe Connect onboarding for
// the affiliate behind this token; returns a Stripe-hosted onboarding URL.
export async function POST(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const ctx = await affiliateTaxContext(token)
  if (!ctx) return Response.json({ error: 'This link isn’t valid.' }, { status: 404 })
  const r = await connectOnboardingLink(ctx.code)
  if (!r.ok) return Response.json({ error: r.error }, { status: 400 })
  return Response.json({ url: r.url })
}
