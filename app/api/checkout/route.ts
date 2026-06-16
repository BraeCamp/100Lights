import { auth } from '@clerk/nextjs/server'
import { stripe, getProPrice, type BillingPeriod } from '@/lib/stripe'
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

export async function POST(req: Request) {
  const { userId, sessionClaims } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const sub = await getSubscription(userId)
  if (sub.plan === 'pro' && sub.status === 'active') {
    return Response.json({ error: 'Already on Pro plan' }, { status: 400 })
  }

  const body = await req.json().catch(() => ({})) as { plan?: BillingPeriod }
  const period: BillingPeriod = body.plan === 'annual' ? 'annual' : 'monthly'

  const email = sessionClaims?.email as string | undefined
  const [customerId, proPrice] = await Promise.all([
    getOrCreateCustomer(userId, sub.stripeCustomerId, email),
    getProPrice(period),
  ])

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [{ price: proPrice.id, quantity: 1 }],
    customer: customerId,
    metadata: { userId },
    success_url: 'https://100lights.com/dashboard?upgraded=1',
    cancel_url: 'https://100lights.com/settings',
    subscription_data: { metadata: { userId } },
    allow_promotion_codes: true,
  })

  return Response.json({ url: session.url })
}
