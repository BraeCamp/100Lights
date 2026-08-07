import { auth } from '@clerk/nextjs/server'
import { sql } from '@/lib/db'

// Cloud folders for organizing projects. One flat level (name only); a project's
// folder is the `folder_id` column on `projects` (see /api/projects). Per-user.

let ready = false
async function ensureFolders() {
  if (ready) return
  await sql`
    CREATE TABLE IF NOT EXISTS folders (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`
  await sql`CREATE INDEX IF NOT EXISTS folders_user_idx ON folders (user_id)`
  ready = true
}

export async function GET() {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    await ensureFolders()
    const rows = await sql`SELECT id, name FROM folders WHERE user_id = ${userId} ORDER BY LOWER(name)` as { id: string; name: string }[]
    return Response.json(rows)
  } catch {
    return Response.json([])   // table not provisioned yet → no folders
  }
}

export async function POST(req: Request) {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({})) as { name?: string }
  const name = (body.name ?? '').trim().slice(0, 60)
  if (!name) return Response.json({ error: 'Folder name required' }, { status: 400 })
  await ensureFolders()
  // Cap folders per user to keep the sidebar sane.
  const count = await sql`SELECT COUNT(*)::int AS n FROM folders WHERE user_id = ${userId}` as { n: number }[]
  if ((count[0]?.n ?? 0) >= 100) return Response.json({ error: 'Folder limit reached' }, { status: 403 })
  const id = crypto.randomUUID()
  await sql`INSERT INTO folders (id, user_id, name) VALUES (${id}, ${userId}, ${name})`
  return Response.json({ id, name })
}

export async function PATCH(req: Request) {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({})) as { id?: string; name?: string }
  const name = (body.name ?? '').trim().slice(0, 60)
  if (!body.id || !name) return Response.json({ error: 'id and name required' }, { status: 400 })
  await ensureFolders()
  await sql`UPDATE folders SET name = ${name} WHERE id = ${body.id} AND user_id = ${userId}`
  return Response.json({ ok: true })
}

export async function DELETE(req: Request) {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return Response.json({ error: 'id required' }, { status: 400 })
  await ensureFolders()
  // Unfile the folder's projects (don't delete them), then drop the folder.
  await sql`UPDATE projects SET folder_id = NULL WHERE folder_id = ${id} AND user_id = ${userId}`
  await sql`DELETE FROM folders WHERE id = ${id} AND user_id = ${userId}`
  return Response.json({ ok: true })
}
