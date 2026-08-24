import { testUserId } from '@/lib/api-user'
import { auth, currentUser } from '@clerk/nextjs/server'
import { sql } from '@/lib/db'
import { deleteObjects } from '@/lib/r2'
import { getSubscription, getPlanLimits } from '@/lib/subscription'
import type { CfProjFile, SerializedMedia } from '@/lib/project-serializer'
import { slugify } from '@/lib/slugify'
import { ensureSharingSchema } from '@/lib/project-access'
import { ensureSchema } from '@/lib/schema-version'
import { slimPatch } from '@/lib/apollo/patch-diff'

// Schema for the projects table. Gated by a version stamp rather than a
// per-process flag: this route is on the cloud-project path, so the three
// ALTERs below were running on every cold start just to list somebody's songs.
async function ensureSlugColumns() {
  await ensureSchema('projects.columns', 1, async () => {
    await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS slug TEXT`
    await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS owner_username TEXT`
    await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS folder_id TEXT`
  })
}

// Apollo patches serialise to ~9.4KB each even for a plain sine, almost all of
// it default values — seven tracks was 67KB of a 128KB project. Stored as a
// diff from Init they are ~0.6KB. The editor expands them again on load
// (migrateProject), and a patch that is already complete round-trips unchanged,
// so projects saved before this keep working.
function slimApolloPatches(p: CfProjFile): CfProjFile {
  const dp = p.dawProject
  if (!dp?.tracks?.length) return p
  return {
    ...p,
    dawProject: {
      ...dp,
      tracks: dp.tracks.map(t => t.instrument?.type === 'apollo'
        ? { ...t, instrument: { ...t.instrument, params: slimPatch(t.instrument.params as never) as never } }
        : t),
    },
  }
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
      AND deleted_at < NOW() - INTERVAL '30 days'
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

  await ensureSlugColumns()   // so the list can hand back slug + owner_username for direct canonical links
  purgeExpiredTrash(userId).catch(() => {})

  // Only pull lightweight fields for the list. Counting clips/media via
  // jsonb_array_length (an int) instead of shipping the full arrays keeps the
  // response tiny — pulling the whole clips/media JSON for every project could
  // blow past the serverless driver's response-size/timeout limits on accounts
  // with large projects and 500 the entire list. Thumbnail is capped for the
  // same reason (an oversized data-URI thumbnail would bloat the list).
  const cols = (starred: boolean) => sql`
    SELECT
      id, name, saved_at, slug, owner_username, folder_id, ${starred ? sql`starred,` : sql`FALSE AS starred,`}
      CASE WHEN jsonb_typeof(data->'clips') = 'array' THEN jsonb_array_length(data->'clips') ELSE 0 END AS clip_count,
      CASE WHEN jsonb_typeof(data->'media') = 'array' THEN jsonb_array_length(data->'media') ELSE 0 END AS media_count,
      CASE WHEN length(data->'media'->0->>'thumbnail') <= 262144 THEN data->'media'->0->>'thumbnail' ELSE NULL END AS thumbnail,
      data->'modules' AS modules
    FROM projects
    WHERE user_id = ${userId} AND deleted_at IS NULL
    ORDER BY ${starred ? sql`starred DESC,` : sql``} saved_at DESC
  `

  // Projects shared WITH this user (they're a member but not the owner) — so a
  // shared project is reachable from the app on every platform, not only via
  // the raw link. Match by bound user_id OR the invite email.
  const email = (await currentUser())?.primaryEmailAddress?.emailAddress?.toLowerCase() ?? null
  async function sharedRows() {
    await ensureSharingSchema()
    return sql`
      SELECT
        p.id, p.name, p.saved_at, p.slug, p.owner_username, m.role,
        CASE WHEN jsonb_typeof(p.data->'clips') = 'array' THEN jsonb_array_length(p.data->'clips') ELSE 0 END AS clip_count,
        CASE WHEN jsonb_typeof(p.data->'media') = 'array' THEN jsonb_array_length(p.data->'media') ELSE 0 END AS media_count,
        CASE WHEN length(p.data->'media'->0->>'thumbnail') <= 262144 THEN p.data->'media'->0->>'thumbnail' ELSE NULL END AS thumbnail,
        p.data->'modules' AS modules
      FROM projects p
      JOIN project_members m ON m.project_id = p.id
      WHERE p.deleted_at IS NULL AND p.user_id <> ${userId}
        AND ( m.user_id = ${userId} OR (${email}::text IS NOT NULL AND LOWER(m.email) = ${email}) )
      ORDER BY p.saved_at DESC`
  }

  try {
    let rows
    try {
      rows = await cols(true)  // starred column present
    } catch {
      rows = await cols(false) // pre-migration: no starred column
    }
    let shared: Awaited<ReturnType<typeof sharedRows>> = []
    try { shared = await sharedRows() } catch { /* sharing schema not ready — skip */ }

    const owned = rows.map(r => ({
      id: r.id, name: r.name, savedAt: r.saved_at, starred: r.starred ?? false,
      slug: (r.slug as string) ?? null, username: (r.owner_username as string) ?? null,
      clips: Number(r.clip_count) || 0, media: Number(r.media_count) || 0,
      thumbnail: r.thumbnail ?? null, modules: Array.isArray(r.modules) ? r.modules : null,
      folderId: (r.folder_id as string) ?? null,
      shared: false as const, role: null, owner: null,
    }))
    const sharedList = shared.map(r => ({
      id: r.id, name: r.name, savedAt: r.saved_at, starred: false,
      slug: (r.slug as string) ?? null, username: (r.owner_username as string) ?? null,
      clips: Number(r.clip_count) || 0, media: Number(r.media_count) || 0,
      thumbnail: r.thumbnail ?? null, modules: Array.isArray(r.modules) ? r.modules : null,
      folderId: null,   // folders are the owner's; shared projects are never filed
      shared: true as const, role: (r.role as string) ?? 'view', owner: (r.owner_username as string) ?? null,
    }))
    return Response.json([...owned, ...sharedList])
  } catch (err) {
    console.error('[GET /api/projects] query failed for user', userId, err)
    return Response.json({ error: 'Failed to load projects' }, { status: 500 })
  }
}

// POST /api/projects — upsert a project for the current user
export async function POST(req: Request) {
  const { userId: clerkUserId } = await auth()
  // DEV_OPEN test collaborators (mirrors the project GET route) — dev builds only
  const testUser = testUserId(req)
  const userId = clerkUserId ?? testUser
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

  const project: CfProjFile = slimApolloPatches({ ...body, userId })
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
          owner_username = COALESCE(projects.owner_username, EXCLUDED.owner_username),
          -- Re-importing/saving a project restores it: a matching id that was
          -- soft-deleted (same name deleted earlier) must reappear, not stay hidden.
          deleted_at     = NULL
  `

  // Return the actual stored slug (may differ from generated if project already had one)
  const stored = await sql`SELECT slug, owner_username FROM projects WHERE id = ${project.id}`
  const storedSlug = (stored[0]?.slug ?? slug) as string
  const storedUsername = (stored[0]?.owner_username ?? ownerUsername) as string

  return Response.json({ ok: true, id: project.id, savedAt, slug: storedSlug, username: storedUsername })
}
