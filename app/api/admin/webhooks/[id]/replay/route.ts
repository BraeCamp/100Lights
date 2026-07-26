import { isAdmin } from '@/lib/admin-auth'
import { getWebhook, logWebhook, markWebhook } from '@/lib/webhook-log'
import { handleStripeEvent, handleClerkEvent, type ClerkWebhookEvent } from '@/lib/webhook-handlers'
import { logAdmin } from '@/lib/admin-audit'
import type Stripe from 'stripe'

export const runtime = 'nodejs'

// POST /api/admin/webhooks/[id]/replay — re-run a stored event's handler using
// the exact payload we received. Handlers are idempotent, so replaying a
// checkout/subscription event just re-reconciles the account against Stripe —
// the fix for "the webhook fired but the plan didn't update." A fresh log row
// (replay_of = original) records the replay's own outcome.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!await isAdmin()) return Response.json({ error: 'Not signed in as admin' }, { status: 401 })
  const { id } = await params
  const n = Number(id)
  if (!Number.isFinite(n)) return Response.json({ error: 'bad id' }, { status: 400 })

  const row = await getWebhook(n) as { id: number; source: string; event_type: string; event_id: string | null; payload: unknown } | null
  if (!row) return Response.json({ error: 'not found' }, { status: 404 })
  if (row.source !== 'stripe' && row.source !== 'clerk') {
    return Response.json({ error: 'unknown source' }, { status: 400 })
  }

  const replayId = await logWebhook({
    source: row.source, eventType: row.event_type, eventId: row.event_id, payload: row.payload, replayOf: n,
  })

  try {
    if (row.source === 'stripe') await handleStripeEvent(row.payload as Stripe.Event)
    else await handleClerkEvent(row.payload as ClerkWebhookEvent)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Handler failed'
    await markWebhook(replayId, 'failed', msg)
    await logAdmin('webhook.replay', String(n), { source: row.source, type: row.event_type, ok: false, error: msg })
    return Response.json({ ok: false, error: msg }, { status: 500 })
  }

  await markWebhook(replayId, 'handled')
  await logAdmin('webhook.replay', String(n), { source: row.source, type: row.event_type, ok: true })
  return Response.json({ ok: true, replayId })
}
