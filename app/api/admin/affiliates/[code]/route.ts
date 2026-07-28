import { isAdmin } from '@/lib/admin-auth'
import { affiliateReferrals, setAffiliateActive } from '@/lib/affiliates'
import { logAdmin } from '@/lib/admin-audit'

export const runtime = 'nodejs'

// GET /api/admin/affiliates/:code — referred users for one affiliate.
export async function GET(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  if (!await isAdmin()) return new Response('Unauthorized', { status: 401 })
  const { code } = await params
  return Response.json({ referrals: await affiliateReferrals(code) })
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
