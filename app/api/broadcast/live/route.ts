// Public live-status of broadcast channels (for the Always-On Studio page). Only safe fields —
// title + whether it's live — never worker ids / keys / errors.
import { listRuntime } from '@/lib/broadcast-control'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const channels = (await listRuntime())
    .filter(r => r.enabled)
    .map(r => ({ slug: r.slug, title: r.title, live: r.status === 'live', status: r.status, wanted: r.desiredLive }))
  return Response.json({ channels })
}
