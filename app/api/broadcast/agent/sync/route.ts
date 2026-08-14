// Worker-agent endpoint (the broadcast-streamer boxes call this). One POST = heartbeat + status
// report + assignment fetch. Gated by a shared secret (BROADCAST_AGENT_TOKEN) — NOT admin auth, since
// agents are headless. Body: { workerId, capacity, reports:[{slug,status,fps,error}] }.
import { agentSync, type AgentReport } from '@/lib/broadcast-control'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const token = process.env.BROADCAST_AGENT_TOKEN
  const given = req.headers.get('x-agent-token') || ''
  if (!token || given !== token) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const { workerId, capacity, reports } = await req.json() as { workerId?: string; capacity?: number; reports?: AgentReport[] }
    if (!workerId) return Response.json({ error: 'workerId required' }, { status: 400 })
    const out = await agentSync(workerId, Math.max(0, Number(capacity ?? 1)), Array.isArray(reports) ? reports : [])
    return Response.json(out)
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 400 })
  }
}
