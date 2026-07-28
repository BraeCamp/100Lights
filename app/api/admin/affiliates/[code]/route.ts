import { isAdmin } from '@/lib/admin-auth'
import { affiliateReferrals, setAffiliateActive, affiliateLedger, listPayouts, recordPayout } from '@/lib/affiliates'
import { logAdmin } from '@/lib/admin-audit'

export const runtime = 'nodejs'

// GET /api/admin/affiliates/:code — full detail: referrals, commission ledger, payouts.
export async function GET(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  if (!await isAdmin()) return new Response('Unauthorized', { status: 401 })
  const { code } = await params
  const [referrals, ledger, payouts] = await Promise.all([
    affiliateReferrals(code),
    affiliateLedger(code),
    listPayouts(code),
  ])
  return Response.json({ referrals, ledger, payouts })
}

// PATCH /api/admin/affiliates/:code — enable/disable an affiliate (and its code).
export async function PATCH(req: Request, { params }: { params: Promise<{ code: string }> }) {
  if (!await isAdmin()) return new Response('Unauthorized', { status: 401 })
  const { code } = await params
  const body = await req.json().catch(() => ({})) as { active?: boolean }
  const active = Boolean(body.active)
  await setAffiliateActive(code, active)
  await logAdmin('affiliate.toggle', code, { active })
  return Response.json({ ok: true })
}

// POST /api/admin/affiliates/:code — record a payment made to this affiliate.
export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
  if (!await isAdmin()) return new Response('Unauthorized', { status: 401 })
  const { code } = await params
  const body = await req.json().catch(() => ({})) as { amount?: number; method?: string; note?: string }
  const result = await recordPayout({ code, amount: Number(body.amount), method: body.method ?? null, note: body.note ?? null })
  if (!result.ok) return Response.json({ error: result.error }, { status: 400 })
  await logAdmin('affiliate.payout', code, { amount: Number(body.amount), method: body.method ?? null })
  return Response.json({ ok: true })
}
