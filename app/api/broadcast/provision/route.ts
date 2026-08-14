// Fleet reconcile — ensure enough worker machines exist for the currently-live channels. Fired right
// after a start/stop (see the dashboard route). For scheduled self-healing, hit this from an EXTERNAL
// cron (Vercel Hobby only allows daily crons; a per-minute Vercel cron fails the deploy). Gated by
// admin OR the agent token OR CRON_SECRET. In 'manual' mode it's a harmless no-op report.
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
