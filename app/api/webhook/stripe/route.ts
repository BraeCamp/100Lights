import { stripe } from '@/lib/stripe'
import { handleStripeEvent } from '@/lib/webhook-handlers'
import { logWebhook, markWebhook } from '@/lib/webhook-log'
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

  // Durable record first (never blocks handling if logging fails).
  const logId = await logWebhook({ source: 'stripe', eventType: event.type, eventId: event.id, payload: event })

  try {
    await handleStripeEvent(event)
  } catch (err) {
    console.error('Webhook handler error:', err)
    await markWebhook(logId, 'failed', err instanceof Error ? err.message : 'Handler failed')
    return Response.json({ error: 'Handler failed' }, { status: 500 })
  }

  await markWebhook(logId, 'handled')
  return Response.json({ received: true })
}
