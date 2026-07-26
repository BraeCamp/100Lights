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
export interface Task { id: number; userId: string; body: string; dueAt: string | null; doneAt: string | null; author: string; createdAt: string }
export interface DueTask { id: number; userId: string; body: string; dueAt: string; overdue: boolean }

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

// ── Follow-up tasks ─────────────────────────────────────────────────────────
// A lightweight reminder pinned to an account ("check in about upgrade Friday").
// Open tasks with a due date surface in the Daily Brief when they come due.
let tasksReady = false
async function ensureTasks() {
  if (tasksReady) return
  await sql`CREATE TABLE IF NOT EXISTS user_tasks (
    id BIGSERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    body TEXT NOT NULL,
    due_at TIMESTAMPTZ,
    done_at TIMESTAMPTZ,
    author TEXT NOT NULL DEFAULT 'admin',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`
  await sql`CREATE INDEX IF NOT EXISTS user_tasks_open_idx ON user_tasks (user_id) WHERE done_at IS NULL`
  await sql`CREATE INDEX IF NOT EXISTS user_tasks_due_idx ON user_tasks (due_at) WHERE done_at IS NULL`
  tasksReady = true
}

const asTask = (r: Record<string, unknown>): Task => ({
  id: Number(r.id), userId: String(r.user_id), body: String(r.body),
  dueAt: r.due_at ? String(r.due_at) : null, doneAt: r.done_at ? String(r.done_at) : null,
  author: String(r.author), createdAt: String(r.created_at),
})

// Open tasks first (soonest due), then the last few completed for context.
export async function listTasks(userId: string): Promise<Task[]> {
  await ensureTasks()
  const rows = await safe(sql`
    SELECT id, user_id, body, due_at, done_at, author, created_at FROM user_tasks
    WHERE user_id = ${userId} AND (done_at IS NULL OR done_at > NOW() - INTERVAL '7 days')
    ORDER BY done_at IS NOT NULL, due_at NULLS LAST, created_at DESC
    LIMIT 50`, [] as Record<string, unknown>[])
  return rows.map(asTask)
}

export async function addTask(userId: string, body: string, dueAt: string | null, author: string): Promise<Task> {
  await ensureTasks()
  const rows = await sql`INSERT INTO user_tasks (user_id, body, due_at, author) VALUES (${userId}, ${body.slice(0, 500)}, ${dueAt || null}, ${author}) RETURNING id, user_id, body, due_at, done_at, author, created_at`
  return asTask(rows[0])
}

export async function setTaskDone(userId: string, id: number, done: boolean): Promise<void> {
  await ensureTasks()
  // Two statements rather than a conditional SQL fragment (the local adapter
  // can't compose a fragment in a value slot).
  if (done) await sql`UPDATE user_tasks SET done_at = NOW() WHERE id = ${id} AND user_id = ${userId}`
  else await sql`UPDATE user_tasks SET done_at = NULL WHERE id = ${id} AND user_id = ${userId}`
}

export async function deleteTask(userId: string, id: number): Promise<void> {
  await ensureTasks()
  await sql`DELETE FROM user_tasks WHERE id = ${id} AND user_id = ${userId}`
}

// Open, dated tasks that are overdue or due within ~36h — for the Daily Brief.
export async function dueTasks(limit = 25): Promise<DueTask[]> {
  await ensureTasks()
  const rows = await safe(sql`
    SELECT id, user_id, body, due_at, (due_at < NOW()) AS overdue FROM user_tasks
    WHERE done_at IS NULL AND due_at IS NOT NULL AND due_at <= NOW() + INTERVAL '36 hours'
    ORDER BY due_at ASC LIMIT ${limit}`, [] as Record<string, unknown>[])
  return rows.map(r => ({ id: Number(r.id), userId: String(r.user_id), body: String(r.body), dueAt: String(r.due_at), overdue: !!r.overdue }))
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
    const action = String(a.action)
    // Outreach emails get a first-class timeline entry.
    if (action === 'user.email') {
      const subj = (a.detail as { subject?: string } | null)?.subject
      push(a.created_at, 'email', 'Emailed this user', subj ? `“${subj}”` : undefined)
      continue
    }
    let d = ''
    try { d = a.detail ? JSON.stringify(a.detail) : '' } catch { d = '' }
    push(a.created_at, 'admin', `Admin action: ${action}`, d && d !== '{}' ? d.slice(0, 120) : undefined)
  }

  return ev.sort((x, y) => y.at.localeCompare(x.at)).slice(0, 50)
}
