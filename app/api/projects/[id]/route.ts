import { testUserId } from '@/lib/api-user'
import { auth } from '@clerk/nextjs/server'
import { sql } from '@/lib/db'
import { deleteObjects } from '@/lib/r2'
import type { CfProjFile, SerializedMedia } from '@/lib/project-serializer'
import { slugify } from '@/lib/slugify'
import { ensureProjectColumns } from '@/lib/project-columns'

async function uniqueSlugExcluding(userId: string, name: string, excludeId: string): Promise<string> {
  const base = slugify(name)
  const rows = await sql`
    SELECT slug FROM projects
    WHERE user_id = ${userId} AND slug LIKE ${base + '%'} AND deleted_at IS NULL AND id != ${excludeId}
  `
  const taken = new Set(rows.map(r => r.slug as string))
  if (!taken.has(base)) return base
  let i = 2
  while (taken.has(`${base}-${i}`)) i++
  return `${base}-${i}`
}

// GET /api/projects/:id
// Returns the project's manually-saved data. If autosave_data exists and is
// newer, also returns it as _cloudAutosave so the client can offer recovery.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth()
  // DEV_OPEN test collaborators (mirrors /api/liveblocks-auth) — dev builds only
  const testUser = testUserId(req)
  if (!userId && !testUser) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  // Access model: owner always; otherwise the project must be public or the
  // user's email must be on the member list. Paid viewers get edit rights.
  // DEV_OPEN test users keep read access for the collab harness.
  const rows = await sql`
    SELECT user_id, data, autosave_data, slug, owner_username FROM projects WHERE id = ${id} AND deleted_at IS NULL
  `

  if (rows.length === 0) return Response.json({ error: 'Project not found' }, { status: 404 })

  const data = rows[0].data as CfProjFile
  // Surfaced so the editor can swap the address bar to the pretty /@user/slug URL.
  const urlMeta = { _slug: (rows[0].slug ?? null) as string | null, _username: (rows[0].owner_username ?? null) as string | null }

  let access: 'owner' | 'edit' | 'view' | null
  if (testUser && !userId) {
    access = 'edit'  // harness collaborators
  } else {
    const { getProjectAccess } = await import('@/lib/project-access')
    const user = userId ? await (await import('@clerk/nextjs/server')).currentUser() : null
    const r = await getProjectAccess(id, userId, user?.emailAddresses?.[0]?.emailAddress ?? null)
    access = r.access
  }
  if (!access) return Response.json({ error: 'Project not found' }, { status: 404 })

  const isOwner = access === 'owner'

  // Collaborators get the saved project but never the owner's autosave recovery
  if (!isOwner) return Response.json({ ...data, ...urlMeta, _isOwner: false, _access: access })

  const autosaveData = rows[0].autosave_data as CfProjFile | null

  // Attach cloud autosave only when it is strictly newer than the saved copy
  const savedAt = data?.savedAt ? new Date(data.savedAt).getTime() : 0
  const autosaveAt = autosaveData?.savedAt ? new Date(autosaveData.savedAt).getTime() : 0
  const cloudAutosave = autosaveData && autosaveAt > savedAt ? autosaveData : null

  return Response.json({ ...data, ...urlMeta, ...(cloudAutosave ? { _cloudAutosave: cloudAutosave } : {}) })
}

// PATCH /api/projects/:id — toggle starred OR rename
// Body: {} → toggle starred  |  { name: string } → rename
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await req.json().catch(() => ({})) as { name?: string; folderId?: string | null }

  // Move a project to a folder (or out of one with folderId: null).
  if (body.folderId !== undefined) {
    await ensureProjectColumns()
    const rows = await sql`
      UPDATE projects SET folder_id = ${body.folderId}
      WHERE id = ${id} AND user_id = ${userId} AND deleted_at IS NULL
      RETURNING folder_id
    `
    if (rows.length === 0) return Response.json({ error: 'Project not found' }, { status: 404 })
    return Response.json({ folderId: rows[0].folder_id ?? null })
  }

  if (body.name !== undefined) {
    const name = body.name.trim().slice(0, 200)
    if (!name) return Response.json({ error: 'Name cannot be empty' }, { status: 400 })
    const slug = await uniqueSlugExcluding(userId, name, id)
    const rows = await sql`
      UPDATE projects
      SET name = ${name},
          slug = ${slug},
          data = jsonb_set(data, '{name}', to_jsonb(${name}::text))
      WHERE id = ${id} AND user_id = ${userId} AND deleted_at IS NULL
      RETURNING name, slug, owner_username
    `
    if (rows.length === 0) return Response.json({ error: 'Project not found' }, { status: 404 })
    return Response.json({ name: rows[0].name, slug: rows[0].slug, username: rows[0].owner_username })
  }

  const rows = await sql`
    UPDATE projects SET starred = NOT starred
    WHERE id = ${id} AND user_id = ${userId} AND deleted_at IS NULL
    RETURNING starred
  `
  if (rows.length === 0) return Response.json({ error: 'Project not found' }, { status: 404 })
  return Response.json({ starred: rows[0].starred })
}

// DELETE /api/projects/:id
// ?permanent=true → hard-delete from DB and purge R2 files
// default → soft-delete (move to trash)
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const permanent = new URL(req.url).searchParams.get('permanent') === 'true'

  if (permanent) {
    const rows = await sql`
      SELECT data FROM projects WHERE id = ${id} AND user_id = ${userId}
    `
    if (rows.length === 0) return Response.json({ error: 'Project not found' }, { status: 404 })

    const data = rows[0].data as CfProjFile
    const r2Keys = (data.media as SerializedMedia[]).map(m => m.r2Key).filter(Boolean) as string[]
    await Promise.all([
      deleteObjects(r2Keys),
      sql`DELETE FROM projects WHERE id = ${id} AND user_id = ${userId}`,
    ])
  } else {
    const result = await sql`
      UPDATE projects SET deleted_at = NOW()
      WHERE id = ${id} AND user_id = ${userId} AND deleted_at IS NULL
    `
    if ((result as unknown as { rowCount?: number }).rowCount === 0) {
      return Response.json({ error: 'Project not found' }, { status: 404 })
    }
  }

  return Response.json({ ok: true })
}
