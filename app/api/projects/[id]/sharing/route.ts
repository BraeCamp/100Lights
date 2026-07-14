import { auth } from '@clerk/nextjs/server'
import { sql } from '@/lib/db'
import { ensureSharingSchema } from '@/lib/project-access'

export const runtime = 'nodejs'

async function requireOwner(projectId: string, userId: string | null): Promise<boolean> {
  if (!userId) return false
  const rows = await sql`SELECT 1 FROM projects WHERE id = ${projectId} AND user_id = ${userId} AND deleted_at IS NULL`
  return rows.length > 0
}

// GET /api/projects/:id/sharing — owner reads visibility + member list
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth()
  const { id } = await params
  await ensureSharingSchema()
  if (!await requireOwner(id, userId)) return Response.json({ error: 'Not found' }, { status: 404 })

  const proj = await sql`SELECT visibility FROM projects WHERE id = ${id}`
  const members = await sql`SELECT email, added_at FROM project_members WHERE project_id = ${id} ORDER BY added_at`
  return Response.json({
    visibility: (proj[0]?.visibility as string) ?? 'private',
    members: members.map(m => ({ email: m.email, addedAt: m.added_at })),
  })
}

// PATCH /api/projects/:id/sharing — { visibility } | { addEmail } | { removeEmail }
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth()
  const { id } = await params
  await ensureSharingSchema()
  if (!await requireOwner(id, userId)) return Response.json({ error: 'Not found' }, { status: 404 })

  let body: { visibility?: string; addEmail?: string; removeEmail?: string }
  try { body = await req.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }

  if (body.visibility !== undefined) {
    if (body.visibility !== 'private' && body.visibility !== 'public') {
      return Response.json({ error: 'visibility must be private or public' }, { status: 400 })
    }
    await sql`UPDATE projects SET visibility = ${body.visibility} WHERE id = ${id}`
  }
  if (body.addEmail) {
    const email = body.addEmail.trim().toLowerCase()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return Response.json({ error: 'Invalid email' }, { status: 400 })
    const count = await sql`SELECT COUNT(*)::int AS n FROM project_members WHERE project_id = ${id}`
    if ((count[0]?.n ?? 0) >= 50) return Response.json({ error: 'Member limit reached (50)' }, { status: 400 })
    await sql`INSERT INTO project_members (project_id, email) VALUES (${id}, ${email}) ON CONFLICT DO NOTHING`
  }
  if (body.removeEmail) {
    await sql`DELETE FROM project_members WHERE project_id = ${id} AND LOWER(email) = ${body.removeEmail.trim().toLowerCase()}`
  }

  const proj = await sql`SELECT visibility FROM projects WHERE id = ${id}`
  const members = await sql`SELECT email, added_at FROM project_members WHERE project_id = ${id} ORDER BY added_at`
  return Response.json({
    visibility: (proj[0]?.visibility as string) ?? 'private',
    members: members.map(m => ({ email: m.email, addedAt: m.added_at })),
  })
}
