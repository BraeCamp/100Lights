import { sql } from './db'
import type { ProjectAdmin } from './project-admin'

// Server-only persistence for the project-admin overlay. Split out from
// lib/project-admin.ts (which is pure + client-safe) so client components can
// import the generators/types without pulling @/lib/db (pg/dns) into the bundle.

let ready = false
export async function ensureProjectAdminSchema(): Promise<void> {
  if (ready) return
  await sql`
    CREATE TABLE IF NOT EXISTS project_admin (
      project_id TEXT PRIMARY KEY,
      data       JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`
  ready = true
}

export async function getProjectAdmin(projectId: string): Promise<ProjectAdmin> {
  await ensureProjectAdminSchema()
  try {
    const rows = await sql`SELECT data FROM project_admin WHERE project_id = ${projectId}`
    return (rows[0]?.data as ProjectAdmin) ?? {}
  } catch {
    return {}
  }
}

export async function saveProjectAdmin(projectId: string, data: ProjectAdmin): Promise<void> {
  await ensureProjectAdminSchema()
  const payload = JSON.stringify({ ...data, updatedAt: new Date().toISOString() })
  await sql`
    INSERT INTO project_admin (project_id, data) VALUES (${projectId}, ${payload}::jsonb)
    ON CONFLICT (project_id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`
}
