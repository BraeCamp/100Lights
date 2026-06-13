import { Webhook } from 'svix'
import { stripe } from '@/lib/stripe'
import { sql } from '@/lib/db'

export const runtime = 'nodejs'

interface ClerkEmailAddress {
  email_address: string
  verification: { status: string } | null
}

interface ClerkUserCreatedEvent {
  type: 'user.created'
  data: {
    id: string
    email_addresses: ClerkEmailAddress[]
    first_name: string | null
    last_name: string | null
  }
}

type ClerkWebhookEvent = ClerkUserCreatedEvent | { type: string; data: unknown }

export async function POST(req: Request) {
  const secret = process.env.CLERK_WEBHOOK_SECRET
  if (!secret) return Response.json({ error: 'Webhook not configured' }, { status: 500 })

  const payload = await req.text()
  const headers = {
    'svix-id':        req.headers.get('svix-id') ?? '',
    'svix-timestamp': req.headers.get('svix-timestamp') ?? '',
    'svix-signature': req.headers.get('svix-signature') ?? '',
  }

  let event: ClerkWebhookEvent
  try {
    event = new Webhook(secret).verify(payload, headers) as ClerkWebhookEvent
  } catch {
    return Response.json({ error: 'Invalid signature' }, { status: 400 })
  }

  if (event.type !== 'user.created') {
    return Response.json({ received: true })
  }

  const { id: userId, email_addresses, first_name, last_name } = (event as ClerkUserCreatedEvent).data
  const primaryEmail = email_addresses.find((e: ClerkEmailAddress) => e.verification?.status === 'verified')?.email_address
    ?? email_addresses[0]?.email_address

  if (!primaryEmail) return Response.json({ error: 'No email on user' }, { status: 400 })

  try {
    const existing = await sql`SELECT stripe_customer_id FROM subscriptions WHERE user_id = ${userId}`
    if (existing.length > 0) return Response.json({ received: true })

    const customer = await stripe.customers.create({
      email: primaryEmail,
      name: [first_name, last_name].filter(Boolean).join(' ') || undefined,
      metadata: { userId },
    })

    await sql`
      INSERT INTO subscriptions (user_id, stripe_customer_id, plan, status, updated_at)
      VALUES (${userId}, ${customer.id}, 'free', 'active', NOW())
      ON CONFLICT (user_id) DO UPDATE SET
        stripe_customer_id = EXCLUDED.stripe_customer_id,
        updated_at = NOW()
    `
  } catch (err) {
    console.error('Failed to create Stripe customer for new user:', err)
    return Response.json({ error: 'Customer creation failed' }, { status: 500 })
  }

  return Response.json({ received: true })
}
