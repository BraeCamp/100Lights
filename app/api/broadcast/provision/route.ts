// Fleet reconcile — ensure enough worker machines exist for the currently-live channels. Meant to be
// hit on a schedule (Vercel Cron, every minute) AND right after a start/stop. Gated by admin OR the
// agent token (so a cron can call it headlessly). In 'manual' mode it's a harmless no-op report.
import { isAdmin } from '@/lib/admin-auth'
import { reconcileFleet } from '@/lib/broadcast-provision'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function authed(req: Request) {
  if (await isAdmin()) return true
  const auth = req.headers.get('authorization') || ''
  if (process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`) return true   // Vercel Cron
  const t = process.env.BROADCAST_AGENT_TOKEN
  return !!t && req.headers.get('x-agent-token') === t
}

export async function POST(req: Request) {
  if (!await authed(req)) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  try { return Response.json(await reconcileFleet()) }
  catch (e) { return Response.json({ error: String(e) }, { status: 500 }) }
}

// GET = same, convenient for a cron that only does GET.
export async function GET(req: Request) {
  if (!await authed(req)) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  try { return Response.json(await reconcileFleet()) }
  catch (e) { return Response.json({ error: String(e) }, { status: 500 }) }
}
