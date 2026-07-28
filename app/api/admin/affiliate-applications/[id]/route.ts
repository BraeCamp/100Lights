import { isAdmin } from '@/lib/admin-auth'
import { approveApplication, declineApplication } from '@/lib/affiliates'
import { logAdmin } from '@/lib/admin-audit'

export const runtime = 'nodejs'

// PATCH /api/admin/affiliate-applications/:id — { action: 'approve'|'decline', code? }
// Approve mints the affiliate + code on the beta terms; decline just archives it.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!await isAdmin()) return new Response('Unauthorized', { status: 401 })
  const { id } = await params
  const body = await req.json().catch(() => ({})) as { action?: string; code?: string }

  if (body.action === 'approve') {
    const result = await approveApplication(id, body.code)
    if (!result.ok) return Response.json({ error: result.error }, { status: 400 })
    await logAdmin('affiliate.approve', result.affiliate.code, { applicationId: id, emailed: result.emailed })
    return Response.json({ affiliate: result.affiliate, emailed: result.emailed })
  }
  if (body.action === 'decline') {
    await declineApplication(id)
    await logAdmin('affiliate.decline', id, {})
    return Response.json({ ok: true })
  }
  return Response.json({ error: 'Unknown action.' }, { status: 400 })
}
