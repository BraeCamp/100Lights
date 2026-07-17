import { auth } from '@clerk/nextjs/server'
import { sql } from '@/lib/db'

export const runtime = 'nodejs'

// Named version checkpoints: full snapshots of the saved project file, so
// destructive experiments ("what if we cut the bridge?") are reversible.
// Owner-only — versions are a persistence feature, and saves already are.

const MAX_VERSIONS = 20

let versionsSchemaReady = false
async function ensureVersionsSchema() {
  if (versionsSchemaReady) return
  await sql`
    CREATE TABLE IF NOT EXISTS project_versions (
      id          TEXT PRIMARY KEY,
      project_id  TEXT NOT NULL,
      name        TEXT NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      data        JSONB NOT NULL
    )
  `
  await sql`CREATE INDEX IF NOT EXISTS project_versions_project_idx ON project_versions (project_id, created_at DESC)`
  versionsSchemaReady = true
}

function testUser(req: Request): string | null {
  return process.env.DEV_OPEN === '1' && process.env.NODE_ENV !== 'production'
    ? req.headers.get('x-test-user')
    : null
}

async function requireOwner(projectId: string, userId: string | null): Promise<boolean> {
  if (!userId) return false
  const rows = await sql`SELECT 1 FROM projects WHERE id = ${projectId} AND user_id = ${userId} AND deleted_at IS NULL`
  return rows.length > 0
}

// GET /api/projects/:id/versions — list (no data payloads)
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId: clerkId } = await auth()
  const userId = clerkId ?? testUser(req)
  const { id } = await params
  await ensureVersionsSchema()
  if (!await requireOwner(id, userId)) return Response.json({ error: 'Not found' }, { status: 404 })

  const rows = await sql`
    SELECT id, name, created_at FROM project_versions
    WHERE project_id = ${id} ORDER BY created_at DESC
  `
  return Response.json({ versions: rows.map(r => ({ id: r.id, name: r.name, createdAt: r.created_at })) })
}

// POST /api/projects/:id/versions — { name } snapshots the current SAVED data
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId: clerkId } = await auth()
  const userId = clerkId ?? testUser(req)
  const { id } = await params
  await ensureVersionsSchema()
  if (!await requireOwner(id, userId)) return Response.json({ error: 'Not found' }, { status: 404 })

  let body: { name?: string }
  try { body = await req.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const name = (body.name ?? '').trim().slice(0, 60)
  if (!name) return Response.json({ error: 'Version name required' }, { status: 400 })

  const proj = await sql`SELECT data FROM projects WHERE id = ${id}`
  if (!proj.length) return Response.json({ error: 'Not found' }, { status: 404 })

  const vid = crypto.randomUUID()
  await sql`INSERT INTO project_versions (id, project_id, name, data) VALUES (${vid}, ${id}, ${name}, ${JSON.stringify(proj[0].data)}::jsonb)`

  // Keep the newest MAX_VERSIONS
  await sql`
    DELETE FROM project_versions WHERE project_id = ${id} AND id NOT IN (
      SELECT id FROM project_versions WHERE project_id = ${id} ORDER BY created_at DESC LIMIT ${MAX_VERSIONS}
    )
  `
  return Response.json({ id: vid, name })
}
