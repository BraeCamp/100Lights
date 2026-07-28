import { stripe } from '@/lib/stripe'
import { syncConnectAccount } from '@/lib/affiliate-payouts'
import { logWebhook, markWebhook } from '@/lib/webhook-log'

export const runtime = 'nodejs'

// Stripe Connect V2 "thin event" endpoint — separate from the main webhook
// because V2 accounts emit thin events (different payload + verification) rather
// than V1 snapshot events. Configure a Connected-accounts / Thin destination in
// Stripe pointing here, listening for:
//   v2.core.account[requirements].updated
//   v2.core.account[configuration.recipient].capability_status_updated
// Signing secret → STRIPE_CONNECT_WEBHOOK_SECRET.
export async function POST(req: Request) {
  const body = await req.text()
  const sig = req.headers.get('stripe-signature')
  const secret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET
  if (!sig || !secret) return Response.json({ error: 'Missing signature or secret' }, { status: 400 })

  let notif: { id: string; type: string; related_object?: { id?: string } | null }
  try {
    notif = await stripe.parseEventNotificationAsync(body, sig, secret) as unknown as typeof notif
  } catch {
    return Response.json({ error: 'Invalid signature' }, { status: 400 })
  }

  const logId = await logWebhook({ source: 'stripe', eventType: notif.type, eventId: notif.id, payload: notif })
  try {
    // For account events the related object is the connected account; re-reading
    // it and caching readiness handles both requirements + capability changes.
    const acctId = notif.related_object?.id
    if (acctId && acctId.startsWith('acct_')) await syncConnectAccount(acctId)
  } catch (err) {
    await markWebhook(logId, 'failed', err instanceof Error ? err.message : 'Handler failed')
    return Response.json({ error: 'Handler failed' }, { status: 500 })
  }
  await markWebhook(logId, 'handled')
  return Response.json({ received: true })
}
