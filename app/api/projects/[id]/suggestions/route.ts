import { auth, currentUser } from '@clerk/nextjs/server'
import { sql } from '@/lib/db'
import { ensureSharingSchema, getProjectAccess } from '@/lib/project-access'

export const runtime = 'nodejs'

// "Suggest changes": a collaborator proposes a full-project edit the owner can
// accept (which replaces the project) or reject. Access is decided by
// getProjectAccess — owners manage, collaborators submit.

async function whoami(projectId: string) {
  const { userId } = await auth()
  const user = await currentUser()
  const email = user?.emailAddresses?.[0]?.emailAddress ?? null
  const name = user?.firstName || user?.username || email?.split('@')[0] || 'A collaborator'
  const { access } = await getProjectAccess(projectId, userId, email)
  return { userId, name, access }
}

// POST — a collaborator submits a suggestion { data (CfProjFile), note }
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await ensureSharingSchema()
  const { userId, name, access } = await whoami(id)
  if (!userId || access === null) return Response.json({ error: 'No access to this project' }, { status: 403 })
  if (access === 'owner') return Response.json({ error: 'Owners edit the project directly' }, { status: 400 })

  let body: { data?: unknown; note?: string }
  try { body = await req.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }
  if (!body?.data) return Response.json({ error: 'Missing suggestion data' }, { status: 400 })
  const json = JSON.stringify(body.data)
  if (json.length > 4_000_000) return Response.json({ error: 'Suggestion is too large to submit' }, { status: 413 })
  const note = (body.note ?? '').toString().slice(0, 500)

  const [row] = await sql`
    INSERT INTO project_suggestions (project_id, author_id, author_name, note, data)
    VALUES (${id}, ${userId}, ${name}, ${note}, ${json}::jsonb)
    RETURNING id`
  return Response.json({ ok: true, id: row.id })
}

// GET — owner/co-owner lists pending suggestions (with their data for preview)
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await ensureSharingSchema()
  const { access } = await whoami(id)
  if (access !== 'owner') return Response.json({ error: 'Not found' }, { status: 404 })
  const rows = await sql`
    SELECT id, author_name, note, data, created_at
    FROM project_suggestions WHERE project_id = ${id} AND status = 'pending'
    ORDER BY created_at DESC`
  return Response.json({
    suggestions: rows.map(r => ({ id: r.id, authorName: r.author_name, note: r.note, data: r.data, createdAt: r.created_at })),
  })
}

// PATCH — owner resolves a suggestion { id, status: 'accepted' | 'rejected' }
// Accepting just marks it; the owner's client applies the data via the normal
// save so all the existing persistence/validation runs.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await ensureSharingSchema()
  const { access } = await whoami(id)
  if (access !== 'owner') return Response.json({ error: 'Not found' }, { status: 404 })
  let body: { id?: string; status?: string }
  try { body = await req.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const status = body.status === 'accepted' ? 'accepted' : body.status === 'rejected' ? 'rejected' : null
  if (!body.id || !status) return Response.json({ error: 'Bad request' }, { status: 400 })
  await sql`UPDATE project_suggestions SET status = ${status} WHERE id = ${body.id} AND project_id = ${id}`
  return Response.json({ ok: true })
}
