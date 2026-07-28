import { saveAffiliateTaxByToken } from '@/lib/affiliates'

export const runtime = 'nodejs'

// POST /api/creators/tax/:token — an affiliate submits their W-9 / payee details.
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const b = await req.json().catch(() => ({})) as Record<string, string>
  const result = await saveAffiliateTaxByToken(token, {
    legalName: b.legalName, businessName: b.businessName, address: b.address,
    city: b.city, state: b.state, zip: b.zip, taxClass: b.taxClass, tin: b.tin,
  })
  if (!result.ok) return Response.json({ error: result.error }, { status: 400 })
  return Response.json({ ok: true })
}
