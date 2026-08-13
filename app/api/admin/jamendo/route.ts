// Admin: search Jamendo's catalogue via the API (so you can find + listen to tracks without
// leaving the site). GET ?q=<name search> or ?tags=<a+b+c> (+ optional order). isAdmin-gated.
import { isAdmin } from '@/lib/admin-auth'
import { jamendoSearch, jamendoConfigured, jamendoLicensed } from '@/lib/jamendo'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  if (!await isAdmin()) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!jamendoConfigured()) return Response.json({ error: 'not_configured', message: 'Set JAMENDO_CLIENT_ID' })
  const p = new URL(req.url).searchParams
  const tracks = await jamendoSearch({
    name: p.get('q') || undefined,
    tags: p.get('tags') || undefined,
    order: p.get('order') || undefined,
    limit: p.get('limit') ? Number(p.get('limit')) : 60,
  })
  return Response.json({ licensed: jamendoLicensed(), tracks })
}
