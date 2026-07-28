import { isAdmin } from '@/lib/admin-auth'
import { listLicenses, upsertLicense, deleteLicense } from '@/lib/content-licenses'
import { logAdmin } from '@/lib/admin-audit'

export const runtime = 'nodejs'

// GET /api/admin/licenses — the content-license registry.
export async function GET() {
  if (!await isAdmin()) return new Response('Unauthorized', { status: 401 })
  return Response.json({ licenses: await listLicenses() })
}

// POST /api/admin/licenses — create or edit an entry.
export async function POST(req: Request) {
  if (!await isAdmin()) return new Response('Unauthorized', { status: 401 })
  const b = await req.json().catch(() => ({})) as Record<string, string>
  const result = await upsertLicense({
    id: b.id, name: b.name, category: b.category, source: b.source, license: b.license, url: b.url, notes: b.notes,
  })
  if (!result.ok) return Response.json({ error: result.error }, { status: 400 })
  await logAdmin('license.upsert', result.id, { name: b.name })
  return Response.json({ ok: true, id: result.id })
}

// DELETE /api/admin/licenses?id=…
export async function DELETE(req: Request) {
  if (!await isAdmin()) return new Response('Unauthorized', { status: 401 })
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return Response.json({ error: 'id required' }, { status: 400 })
  await deleteLicense(id)
  await logAdmin('license.delete', id, {})
  return Response.json({ ok: true })
}
