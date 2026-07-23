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
  // Members are invited by email but bound to their Clerk user_id on first
  // access, so the grant survives an email change.
  await sql`ALTER TABLE project_members ADD COLUMN IF NOT EXISTS user_id TEXT`
  // Proposed edits from collaborators (view or edit role) the owner can accept
  // or reject. `data` is a full serialized project (CfProjFile) snapshot.
  await sql`
    CREATE TABLE IF NOT EXISTS project_suggestions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id UUID NOT NULL,
      author_id TEXT NOT NULL,
      author_name TEXT NOT NULL DEFAULT 'A collaborator',
      note TEXT NOT NULL DEFAULT '',
      data JSONB NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
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

  // A membership row (if any) carries the role the owner assigned. Match by
  // Clerk user_id OR email, so a member whose email changed still matches once
  // bound; then bind user_id on this access if it wasn't already.
  let role: MemberRole | null = null
  const uid = userId ?? null
  const em = email ? email.toLowerCase() : null
  if (uid || em) {
    const m = await sql`
      SELECT role, user_id, email FROM project_members
      WHERE project_id = ${projectId}
        AND ( (${uid}::text IS NOT NULL AND user_id = ${uid})
           OR (${em}::text IS NOT NULL AND LOWER(email) = ${em}) )
      LIMIT 1`
    if (m.length > 0) {
      role = asMemberRole(m[0].role)
      if (uid && m[0].user_id == null && m[0].email) {
        await sql`UPDATE project_members SET user_id = ${uid} WHERE project_id = ${projectId} AND LOWER(email) = ${(m[0].email as string).toLowerCase()} AND user_id IS NULL`
      }
    }
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
