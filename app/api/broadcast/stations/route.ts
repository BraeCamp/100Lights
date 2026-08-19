// Public list of ENABLED broadcast stations for the launcher (/lightningbug/broadcast).
// Returns just what the cards need; the full scene + playlist come from /api/broadcast/playlist.
import { listEnabledStations } from '@/lib/broadcast-stations'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const stations = (await listEnabledStations()).map(s => ({ slug: s.slug, title: s.title, tagline: s.tagline }))
  return Response.json({ stations })
}
