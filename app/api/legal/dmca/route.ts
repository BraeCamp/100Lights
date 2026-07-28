import { headers } from 'next/headers'
import { submitDmcaNotice } from '@/lib/dmca'
import { sendDmcaAckEmail } from '@/lib/email'
import { checkAttemptLimit } from '@/lib/rate-limit'

export const runtime = 'nodejs'

// POST /api/legal/dmca — public copyright-infringement takedown notice.
export async function POST(req: Request) {
  try {
    const h = await headers()
    const ip = (h.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown'
    const rl = await checkAttemptLimit(ip, 'dmca_notice', 5, 3600)
    if (!rl.allowed) {
      return Response.json({ error: 'Too many submissions — try again later.' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } })
    }
  } catch { /* limiter unavailable — allow */ }

  const b = await req.json().catch(() => ({})) as Record<string, unknown>
  const result = await submitDmcaNotice({
    complainantName: b.complainantName as string,
    email: b.email as string,
    workDescription: b.workDescription as string,
    infringingUrl: b.infringingUrl as string,
    signature: b.signature as string,
    goodFaith: Boolean(b.goodFaith),
    accuracy: Boolean(b.accuracy),
  })
  if (!result.ok) return Response.json({ error: result.error }, { status: 400 })
  // Acknowledge receipt to the complainant (best-effort, from dmca@).
  await sendDmcaAckEmail(String(b.email ?? ''), String(b.complainantName ?? ''))
  return Response.json({ ok: true })
}
