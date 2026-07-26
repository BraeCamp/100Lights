import { isAdmin } from '@/lib/admin-auth'
import { listAudit } from '@/lib/admin-audit'

export const runtime = 'nodejs'

// Read-only feed of recorded admin actions for the Audit Log panel.
export async function GET(req: Request) {
  if (!await isAdmin()) return new Response('Unauthorized', { status: 401 })
  const limit = Number(new URL(req.url).searchParams.get('limit') ?? 200)
  const entries = await listAudit(Number.isFinite(limit) ? limit : 200)
  return Response.json({ entries })
}
