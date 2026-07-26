import { sql } from './db'
import { currentUser } from '@clerk/nextjs/server'

// Append-only record of consequential admin actions — gifts, code changes,
// module-flag toggles, article publishes/deletes, community takedowns. So the
// question "why does this user have Pro / who deleted that / when did this go
// live" always has an answer, and mistakes can be traced and reversed.

let ready = false
async function ensure() {
  if (ready) return
  await sql`
    CREATE TABLE IF NOT EXISTS admin_audit (
      id         BIGSERIAL PRIMARY KEY,
      actor      TEXT        NOT NULL DEFAULT 'admin',  -- admin email when known
      action     TEXT        NOT NULL,                  -- e.g. 'gift.grant', 'article.purge'
      target     TEXT,                                  -- the thing acted on (userId, slug, code…)
      detail     JSONB,                                 -- action-specific payload
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  await sql`CREATE INDEX IF NOT EXISTS admin_audit_id_desc_idx ON admin_audit (id DESC)`
  ready = true
}

export interface AuditEntry {
  id: number
  actor: string
  action: string
  target: string | null
  detail: unknown
  created_at: string
}

/**
 * Record an admin action. Best-effort and self-contained: a logging failure
 * must never break the action it describes, so everything is swallowed. Call it
 * with `await` after the mutation succeeds (serverless can kill un-awaited work
 * once the response is sent).
 */
export async function logAdmin(action: string, target?: string | null, detail?: unknown): Promise<void> {
  try {
    await ensure()
    let actor = 'admin'
    try {
      const u = await currentUser()
      actor = u?.emailAddresses?.[0]?.emailAddress ?? 'admin'
    } catch { /* no Clerk session (e.g. cookie-only admin) — leave 'admin' */ }
    const payload = detail === undefined ? null : JSON.stringify(detail)
    await sql`
      INSERT INTO admin_audit (actor, action, target, detail)
      VALUES (${actor}, ${action}, ${target ?? null}, ${payload}::jsonb)
    `
  } catch { /* audit is never allowed to fail the caller */ }
}

export async function listAudit(limit = 200): Promise<AuditEntry[]> {
  await ensure()
  const rows = await sql`
    SELECT id, actor, action, target, detail, created_at
    FROM admin_audit ORDER BY id DESC LIMIT ${Math.min(500, Math.max(1, limit))}
  `
  return rows.map(r => ({
    id: Number(r.id),
    actor: String(r.actor),
    action: String(r.action),
    target: r.target ? String(r.target) : null,
    detail: r.detail ?? null,
    created_at: String(r.created_at),
  }))
}
