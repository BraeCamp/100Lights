import { auth } from '@clerk/nextjs/server'
import { sql } from '@/lib/db'
import { schemaManaged } from '@/lib/schema-guard'

// Cloud folders for organizing projects. Nestable (a folder may sit inside another via `parent_id`).
// A project's folder is the `folder_id` column on `projects` (see /api/projects). Per-user.

let ready = false
async function ensureFolders() {
  if (ready || schemaManaged) return
  await sql`
    CREATE TABLE IF NOT EXISTS folders (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`
  await sql`CREATE INDEX IF NOT EXISTS folders_user_idx ON folders (user_id)`
  // Nesting: a folder can live inside another. NULL = top level.
  await sql`ALTER TABLE folders ADD COLUMN IF NOT EXISTS parent_id TEXT`
  // Custom look: a banner image + a logo (replacing the default folder icon), both stored as
  // downscaled data URLs (the client caps their size before upload; see MAX_IMG below).
  await sql`ALTER TABLE folders ADD COLUMN IF NOT EXISTS banner TEXT`
  await sql`ALTER TABLE folders ADD COLUMN IF NOT EXISTS logo TEXT`
  ready = true
}

// Server-side ceiling on the stored data URLs (the client already downscales; this is a backstop).
const MAX_IMG = 700_000   // ~700 KB of base64

export async function GET() {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    await ensureFolders()
    const rows = await sql`SELECT id, name, parent_id, banner, logo FROM folders WHERE user_id = ${userId} ORDER BY LOWER(name)` as { id: string; name: string; parent_id: string | null; banner: string | null; logo: string | null }[]
    return Response.json(rows.map(r => ({ id: r.id, name: r.name, parentId: r.parent_id ?? null, banner: r.banner ?? null, logo: r.logo ?? null })))
  } catch {
    return Response.json([])   // table not provisioned yet → no folders
  }
}

export async function POST(req: Request) {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({})) as { name?: string; parentId?: string | null }
  const name = (body.name ?? '').trim().slice(0, 60)
  if (!name) return Response.json({ error: 'Folder name required' }, { status: 400 })
  await ensureFolders()
  // Cap folders per user to keep the tree sane.
  const count = await sql`SELECT COUNT(*)::int AS n FROM folders WHERE user_id = ${userId}` as { n: number }[]
  if ((count[0]?.n ?? 0) >= 200) return Response.json({ error: 'Folder limit reached' }, { status: 403 })
  // Only allow a parent the user actually owns (else file at top level).
  let parentId: string | null = null
  if (body.parentId) {
    const ok = await sql`SELECT 1 FROM folders WHERE id = ${body.parentId} AND user_id = ${userId} LIMIT 1`
    if (ok.length) parentId = body.parentId
  }
  const id = crypto.randomUUID()
  await sql`INSERT INTO folders (id, user_id, name, parent_id) VALUES (${id}, ${userId}, ${name}, ${parentId})`
  return Response.json({ id, name, parentId })
}

export async function PATCH(req: Request) {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({})) as { id?: string; name?: string; parentId?: string | null; banner?: string | null; logo?: string | null }
  if (!body.id) return Response.json({ error: 'id required' }, { status: 400 })
  await ensureFolders()

  // Banner / logo — set (data URL) or clear (null / empty). Reject oversized or non-image payloads.
  for (const [key, val] of [['banner', body.banner], ['logo', body.logo]] as const) {
    if (val === undefined) continue
    if (val === null || val === '') {
      if (key === 'banner') await sql`UPDATE folders SET banner = NULL WHERE id = ${body.id} AND user_id = ${userId}`
      else                  await sql`UPDATE folders SET logo   = NULL WHERE id = ${body.id} AND user_id = ${userId}`
      continue
    }
    if (typeof val !== 'string' || !val.startsWith('data:image/')) return Response.json({ error: `Invalid ${key}` }, { status: 400 })
    if (val.length > MAX_IMG) return Response.json({ error: `${key} too large` }, { status: 413 })
    if (key === 'banner') await sql`UPDATE folders SET banner = ${val} WHERE id = ${body.id} AND user_id = ${userId}`
    else                  await sql`UPDATE folders SET logo   = ${val} WHERE id = ${body.id} AND user_id = ${userId}`
  }

  // Move a folder under a new parent (or to top level with parentId: null). Guard against a folder
  // becoming its own ancestor (which would create a cycle).
  if (body.parentId !== undefined) {
    let parent: string | null = null
    if (body.parentId) {
      if (body.parentId === body.id) return Response.json({ error: "A folder can't be its own parent" }, { status: 400 })
      const owned = await sql`SELECT 1 FROM folders WHERE id = ${body.parentId} AND user_id = ${userId} LIMIT 1`
      if (!owned.length) return Response.json({ error: 'Parent not found' }, { status: 400 })
      // walk up from the proposed parent — if we hit `body.id`, it's a cycle.
      let cur: string | null = body.parentId
      for (let i = 0; i < 100 && cur; i++) {
        if (cur === body.id) return Response.json({ error: "Can't move a folder into its own subfolder" }, { status: 400 })
        const up = await sql`SELECT parent_id FROM folders WHERE id = ${cur} AND user_id = ${userId}` as { parent_id: string | null }[]
        cur = up[0]?.parent_id ?? null
      }
      parent = body.parentId
    }
    await sql`UPDATE folders SET parent_id = ${parent} WHERE id = ${body.id} AND user_id = ${userId}`
  }

  const name = (body.name ?? '').trim().slice(0, 60)
  if (name) await sql`UPDATE folders SET name = ${name} WHERE id = ${body.id} AND user_id = ${userId}`
  return Response.json({ ok: true })
}

export async function DELETE(req: Request) {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return Response.json({ error: 'id required' }, { status: 400 })
  await ensureFolders()
  // Lift any subfolders up to this folder's parent (don't orphan or cascade-delete them),
  // unfile the folder's projects (don't delete them), then drop the folder.
  const self = await sql`SELECT parent_id FROM folders WHERE id = ${id} AND user_id = ${userId}` as { parent_id: string | null }[]
  const grandparent = self[0]?.parent_id ?? null
  await sql`UPDATE folders SET parent_id = ${grandparent} WHERE parent_id = ${id} AND user_id = ${userId}`
  await sql`UPDATE projects SET folder_id = NULL WHERE folder_id = ${id} AND user_id = ${userId}`
  await sql`DELETE FROM folders WHERE id = ${id} AND user_id = ${userId}`
  return Response.json({ ok: true })
}
