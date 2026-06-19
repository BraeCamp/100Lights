import { auth, currentUser } from '@clerk/nextjs/server'
import { sql } from '@/lib/db'
import { deleteObjects } from '@/lib/r2'
import { getSubscription, getPlanLimits } from '@/lib/subscription'
import type { CfProjFile, SerializedMedia } from '@/lib/project-serializer'
import { slugify } from '@/lib/slugify'

// Add slug + owner_username columns on first cold start (idempotent)
let columnsReady = false
async function ensureSlugColumns() {
  if (columnsReady) return
  try {
    await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS slug TEXT`
    await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS owner_username TEXT`
  } catch { /* ignore */ }
  columnsReady = true
}

async function uniqueSlug(userId: string, name: string, excludeId?: string): Promise<string> {
  const base = slugify(name)
  const rows = await sql`
    SELECT slug FROM projects
    WHERE user_id = ${userId} AND slug LIKE ${base + '%'} AND deleted_at IS NULL
    ${excludeId ? sql`AND id != ${excludeId}` : sql``}
  `
  const taken = new Set(rows.map(r => r.slug as string))
  if (!taken.has(base)) return base
  let i = 2
  while (taken.has(`${base}-${i}`)) i++
  return `${base}-${i}`
}

async function purgeExpiredTrash(userId: string) {
  const expired = await sql`
    SELECT id, data FROM projects
    WHERE user_id = ${userId}
      AND deleted_at IS NOT NULL
      AND deleted_at < NOW() - INTERVAL '7 days'
  `
  if (expired.length === 0) return
  const keys = expired.flatMap(r =>
    ((r.data as CfProjFile).media as SerializedMedia[]).map(m => m.r2Key).filter(Boolean)
  ) as string[]
  const ids = expired.map(r => r.id as string)
  await Promise.all([
    deleteObjects(keys),
    sql`DELETE FROM projects WHERE id = ANY(${ids}::text[]) AND user_id = ${userId}`,
  ])
}

// GET /api/projects — list the current user's active projects
export async function GET() {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  purgeExpiredTrash(userId).catch(() => {})

  // starred column is added via migration — see Neon console
  // Gracefully fall back if column doesn't exist yet
  let rows
  try {
    rows = await sql`
      SELECT
        id, name, saved_at, starred,
        data->'clips'            AS clips,
        data->'media'            AS media,
        data->'media'->0->>'thumbnail' AS thumbnail
      FROM projects
      WHERE user_id = ${userId} AND deleted_at IS NULL
      ORDER BY starred DESC, saved_at DESC
    `
  } catch {
    rows = await sql`
      SELECT
        id, name, saved_at,
        data->'clips'            AS clips,
        data->'media'            AS media,
        data->'media'->0->>'thumbnail' AS thumbnail
      FROM projects
      WHERE user_id = ${userId} AND deleted_at IS NULL
      ORDER BY saved_at DESC
    `
  }

  return Response.json(rows.map(r => ({
    id:        r.id,
    name:      r.name,
    savedAt:   r.saved_at,
    starred:   r.starred ?? false,
    clips:     Array.isArray(r.clips) ? r.clips.length : 0,
    media:     Array.isArray(r.media) ? r.media.length : 0,
    thumbnail: r.thumbnail ?? null,
  })))
}

// POST /api/projects — upsert a project for the current user
export async function POST(req: Request) {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  let body: CfProjFile
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (body._type !== '100lights-project' || !body.id || !body.name) {
    return Response.json({ error: 'Not a valid 100Lights project file' }, { status: 400 })
  }

  // Check project limit only for brand-new projects (not re-saves of existing ones)
  const isNew = await sql`SELECT 1 FROM projects WHERE id = ${body.id} AND user_id = ${userId} LIMIT 1`
  if (isNew.length === 0) {
    const [sub, countRows] = await Promise.all([
      getSubscription(userId),
      sql`SELECT COUNT(*)::int AS cnt FROM projects WHERE user_id = ${userId} AND deleted_at IS NULL`,
    ])
    const limits = getPlanLimits(sub.plan)
    if (Number(countRows[0].cnt) >= limits.projectsMax) {
      return Response.json({ error: 'Project limit reached. Upgrade to Pro for unlimited projects.', upgrade: true }, { status: 403 })
    }
  }

  await ensureSlugColumns()

  const project: CfProjFile = { ...body, userId }
  const savedAt = new Date().toISOString()

  // Generate slug (only used if the project doesn't have one yet)
  const slug = await uniqueSlug(userId, project.name, project.id)
  const user = await currentUser()
  const ownerUsername = user?.username ?? user?.emailAddresses[0]?.emailAddress.split('@')[0] ?? userId

  await sql`
    INSERT INTO projects (id, user_id, name, slug, owner_username, saved_at, data)
    VALUES (${project.id}, ${userId}, ${project.name}, ${slug}, ${ownerUsername}, ${savedAt}, ${JSON.stringify(project) as unknown as object})
    ON CONFLICT (id) DO UPDATE
      SET name           = EXCLUDED.name,
          saved_at       = EXCLUDED.saved_at,
          data           = EXCLUDED.data,
          slug           = COALESCE(projects.slug, EXCLUDED.slug),
          owner_username = COALESCE(projects.owner_username, EXCLUDED.owner_username)
  `

  // Return the actual stored slug (may differ from generated if project already had one)
  const stored = await sql`SELECT slug, owner_username FROM projects WHERE id = ${project.id}`
  const storedSlug = (stored[0]?.slug ?? slug) as string
  const storedUsername = (stored[0]?.owner_username ?? ownerUsername) as string

  return Response.json({ ok: true, id: project.id, savedAt, slug: storedSlug, username: storedUsername })
}
