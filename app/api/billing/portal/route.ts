import { auth } from '@clerk/nextjs/server'
import { stripe } from '@/lib/stripe'
import { getSubscription } from '@/lib/subscription'

export async function POST() {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const sub = await getSubscription(userId)
  if (!sub.stripeCustomerId) {
    return Response.json({ error: 'No billing account found' }, { status: 404 })
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: sub.stripeCustomerId,
    return_url: 'https://100lights.com/settings',
  })

  return Response.json({ url: session.url })
}
