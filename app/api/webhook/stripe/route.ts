import { stripe } from '@/lib/stripe'
import { upsertSubscription } from '@/lib/subscription'
import type Stripe from 'stripe'

export const runtime = 'nodejs'

export async function POST(req: Request) {
  const body = await req.text()
  const sig = req.headers.get('stripe-signature')
  const secret = process.env.STRIPE_WEBHOOK_SECRET

  if (!sig || !secret) {
    return Response.json({ error: 'Missing signature or secret' }, { status: 400 })
  }

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, sig, secret)
  } catch {
    return Response.json({ error: 'Invalid signature' }, { status: 400 })
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        if (session.mode !== 'subscription') break
        const userId = session.metadata?.userId
        if (!userId || !session.customer || !session.subscription) break
        const sub = await stripe.subscriptions.retrieve(session.subscription as string)
        await upsertSubscription({
          userId,
          stripeCustomerId: session.customer as string,
          stripeSubId: sub.id,
          plan: 'pro',
          status: sub.status,
          currentPeriodEnd: new Date((sub as unknown as { current_period_end: number }).current_period_end * 1000),
        })
        break
      }
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription
        const userId = sub.metadata?.userId
        if (!userId) break
        const plan = sub.status === 'active' ? 'pro' : 'free'
        await upsertSubscription({
          userId,
          stripeCustomerId: sub.customer as string,
          stripeSubId: sub.id,
          plan,
          status: sub.status,
          currentPeriodEnd: new Date((sub as unknown as { current_period_end: number }).current_period_end * 1000),
        })
        break
      }
      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice
        const subId = (invoice as unknown as { subscription: string }).subscription
        if (!subId) break
        const sub = await stripe.subscriptions.retrieve(subId)
        const userId = sub.metadata?.userId
        if (!userId) break
        await upsertSubscription({
          userId,
          stripeCustomerId: sub.customer as string,
          stripeSubId: sub.id,
          plan: 'free',
          status: 'past_due',
          currentPeriodEnd: new Date((sub as unknown as { current_period_end: number }).current_period_end * 1000),
        })
        break
      }
    }
  } catch (err) {
    console.error('Webhook handler error:', err)
    return Response.json({ error: 'Handler failed' }, { status: 500 })
  }

  return Response.json({ received: true })
}
