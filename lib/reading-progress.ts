import { sql } from '@/lib/db'

// Per-account "articles read" — the server side of learning-path progress.
// Guests use localStorage only (components/learn/usePathProgress.ts); once
// signed in, the client reconciles that local set with this table so progress
// follows the account across devices. Best-effort throughout: a missing table
// or transient error never breaks a page (progress is non-critical UI state).

let ready = false
async function ensure(): Promise<void> {
  if (ready) return
  await sql`
    CREATE TABLE IF NOT EXISTS article_reads (
      user_id  TEXT        NOT NULL,
      slug     TEXT        NOT NULL,
      read_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, slug)
    )
  `
  await sql`CREATE INDEX IF NOT EXISTS article_reads_user_idx ON article_reads (user_id)`
  ready = true
}

export async function getReads(userId: string): Promise<string[]> {
  try {
    await ensure()
    const rows = await sql`SELECT slug FROM article_reads WHERE user_id = ${userId}`
    return rows.map(r => r.slug as string)
  } catch {
    return []
  }
}

/** Upsert one or more read slugs for a user (idempotent, conflict-safe). */
export async function markReads(userId: string, slugs: string[]): Promise<void> {
  const clean = [...new Set(slugs.map(s => String(s || '').trim()).filter(Boolean))].slice(0, 1000)
  if (!clean.length) return
  try {
    await ensure()
    for (const slug of clean) {
      await sql`INSERT INTO article_reads (user_id, slug) VALUES (${userId}, ${slug}) ON CONFLICT DO NOTHING`
    }
  } catch { /* non-critical */ }
}
