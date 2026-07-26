import { isAdmin } from '@/lib/admin-auth'
import { listWebhooks, webhookStats } from '@/lib/webhook-log'

export const runtime = 'nodejs'

// GET /api/admin/webhooks — recent inbound webhooks with outcome + rolling
// stats, so a silently-failed Stripe event is one glance away.
export async function GET(req: Request) {
  if (!await isAdmin()) return Response.json({ error: 'Not signed in as admin' }, { status: 401 })
  const u = new URL(req.url)
  const [events, stats] = await Promise.all([
    listWebhooks({ source: u.searchParams.get('source') ?? undefined, status: u.searchParams.get('status') ?? undefined, limit: 150 }),
    webhookStats(),
  ])
  return Response.json({ events, stats })
}
