import { isAdmin } from '@/lib/admin-auth'
import { listDmcaNotices, setDmcaStatus } from '@/lib/dmca'
import { logAdmin } from '@/lib/admin-audit'

export const runtime = 'nodejs'

// GET /api/admin/dmca — copyright takedown notices, open first.
export async function GET() {
  if (!await isAdmin()) return new Response('Unauthorized', { status: 401 })
  return Response.json({ notices: await listDmcaNotices() })
}

// PATCH /api/admin/dmca — { id, status: 'open'|'resolved' }
export async function PATCH(req: Request) {
  if (!await isAdmin()) return new Response('Unauthorized', { status: 401 })
  const body = await req.json().catch(() => ({})) as { id?: string; status?: string }
  if (!body.id) return Response.json({ error: 'id required' }, { status: 400 })
  const status = body.status === 'resolved' ? 'resolved' : 'open'
  await setDmcaStatus(body.id, status)
  await logAdmin('dmca.status', body.id, { status })
  return Response.json({ ok: true })
}
