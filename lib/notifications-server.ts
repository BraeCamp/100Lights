import { sql } from './db'
import { ensureSchema } from './schema-version'

// Lightweight in-app notifications — the retention loop for the community's
// social layer (comments today; extendable to replies/reactions later). Email
// delivery is intentionally NOT here: no transactional email provider is wired
// yet. When one is added, call it from `notify()` behind an env check.

export async function ensureNotifications() {
  await ensureSchema('notifications', 1, async () => {
  await sql`
    CREATE TABLE IF NOT EXISTS notifications (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      item_id UUID,
      actor_name TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL DEFAULT '',
      read BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  await sql`CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications (user_id, created_at DESC)`
  })
}

/** Record a notification for a user. Best-effort — never blocks the action that
 *  triggered it (e.g. posting a comment must succeed even if this fails). */
export async function notify(opts: { userId: string; type: string; itemId?: string; actorName?: string; body?: string }): Promise<void> {
  if (!opts.userId) return
  try {
    await ensureNotifications()
    await sql`
      INSERT INTO notifications (user_id, type, item_id, actor_name, body)
      VALUES (${opts.userId}, ${opts.type}, ${opts.itemId ?? null}, ${opts.actorName ?? ''}, ${opts.body ?? ''})
    `
  } catch { /* best-effort; a missing notification must never fail the action */ }
}
