import { isAdmin } from '@/lib/admin-auth'
import { listCodes, createCode, type CodeKind } from '@/lib/codes'

export const runtime = 'nodejs'

// GET /api/admin/codes — list every redemption code, newest first.
export async function GET() {
  if (!await isAdmin()) return new Response('Unauthorized', { status: 401 })
  return Response.json({ codes: await listCodes() })
}

// POST /api/admin/codes — create a code.
export async function POST(req: Request) {
  if (!await isAdmin()) return new Response('Unauthorized', { status: 401 })

  const body = await req.json().catch(() => ({})) as {
    code?: string
    kind?: string
    grantDays?: number
    expiresAt?: string | null
    maxRedemptions?: number | null
    note?: string | null
  }

  const kind: CodeKind = body.kind === 'starter' ? 'starter' : 'promo'
  const result = await createCode({
    code: body.code ?? null,
    kind,
    grantDays: Number(body.grantDays),
    expiresAt: body.expiresAt ?? null,
    maxRedemptions: body.maxRedemptions ?? null,
    note: body.note ?? null,
  })
  if (!result.ok) return Response.json({ error: result.error }, { status: 400 })
  return Response.json({ code: result.code })
}
