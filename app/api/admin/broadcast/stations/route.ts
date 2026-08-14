// Admin CRUD for the broadcast stations behind /admin/lightning-bug/radio.
//   GET                         → all stations (incl. disabled), ordered
//   PUT    { station: StationRow } → create or overwrite one station
//   PATCH  { slug, enabled }    → toggle enabled without a full save
//   DELETE ?slug=<slug>         → remove a station
import { isAdmin } from '@/lib/admin-auth'
import { listStationRows, upsertStation, setStationEnabled, deleteStation, type StationRow } from '@/lib/broadcast-stations'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  if (!await isAdmin()) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  return Response.json({ stations: await listStationRows() })
}

export async function PUT(req: Request) {
  if (!await isAdmin()) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const { station } = await req.json() as { station: StationRow }
    if (!station?.slug) return Response.json({ error: 'Missing slug' }, { status: 400 })
    await upsertStation(station)
    return Response.json({ ok: true, stations: await listStationRows() })
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 400 })
  }
}

export async function PATCH(req: Request) {
  if (!await isAdmin()) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { slug, enabled } = await req.json() as { slug: string; enabled: boolean }
  if (!slug) return Response.json({ error: 'Missing slug' }, { status: 400 })
  await setStationEnabled(slug, !!enabled)
  return Response.json({ ok: true })
}

export async function DELETE(req: Request) {
  if (!await isAdmin()) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const slug = new URL(req.url).searchParams.get('slug')
  if (!slug) return Response.json({ error: 'Missing slug' }, { status: 400 })
  await deleteStation(slug)
  return Response.json({ ok: true })
}
