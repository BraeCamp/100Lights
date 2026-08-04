import { auth } from '@clerk/nextjs/server'
import { sql } from '@/lib/db'
import { isAdminEmail } from '@/lib/admin-auth'
import { getProjectAdmin, saveProjectAdmin, type ProjectAdmin } from '@/lib/project-admin'

export const runtime = 'nodejs'

const str = (v: unknown, max = 200): string | undefined => (typeof v === 'string' && v.trim() ? v.slice(0, max) : undefined)

// PUT /api/lab/[id] — save the project-admin overlay (split overrides + metadata).
// Gate: admin (the lab is admin-only) or DEV_OPEN or the project's owner.
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { userId } = await auth()
  let allowed = process.env.DEV_OPEN === '1' || (await isAdminEmail())
  if (!allowed && userId) {
    try {
      const rows = await sql`SELECT 1 FROM projects WHERE id = ${id} AND user_id = ${userId} AND deleted_at IS NULL`
      allowed = rows.length > 0
    } catch { /* deny */ }
  }
  if (!allowed) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  let body: ProjectAdmin
  try { body = await req.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const clean: ProjectAdmin = {}
  if (body.splitOverrides && typeof body.splitOverrides === 'object') {
    clean.splitOverrides = Object.fromEntries(
      Object.entries(body.splitOverrides).slice(0, 50).map(([k, v]) => [String(k).slice(0, 120), Math.max(0, Math.min(100, Number(v) || 0))]),
    )
  }
  if (body.metadata && typeof body.metadata === 'object') {
    clean.metadata = {
      genre: str(body.metadata.genre), mood: str(body.metadata.mood), isrc: str(body.metadata.isrc, 24),
      upc: str(body.metadata.upc, 24), releaseDate: str(body.metadata.releaseDate, 24), notes: str(body.metadata.notes, 2000),
    }
  }

  // Merge over the existing overlay so other fields (clearances/release) survive.
  const existing = await getProjectAdmin(id)
  await saveProjectAdmin(id, { ...existing, ...clean })
  return Response.json({ ok: true })
}
