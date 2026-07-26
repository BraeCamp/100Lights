import { sql } from './db'

// The CRM layer over a user account: a merged activity timeline (from data we
// already keep) and a dated notes log (institutional memory that accumulates
// instead of overwriting). All best-effort — a missing table degrades one
// source to empty, never throws.

export interface TimelineEvent {
  at: string            // ISO timestamp
  kind: string          // 'signup' | 'project' | 'code' | 'community' | 'feedback' | 'admin' | 'gift'
  label: string         // one-line summary
  detail?: string       // optional secondary text
}

export interface NoteEntry { id: number; body: string; author: string; createdAt: string }

async function safe<T>(p: Promise<T>, fallback: T): Promise<T> {
  try { return await p } catch { return fallback }
}

// ── Dated notes log ─────────────────────────────────────────────────────────
let logReady = false
async function ensureNoteLog() {
  if (logReady) return
  await sql`CREATE TABLE IF NOT EXISTS user_note_entries (
    id BIGSERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    body TEXT NOT NULL,
    author TEXT NOT NULL DEFAULT 'admin',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`
  await sql`CREATE INDEX IF NOT EXISTS user_note_entries_user_idx ON user_note_entries (user_id, created_at DESC)`
  logReady = true
}

export async function listNoteEntries(userId: string): Promise<NoteEntry[]> {
  await ensureNoteLog()
  const rows = await safe(sql`SELECT id, body, author, created_at FROM user_note_entries WHERE user_id = ${userId} ORDER BY created_at DESC LIMIT 100`, [] as Record<string, unknown>[])
  return rows.map(r => ({ id: Number(r.id), body: String(r.body), author: String(r.author), createdAt: String(r.created_at) }))
}

export async function addNoteEntry(userId: string, body: string, author: string): Promise<NoteEntry> {
  await ensureNoteLog()
  const rows = await sql`INSERT INTO user_note_entries (user_id, body, author) VALUES (${userId}, ${body.slice(0, 4000)}, ${author}) RETURNING id, body, author, created_at`
  const r = rows[0]
  return { id: Number(r.id), body: String(r.body), author: String(r.author), createdAt: String(r.created_at) }
}

export async function deleteNoteEntry(userId: string, id: number): Promise<void> {
  await ensureNoteLog()
  await sql`DELETE FROM user_note_entries WHERE id = ${id} AND user_id = ${userId}`
}

// ── Activity timeline ───────────────────────────────────────────────────────
export async function buildTimeline(userId: string): Promise<TimelineEvent[]> {
  const [subRows, proj, redemptions, community, feedback, audit] = await Promise.all([
    safe(sql`SELECT created_at, gift_plan, gift_until FROM subscriptions WHERE user_id = ${userId}`, [] as Record<string, unknown>[]),
    safe(sql`SELECT MIN(saved_at) AS first, MAX(saved_at) AS last, COUNT(*)::int AS n FROM projects WHERE user_id = ${userId} AND deleted_at IS NULL`, [] as Record<string, unknown>[]),
    safe(sql`SELECT code, grant_days, redeemed_at FROM code_redemptions WHERE user_id = ${userId} ORDER BY redeemed_at DESC LIMIT 20`, [] as Record<string, unknown>[]),
    safe(sql`SELECT name, kind, created_at FROM community_items WHERE user_id = ${userId} ORDER BY created_at DESC LIMIT 20`, [] as Record<string, unknown>[]),
    safe(sql`SELECT message, created_at FROM feedback WHERE user_id = ${userId} ORDER BY created_at DESC LIMIT 20`, [] as Record<string, unknown>[]),
    safe(sql`SELECT action, detail, created_at FROM admin_audit WHERE target = ${userId} ORDER BY created_at DESC LIMIT 20`, [] as Record<string, unknown>[]),
  ])

  const ev: TimelineEvent[] = []
  const push = (at: unknown, kind: string, label: string, detail?: string) => {
    if (!at) return
    const iso = new Date(String(at)).toISOString()
    ev.push({ at: iso, kind, label, detail })
  }

  const sub = subRows[0]
  if (sub?.created_at) push(sub.created_at, 'signup', 'Signed up')

  const p = proj[0]
  if (p?.first) push(p.first, 'project', 'Saved their first project')
  if (p?.last && p?.n && Number(p.n) > 1 && String(p.last) !== String(p.first)) {
    push(p.last, 'project', 'Most recent project activity', `${p.n} projects total`)
  }

  for (const r of redemptions) push(r.redeemed_at, 'code', `Redeemed code ${r.code}`, `${r.grant_days} days of Pro`)
  for (const c of community) push(c.created_at, 'community', `Published “${c.name}”`, String(c.kind))
  for (const f of feedback) push(f.created_at, 'feedback', 'Sent feedback', String(f.message).slice(0, 120))
  for (const a of audit) {
    let d = ''
    try { d = a.detail ? JSON.stringify(a.detail) : '' } catch { d = '' }
    push(a.created_at, 'admin', `Admin action: ${a.action}`, d && d !== '{}' ? d.slice(0, 120) : undefined)
  }

  return ev.sort((x, y) => y.at.localeCompare(x.at)).slice(0, 50)
}
