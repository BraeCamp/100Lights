import { isAdmin } from '@/lib/admin-auth'
import { getWebhook } from '@/lib/webhook-log'

export const runtime = 'nodejs'

// GET /api/admin/webhooks/[id] — the full stored payload for inspection.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!await isAdmin()) return Response.json({ error: 'Not signed in as admin' }, { status: 401 })
  const { id } = await params
  const n = Number(id)
  if (!Number.isFinite(n)) return Response.json({ error: 'bad id' }, { status: 400 })
  const row = await getWebhook(n)
  if (!row) return Response.json({ error: 'not found' }, { status: 404 })
  return Response.json({ event: row })
}
