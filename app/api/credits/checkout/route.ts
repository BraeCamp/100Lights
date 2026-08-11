import { auth } from '@clerk/nextjs/server'
import { stripe } from '@/lib/stripe'
import { getSubscription, upsertSubscription } from '@/lib/subscription'
import { priceIdForTier, topupPriceId, CREDIT_TIERS, type CreditTier } from '@/lib/credits'

// Checkout for a credit/Pro TIER (subscription) or a one-time credit TOP-UP. The Stripe webhook
// (lib/webhook-handlers) grants the credits on invoice.paid (tier) / checkout.session.completed
// mode=payment (top-up). Metadata carries userId (+ tier/topupCredits) so the webhook can act.
async function getOrCreateCustomer(userId: string, existingId: string | null, email: string | undefined): Promise<string> {
  if (existingId) return existingId
  const customer = await stripe.customers.create({ email, metadata: { userId } })
  await upsertSubscription({ userId, stripeCustomerId: customer.id, plan: 'free', status: 'active' })
  return customer.id
}

export async function POST(req: Request) {
  const { userId, sessionClaims } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({})) as { tier?: string; topupCredits?: number }
  const sub = await getSubscription(userId)
  const email = sessionClaims?.email as string | undefined
  const customerId = await getOrCreateCustomer(userId, sub.stripeCustomerId, email)

  // ── Subscription tier ──
  if (body.tier) {
    if (!(body.tier in CREDIT_TIERS) || body.tier === 'free') return Response.json({ error: 'Invalid tier' }, { status: 400 })
    // Don't let a user with a live Stripe subscription open a second one (double billing).
    const LIVE_SUB = new Set(['active', 'trialing', 'past_due', 'unpaid'])
    if (sub.stripeSubId && LIVE_SUB.has(sub.status)) {
      return Response.json({ error: 'You already have a subscription — manage it in Settings.' }, { status: 400 })
    }
    const price = priceIdForTier(body.tier as CreditTier)
    if (!price) return Response.json({ error: `Tier "${body.tier}" isn't configured yet.` }, { status: 501 })
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription', payment_method_types: ['card'], customer: customerId,
      line_items: [{ price, quantity: 1 }],
      metadata: { userId, tier: body.tier }, subscription_data: { metadata: { userId, tier: body.tier } },
      success_url: 'https://100lights.com/settings?upgraded=1', cancel_url: 'https://100lights.com/settings',
      allow_promotion_codes: true,
    })
    return Response.json({ url: session.url })
  }

  // ── One-time credit top-up ──
  if (body.topupCredits) {
    const price = topupPriceId(body.topupCredits)
    if (!price) return Response.json({ error: 'That top-up isn\'t configured.' }, { status: 501 })
    const session = await stripe.checkout.sessions.create({
      mode: 'payment', payment_method_types: ['card'], customer: customerId,
      line_items: [{ price, quantity: 1 }],
      metadata: { userId, topupCredits: String(body.topupCredits) },
      success_url: 'https://100lights.com/settings?credits=1', cancel_url: 'https://100lights.com/settings',
    })
    return Response.json({ url: session.url })
  }

  return Response.json({ error: 'Specify a tier or topupCredits.' }, { status: 400 })
}
