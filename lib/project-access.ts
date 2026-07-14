import { sql } from './db'
import { getSubscription } from './subscription'

// Project sharing model:
// - visibility 'private' (default): owner + explicitly added members only
// - visibility 'public': any signed-in user with the URL can view
// - editing on someone else's project requires a paid plan; free accounts
//   view. The owner always edits their own projects regardless of plan.

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

  let canView = visibility === 'public'
  if (!canView && email) {
    const m = await sql`SELECT 1 FROM project_members WHERE project_id = ${projectId} AND LOWER(email) = ${email.toLowerCase()}`
    canView = m.length > 0
  }
  if (!canView) return { access: null, ownerId, visibility }

  // Viewers with a paid plan get edit rights on shared projects
  if (userId) {
    try {
      const sub = await getSubscription(userId)
      if (sub.plan === 'pro') return { access: 'edit', ownerId, visibility }
    } catch { /* plan lookup failed → view */ }
  }
  return { access: 'view', ownerId, visibility }
}
