import { isAdmin } from '@/lib/admin-auth'
import {
  affiliateReferrals, setAffiliateActive, affiliateLedger, listPayouts, recordPayout,
  markFullyPaid, getOrCreateTaxToken, getAffiliateTax,
} from '@/lib/affiliates'
import { getConnectStatus, connectOnboardingLink, payAffiliateViaConnect } from '@/lib/affiliate-payouts'
import { logAdmin } from '@/lib/admin-audit'

export const runtime = 'nodejs'

// GET /api/admin/affiliates/:code — full detail: referrals, ledger, payouts, tax.
export async function GET(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  if (!await isAdmin()) return new Response('Unauthorized', { status: 401 })
  const { code } = await params
  const [referrals, ledger, payouts, taxToken, tax, connect] = await Promise.all([
    affiliateReferrals(code),
    affiliateLedger(code),
    listPayouts(code),
    getOrCreateTaxToken(code),
    getAffiliateTax(code),
    getConnectStatus(code),
  ])
  return Response.json({ referrals, ledger, payouts, taxToken, tax, connect })
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

// POST /api/admin/affiliates/:code — record a payout, or mark the balance fully paid.
export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
  if (!await isAdmin()) return new Response('Unauthorized', { status: 401 })
  const { code } = await params
  const body = await req.json().catch(() => ({})) as { amount?: number; method?: string; note?: string; action?: string }

  if (body.action === 'markPaid') {
    const r = await markFullyPaid(code, body.method ?? null)
    if (!r.ok) return Response.json({ error: r.error }, { status: 400 })
    await logAdmin('affiliate.payout', code, { amount: r.amount, markPaid: true })
    return Response.json({ ok: true, amount: r.amount })
  }

  // Get a Connect onboarding link to send the affiliate directly.
  if (body.action === 'connectLink') {
    const r = await connectOnboardingLink(code)
    if (!r.ok) return Response.json({ error: r.error }, { status: 400 })
    return Response.json({ ok: true, url: r.url })
  }

  // Actually send the affiliate their balance via Stripe Connect.
  if (body.action === 'payConnect') {
    const r = await payAffiliateViaConnect(code)
    if (!r.ok) return Response.json({ error: r.error }, { status: 400 })
    await logAdmin('affiliate.payout', code, { amount: r.amount, via: 'stripe', transfer: r.transferId })
    return Response.json({ ok: true, amount: r.amount })
  }

  const result = await recordPayout({ code, amount: Number(body.amount), method: body.method ?? null, note: body.note ?? null })
  if (!result.ok) return Response.json({ error: result.error }, { status: 400 })
  await logAdmin('affiliate.payout', code, { amount: Number(body.amount), method: body.method ?? null })
  return Response.json({ ok: true })
}
