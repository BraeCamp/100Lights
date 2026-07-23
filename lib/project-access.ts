import { sql } from './db'

// Project sharing model:
// - visibility 'private' (default): owner + explicitly added members only
// - visibility 'public': any signed-in user with the URL can view (view-only)
// - each member the owner adds gets a role — 'edit' (co-edit live) or 'view'
//   (listen/follow only) — which the owner can change at any time. The owner
//   always edits their own projects.

export type MemberRole = 'edit' | 'view'
export type ProjectAccess = 'owner' | 'edit' | 'view' | null

let ready = false
export async function ensureSharingSchema() {
  if (ready) return
  await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'private'`
  await sql`
    CREATE TABLE IF NOT EXISTS project_members (
      project_id UUID NOT NULL,
      email TEXT NOT NULL,
      added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (project_id, email)
    )
  `
  // Per-member permission. Added members default to 'edit' (sharing is a
  // collaboration invite); the owner can downgrade any member to 'view'.
  await sql`ALTER TABLE project_members ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'edit'`
  ready = true
}

export async function getProjectAccess(
  projectId: string,
  userId: string | null,
  email: string | null,
): Promise<{ access: ProjectAccess; ownerId: string | null; visibility: string }> {
  await ensureSharingSchema()
  const rows = await sql`SELECT user_id, visibility FROM projects WHERE id = ${projectId} AND deleted_at IS NULL`
  if (rows.length === 0) return { access: null, ownerId: null, visibility: 'private' }
  const ownerId = rows[0].user_id as string
  const visibility = (rows[0].visibility as string) ?? 'private'

  if (userId && userId === ownerId) return { access: 'owner', ownerId, visibility }

  // A membership row (if any) carries the role the owner assigned.
  let role: MemberRole | null = null
  if (email) {
    const m = await sql`SELECT role FROM project_members WHERE project_id = ${projectId} AND LOWER(email) = ${email.toLowerCase()}`
    if (m.length > 0) role = ((m[0].role as string) === 'view' ? 'view' : 'edit')
  }

  const canView = role !== null || visibility === 'public'
  if (!canView) return { access: null, ownerId, visibility }

  // Members edit or view per their assigned role; public (non-member) visitors
  // are view-only.
  return { access: role === 'edit' ? 'edit' : 'view', ownerId, visibility }
}
