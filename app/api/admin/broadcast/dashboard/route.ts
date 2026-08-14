// Admin: broadcast dashboard data (runtime status per broadcast + connected worker agents) and the
// desired-state control (start/stop a broadcast). Read by the Broadcasts tab, polled a few times/min.
import { isAdmin } from '@/lib/admin-auth'
import { listRuntime, listAgents, setDesiredLive } from '@/lib/broadcast-control'
import { reconcileFleet } from '@/lib/broadcast-provision'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  if (!await isAdmin()) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const [runtime, agents] = await Promise.all([listRuntime(), listAgents()])
  return Response.json({ runtime, agents, agentConfigured: !!process.env.BROADCAST_AGENT_TOKEN })
}

// { slug, live } → set desired-live. Agents reconcile to it within a few seconds.
export async function POST(req: Request) {
  if (!await isAdmin()) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { slug, live } = await req.json() as { slug?: string; live?: boolean }
  if (!slug) return Response.json({ error: 'slug required' }, { status: 400 })
  await setDesiredLive(slug, !!live)
  // Scale the fleet to match the new demand (no-op in manual mode). Fire-and-forget so the UI is snappy.
  reconcileFleet().catch(() => {})
  return Response.json({ ok: true, runtime: await listRuntime() })
}
