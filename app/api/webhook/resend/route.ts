import { Webhook } from 'svix'
import { suppressEmail } from '@/lib/email'

export const runtime = 'nodejs'

// Resend event webhook. Configure a webhook in the Resend dashboard pointing
// here, listening for email.bounced + email.complained, and put its signing
// secret in RESEND_WEBHOOK_SECRET. Bounces/complaints add the recipient to the
// suppression list so we never mail them again (keeps deliverability healthy).
export async function POST(req: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET
  if (!secret) return Response.json({ error: 'Webhook secret not configured' }, { status: 400 })

  const body = await req.text()
  const headers = {
    'svix-id': req.headers.get('svix-id') ?? '',
    'svix-timestamp': req.headers.get('svix-timestamp') ?? '',
    'svix-signature': req.headers.get('svix-signature') ?? '',
  }

  let event: { type?: string; data?: { to?: string[]; email?: string } }
  try {
    event = new Webhook(secret).verify(body, headers) as typeof event
  } catch {
    return new Response('Invalid signature', { status: 400 })
  }

  if (event.type === 'email.bounced' || event.type === 'email.complained') {
    const reason = event.type === 'email.complained' ? 'complaint' : 'bounce'
    const recipients = event.data?.to ?? (event.data?.email ? [event.data.email] : [])
    for (const r of recipients) await suppressEmail(r, reason)
  }

  return Response.json({ received: true })
}
