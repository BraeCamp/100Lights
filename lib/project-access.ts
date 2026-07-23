import { sql } from './db'
import { getSubscription } from './subscription'

// Project sharing model:
// - visibility 'private' (default): owner + explicitly added members only
// - visibility 'public': any signed-in user with the URL can view (view-only)
// - each member the owner adds gets a role the owner can change anytime:
//     'view'  — listen and follow along (free)
//     'edit'  — co-edit live; the member needs their own Pro plan to exercise it
//     'owner' — co-owner: full edit + can manage sharing; also needs Pro
//   The project's original owner (projects.user_id) always has owner access.

export type MemberRole = 'owner' | 'edit' | 'view'
export type ProjectAccess = 'owner' | 'edit' | 'view' | null

export function asMemberRole(r: unknown): MemberRole {
  return r === 'owner' ? 'owner' : r === 'edit' ? 'edit' : 'view'
}

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
  // Per-member permission. New members default to 'view'; the owner elevates
  // them to edit/owner (which the member's own Pro plan then unlocks).
  await sql`ALTER TABLE project_members ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'view'`
  await sql`ALTER TABLE project_members ALTER COLUMN role SET DEFAULT 'view'`
  ready = true
}

async function isPro(userId: string | null): Promise<boolean> {
  if (!userId) return false
  try { return (await getSubscription(userId)).plan === 'pro' } catch { return false }
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
    if (m.length > 0) role = asMemberRole(m[0].role)
  }

  const canView = role !== null || visibility === 'public'
  if (!canView) return { access: null, ownerId, visibility }

  // Editing (edit or owner role) is unlocked only by the collaborator's own Pro
  // plan; everyone else — including public visitors — is view-only.
  if ((role === 'edit' || role === 'owner') && await isPro(userId)) {
    return { access: role, ownerId, visibility }
  }
  return { access: 'view', ownerId, visibility }
}
