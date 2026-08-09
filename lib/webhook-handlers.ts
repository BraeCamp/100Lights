import { stripe } from './stripe'
import { upsertSubscription } from './subscription'
import { CREDITS_ENABLED, applyTierGrant, grantCredits, TIER_BY_PRICE } from './credits'
import { recordInvoiceCommission } from './affiliates'
import { sql } from './db'
import type Stripe from 'stripe'

// The pure business logic behind each webhook, factored out of the route so it
// can be re-run on demand from the admin webhook log (replay). Everything here
// must stay idempotent — replaying an event twice must not double-charge,
// double-delete, or corrupt a subscription. upsertSubscription and the ON
// CONFLICT / existence-guarded deletes below all satisfy that.

// --- Stripe -----------------------------------------------------------------

// 2025+ Stripe API versions moved current_period_end from the subscription to
// its items; older payloads have it top-level. Missing/invalid → undefined,
// never an Invalid Date (toISOString() on one throws and fails the webhook —
// which would leave a paying customer without their plan).
function periodEnd(sub: Stripe.Subscription): Date | undefined {
  const raw = (sub as unknown as { current_period_end?: number }).current_period_end
    ?? sub.items?.data?.[0]?.current_period_end
  if (typeof raw !== 'number' || !isFinite(raw)) return undefined
  return new Date(raw * 1000)
}

// invoice.subscription similarly moved under parent.subscription_details
function invoiceSubId(invoice: Stripe.Invoice): string | null {
  const legacy = (invoice as unknown as { subscription?: string | { id: string } }).subscription
  if (typeof legacy === 'string') return legacy
  if (legacy && typeof legacy === 'object') return legacy.id
  const nested = (invoice as unknown as { parent?: { subscription_details?: { subscription?: string | { id: string } } } }).parent?.subscription_details?.subscription
  if (typeof nested === 'string') return nested
  if (nested && typeof nested === 'object') return nested.id
  return null
}

export async function handleStripeEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session
      // One-time AI credit top-up (no subscription).
      if (session.mode === 'payment') {
        const uid = session.metadata?.userId
        const credits = Number(session.metadata?.topupCredits || 0)
        if (CREDITS_ENABLED && uid && credits > 0) await grantCredits(uid, credits, 'credit top-up')
        break
      }
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
        currentPeriodEnd: periodEnd(sub),
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
        currentPeriodEnd: periodEnd(sub),
      })
      break
    }
    case 'invoice.payment_failed': {
      const invoice = event.data.object as Stripe.Invoice
      const subId = invoiceSubId(invoice)
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
        currentPeriodEnd: periodEnd(sub),
      })
      break
    }
    case 'invoice.paid': {
      // A subscription invoice actually settled — credit the referring affiliate
      // (if any) their % of the real amount paid. Idempotent + best-effort, so a
      // replay or a missing affiliate never disturbs billing.
      const invoice = event.data.object as Stripe.Invoice
      const subId = invoiceSubId(invoice)
      const amountPaid = invoice.amount_paid ?? 0
      if (!subId || amountPaid <= 0 || !invoice.id) break
      const sub = await stripe.subscriptions.retrieve(subId)
      const userId = sub.metadata?.userId
        ?? (await sql`SELECT user_id FROM subscriptions WHERE stripe_customer_id = ${invoice.customer as string}`)[0]?.user_id as string | undefined
      if (!userId) break
      await recordInvoiceCommission({
        userId,
        invoiceId: invoice.id,
        amountPaidCents: amountPaid,
        currency: invoice.currency ?? 'usd',
        invoiceAt: new Date((invoice.created ?? Math.floor(Date.now() / 1000)) * 1000),
      })
      // Grant this cycle's AI credit allotment for the paid tier (no-op until CREDITS_ENABLED +
      // the price→tier map is filled in TIER_BY_PRICE). Fires every cycle incl. the first invoice.
      if (CREDITS_ENABLED) {
        const priceId = sub.items?.data?.[0]?.price?.id
        const tier = priceId ? TIER_BY_PRICE[priceId] : undefined
        if (tier) await applyTierGrant(userId, tier)
      }
      break
    }
    // Connect affiliate readiness (V2 recipient accounts) arrives as thin events
    // on a separate endpoint — see app/api/webhook/stripe-connect.
  }
}

// --- Clerk ------------------------------------------------------------------

interface ClerkEmailAddress {
  email_address: string
  verification: { status: string } | null
}
export type ClerkWebhookEvent = { type: string; data: unknown }

export async function handleClerkEvent(event: ClerkWebhookEvent): Promise<void> {
  // Account deletion: remove everything the user owns. R2 objects are keyed
  // under their userId prefix; a lifecycle rule or batch sweep can reclaim
  // them later — the database references disappear now, which is what makes
  // the data unreachable.
  if (event.type === 'user.deleted') {
    const userId = (event.data as { id?: string })?.id
    if (!userId) return
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
    return
  }

  if (event.type !== 'user.created') return

  const { id: userId, email_addresses, first_name, last_name } = (event as {
    data: { id: string; email_addresses: ClerkEmailAddress[]; first_name: string | null; last_name: string | null }
  }).data
  const primaryEmail = email_addresses.find(e => e.verification?.status === 'verified')?.email_address
    ?? email_addresses[0]?.email_address
  if (!primaryEmail) throw new Error('No email on user')

  const existing = await sql`SELECT stripe_customer_id FROM subscriptions WHERE user_id = ${userId}`
  if (existing.length > 0) return

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
      updated_at = NOW()`
}
