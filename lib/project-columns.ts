import { sql } from '@/lib/db'
import { ensureSchema } from '@/lib/schema-version'

/**
 * Columns added to `projects` after the table was first created.
 *
 * One owner, because two routes need them and a copy in each would drift the
 * moment the version is bumped — the list route reads slug/owner_username to
 * build canonical links, and the [id] route needs folder_id to move a project
 * into a folder. That second one used to ALTER the table on every folder move
 * rather than every cold start, so filing ten projects took ten catalog locks.
 *
 * Bump the version when the statements change.
 */
export async function ensureProjectColumns(): Promise<void> {
  await ensureSchema('projects.columns', 1, async () => {
    await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS slug TEXT`
    await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS owner_username TEXT`
    await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS folder_id TEXT`
  })
}
