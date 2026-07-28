import { isAdmin } from '@/lib/admin-auth'
import { listAffiliates, createAffiliate } from '@/lib/affiliates'
import { logAdmin } from '@/lib/admin-audit'

export const runtime = 'nodejs'

// GET /api/admin/affiliates — every affiliate with live referral/commission stats.
export async function GET() {
  if (!await isAdmin()) return new Response('Unauthorized', { status: 401 })
  return Response.json({ affiliates: await listAffiliates() })
}

// POST /api/admin/affiliates — create an affiliate + its backing referral code.
export async function POST(req: Request) {
  if (!await isAdmin()) return new Response('Unauthorized', { status: 401 })

  const body = await req.json().catch(() => ({})) as {
    code?: string
    name?: string
    contact?: string | null
    commissionPct?: number
    commissionMonths?: number | null
    perkDays?: number
  }

  const result = await createAffiliate({
    code: body.code ?? '',
    name: body.name ?? '',
    contact: body.contact ?? null,
    commissionPct: body.commissionPct == null ? undefined : Number(body.commissionPct),
    commissionMonths: body.commissionMonths == null ? null : Number(body.commissionMonths),
    perkDays: body.perkDays == null ? undefined : Number(body.perkDays),
  })
  if (!result.ok) return Response.json({ error: result.error }, { status: 400 })
  await logAdmin('affiliate.create', result.affiliate.code, {
    name: result.affiliate.name,
    commissionPct: result.affiliate.commissionPct,
    commissionMonths: result.affiliate.commissionMonths,
    perkDays: result.affiliate.perkDays,
  })
  return Response.json({ affiliate: result.affiliate })
}
