import { sql } from './db'
import { schemaManaged } from './schema-guard'

// A durable record of every webhook we receive, with its outcome — so a
// dropped Stripe event (a customer stuck on the wrong plan) is visible and
// re-runnable from the admin cockpit instead of lost in Vercel logs.

export type WebhookSource = 'stripe' | 'clerk'
export type WebhookStatus = 'received' | 'handled' | 'failed'

let ready = false
async function ensure() {
  if (ready || schemaManaged) return
  await sql`CREATE TABLE IF NOT EXISTS webhook_events (
    id BIGSERIAL PRIMARY KEY,
    source TEXT NOT NULL,
    event_type TEXT NOT NULL,
    event_id TEXT,
    payload JSONB NOT NULL,
    status TEXT NOT NULL DEFAULT 'received',
    error TEXT,
    replay_of BIGINT,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    handled_at TIMESTAMPTZ
  )`
  // Recent-first listing is the only read pattern.
  await sql`CREATE INDEX IF NOT EXISTS webhook_events_recent ON webhook_events (received_at DESC)`
  ready = true
}

// Record an inbound event before handling it. Returns the row id, or null if
// logging itself failed — a logging failure must NEVER break the webhook, so
// callers ignore null and proceed to handle the event regardless.
export async function logWebhook(e: {
  source: WebhookSource; eventType: string; eventId?: string | null; payload: unknown; replayOf?: number
}): Promise<number | null> {
  try {
    await ensure()
    const rows = await sql`
      INSERT INTO webhook_events (source, event_type, event_id, payload, status, replay_of)
      VALUES (${e.source}, ${e.eventType}, ${e.eventId ?? null}, ${JSON.stringify(e.payload)}::jsonb, 'received', ${e.replayOf ?? null})
      RETURNING id`
    return Number(rows[0]?.id) || null
  } catch { return null }
}

export async function markWebhook(id: number | null, status: WebhookStatus, error?: string | null) {
  if (!id) return
  try {
    await sql`UPDATE webhook_events SET status = ${status}, error = ${error ? String(error).slice(0, 500) : null}, handled_at = NOW() WHERE id = ${id}`
  } catch { /* best effort */ }
}

export async function listWebhooks(opts: { source?: string; status?: string; limit?: number } = {}) {
  await ensure()
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500)
  const source = opts.source && opts.source !== 'all' ? opts.source : null
  const status = opts.status && opts.status !== 'all' ? opts.status : null
  return sql`
    SELECT id, source, event_type, event_id, status, error, replay_of, received_at, handled_at
    FROM webhook_events
    WHERE (${source}::text IS NULL OR source = ${source})
      AND (${status}::text IS NULL OR status = ${status})
    ORDER BY received_at DESC
    LIMIT ${limit}`
}

export async function getWebhook(id: number) {
  await ensure()
  const rows = await sql`SELECT id, source, event_type, event_id, payload, status, error, received_at FROM webhook_events WHERE id = ${id}`
  return rows[0] ?? null
}

// Rolling counts for the panel header.
export async function webhookStats() {
  await ensure()
  const rows = await sql`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
      COUNT(*) FILTER (WHERE received_at > NOW() - INTERVAL '24 hours')::int AS day
    FROM webhook_events`
  return rows[0] ?? { total: 0, failed: 0, day: 0 }
}
