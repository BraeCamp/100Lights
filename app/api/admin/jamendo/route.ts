// Admin: search Jamendo's catalogue via the API (so you can find + listen to tracks without
// leaving the site). GET ?q=<name search> or ?tags=<a+b+c> (+ optional order). isAdmin-gated.
import { isAdmin } from '@/lib/admin-auth'
import { jamendoSearch, jamendoById, jamendoConfigured, jamendoLicensed } from '@/lib/jamendo'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Extract a Jamendo track id from a pasted URL (…/track/<id>/…) or a bare id.
const trackId = (s: string) => (s.match(/track\/(\d+)/i)?.[1] ?? (/^\d+$/.test(s.trim()) ? s.trim() : ''))

export async function GET(req: Request) {
  if (!await isAdmin()) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!jamendoConfigured()) return Response.json({ error: 'not_configured', message: 'Set JAMENDO_CLIENT_ID' })
  const p = new URL(req.url).searchParams
  // ?id=<id or paste-link> → resolve a single track (manual add-by-link)
  const idParam = p.get('id')
  if (idParam) {
    const id = trackId(idParam)
    if (!id) return Response.json({ error: 'bad_link', message: 'Paste a Jamendo track link or id' })
    const track = await jamendoById(id, { commercialOnly: p.get('commercialOnly') === '1' })
    return track ? Response.json({ licensed: jamendoLicensed(), tracks: [track] }) : Response.json({ error: 'not_found', message: 'No track for that link (or it is NonCommercial)' })
  }
  const tracks = await jamendoSearch({
    name: p.get('q') || undefined,
    tags: p.get('tags') || undefined,
    order: p.get('order') || undefined,
    limit: p.get('limit') ? Number(p.get('limit')) : 60,
    commercialOnly: p.get('commercialOnly') === '1',   // exclude NonCommercial (CC BY-NC*) for monetized broadcast
  })
  return Response.json({ licensed: jamendoLicensed(), tracks })
}
