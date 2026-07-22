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

  // Account deletion: remove everything the user owns. R2 objects are keyed
  // under their userId prefix; a lifecycle rule or batch sweep can reclaim
  // them later — the database references disappear now, which is what makes
  // the data unreachable.
  if (event.type === 'user.deleted') {
    const userId = (event.data as { id?: string })?.id
    if (!userId) return Response.json({ received: true })
    try {
      // Cancel any live Stripe subscription so they aren't billed post-deletion
      const subRows = await sql`SELECT stripe_sub_id FROM subscriptions WHERE user_id = ${userId}`
      const subId = subRows[0]?.stripe_sub_id as string | null
      if (subId) {
        try { await stripe.subscriptions.cancel(subId) } catch { /* already gone */ }
      }
      const owned = await sql`SELECT id FROM projects WHERE user_id = ${userId}`
      const projectIds = owned.map(r => r.id as string)
      if (projectIds.length > 0) {
        await sql`DELETE FROM project_members WHERE project_id = ANY(${projectIds}::uuid[])`
      }
      await sql`DELETE FROM projects WHERE user_id = ${userId}`
      const items = await sql`SELECT id FROM community_items WHERE user_id = ${userId}`
      const itemIds = items.map(r => r.id as string)
      if (itemIds.length > 0) {
        await sql`DELETE FROM community_votes WHERE item_id = ANY(${itemIds}::uuid[])`
        await sql`DELETE FROM community_reactions WHERE item_id = ANY(${itemIds}::uuid[])`
        await sql`DELETE FROM community_reports WHERE item_id = ANY(${itemIds}::uuid[])`
      }
      await sql`DELETE FROM community_items WHERE user_id = ${userId}`
      await sql`DELETE FROM community_votes WHERE user_id = ${userId}`
      await sql`DELETE FROM community_reactions WHERE user_id = ${userId}`
      await sql`DELETE FROM community_reports WHERE user_id = ${userId}`
      await sql`DELETE FROM feedback WHERE user_id = ${userId}`
      await sql`DELETE FROM upload_log WHERE user_id = ${userId}`
      await sql`DELETE FROM subscriptions WHERE user_id = ${userId}`
      try { await sql`DELETE FROM usage WHERE user_id = ${userId}` } catch { /* table optional */ }
      // Redemption history (the codes themselves are global and stay). Optional
      // table — a user may be deleted before the codes feature ever ran.
      try { await sql`DELETE FROM code_redemptions WHERE user_id = ${userId}` } catch { /* table optional */ }
    } catch (err) {
      console.error('user.deleted cleanup failed:', err)
      return Response.json({ error: 'Cleanup failed' }, { status: 500 })  // Clerk retries
    }
    return Response.json({ received: true })
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
