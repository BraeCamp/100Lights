import { auth } from '@clerk/nextjs/server'
import { stripe, PLANS } from '@/lib/stripe'
import { getSubscription, upsertSubscription } from '@/lib/subscription'

async function getOrCreateCustomer(
  userId: string,
  existingId: string | null,
  email: string | undefined,
): Promise<string> {
  if (existingId) return existingId

  const customer = await stripe.customers.create({
    email,
    metadata: { userId },
  })

  await upsertSubscription({
    userId,
    stripeCustomerId: customer.id,
    plan: 'free',
    status: 'active',
  })

  return customer.id
}

export async function POST() {
  const { userId, sessionClaims } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const sub = await getSubscription(userId)
  if (sub.plan === 'pro' && sub.status === 'active') {
    return Response.json({ error: 'Already on Pro plan' }, { status: 400 })
  }

  const email = sessionClaims?.email as string | undefined
  const customerId = await getOrCreateCustomer(userId, sub.stripeCustomerId, email)

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [{ price: PLANS.pro.priceId, quantity: 1 }],
    customer: customerId,
    metadata: { userId },
    success_url: 'https://100lights.com/dashboard?upgraded=1',
    cancel_url: 'https://100lights.com/settings',
    subscription_data: {
      metadata: { userId },
    },
    allow_promotion_codes: true,
  })

  return Response.json({ url: session.url })
}
