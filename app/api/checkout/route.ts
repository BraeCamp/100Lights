import { auth } from '@clerk/nextjs/server'
import { stripe, PLANS } from '@/lib/stripe'
import { getSubscription } from '@/lib/subscription'

export async function POST() {
  const { userId, sessionClaims } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const sub = await getSubscription(userId)
  if (sub.plan === 'pro' && sub.status === 'active') {
    return Response.json({ error: 'Already on Pro plan' }, { status: 400 })
  }

  const email = sessionClaims?.email as string | undefined

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [{ price: PLANS.pro.priceId, quantity: 1 }],
    customer: sub.stripeCustomerId ?? undefined,
    customer_email: !sub.stripeCustomerId ? email : undefined,
    metadata: { userId },
    success_url: `https://100lights.com/dashboard?upgraded=1`,
    cancel_url: `https://100lights.com/dashboard`,
    subscription_data: {
      metadata: { userId },
    },
  })

  return Response.json({ url: session.url })
}
