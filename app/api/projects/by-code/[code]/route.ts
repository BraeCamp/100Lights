import { sql } from '@/lib/db'

// Resolve a project's short code (the stable id prefix used in /@user/slug-code
// URLs) to its full id. This lives in a ROUTE HANDLER on purpose: the equivalent
// query inside the /@user/slug PAGE (server component) was silently failing in
// production and rendering notFound(), while route-handler DB queries (e.g. the
// projects list) work fine. Returns just the id — not sensitive (it's the same
// id that appears in /projects/{id} URLs); the actual project + access are still
// gated by /api/projects/[id] when the editor loads it.
export async function GET(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const clean = (code || '').toLowerCase().replace(/[^a-z0-9-]/g, '')
  if (clean.length < 4) return Response.json({ error: 'bad code' }, { status: 400 })
  try {
    const rows = await sql`
      SELECT id FROM projects
      WHERE id LIKE ${clean + '%'} AND deleted_at IS NULL
      ORDER BY saved_at DESC
      LIMIT 1
    ` as { id: string }[]
    if (!rows.length) return Response.json({ error: 'not found' }, { status: 404 })
    return Response.json({ id: rows[0].id })
  } catch (e) {
    return Response.json({ error: 'resolve failed', detail: String(e) }, { status: 500 })
  }
}
