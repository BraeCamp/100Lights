import { Webhook } from 'svix'
import { handleClerkEvent, type ClerkWebhookEvent } from '@/lib/webhook-handlers'
import { logWebhook, markWebhook } from '@/lib/webhook-log'

export const runtime = 'nodejs'

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

  const eventId = headers['svix-id'] || null
  const logId = await logWebhook({ source: 'clerk', eventType: event.type, eventId, payload: event })

  try {
    await handleClerkEvent(event)
  } catch (err) {
    console.error('Clerk webhook handler error:', err)
    await markWebhook(logId, 'failed', err instanceof Error ? err.message : 'Cleanup failed')
    return Response.json({ error: 'Handler failed' }, { status: 500 })  // Clerk retries
  }

  await markWebhook(logId, 'handled')
  return Response.json({ received: true })
}
