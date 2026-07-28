import { headers } from 'next/headers'
import { submitApplication } from '@/lib/affiliates'
import { checkAttemptLimit } from '@/lib/rate-limit'

export const runtime = 'nodejs'

// POST /api/creators/apply — public affiliate-program application from /creators.
export async function POST(req: Request) {
  // Abuse guard: cap submissions per IP so the public form can't be flooded.
  try {
    const h = await headers()
    const ip = (h.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown'
    const rl = await checkAttemptLimit(ip, 'affiliate_apply', 5, 3600) // 5 / hour / IP
    if (!rl.allowed) {
      return Response.json(
        { error: 'Too many applications from here — try again later.' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } },
      )
    }
  } catch { /* limiter unavailable — allow */ }

  const body = await req.json().catch(() => ({})) as Record<string, string>
  const result = await submitApplication({
    name: body.name, contact: body.contact, platform: body.platform,
    audience: body.audience, links: body.links, note: body.note,
  })
  if (!result.ok) return Response.json({ error: result.error }, { status: 400 })
  return Response.json({ ok: true })
}
