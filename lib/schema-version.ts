import { sql } from '@/lib/db'

// Run a module's schema setup ONCE per deploy instead of once per cold start.
//
// The pattern all over this codebase is a module-level `ready` flag guarding a
// block of idempotent DDL — CREATE TABLE IF NOT EXISTS, ADD COLUMN IF NOT
// EXISTS, CREATE INDEX IF NOT EXISTS. That flag lives in the process, and on
// serverless every cold start is a fresh process, so the DDL runs again and
// again: 153 such statements across 56 modules, 34 in the community module
// alone. "IF NOT EXISTS" is cheap to *satisfy* but not free to *ask* — each one
// is a round trip that takes catalog locks, and you pay for it to read one row.
//
// Instead: record which version of a module's schema is live, and on a cold
// start ask that one small question. If the answer matches, skip the DDL
// entirely. If the table is missing or the version is behind, build it and
// stamp it. Self-healing — no migration step to run, nothing to remember, and a
// fresh database still sets itself up on first use.
//
// Bump `version` whenever a module's DDL changes, or the new statements will be
// skipped on deploys where the old version is already stamped.

let ensured = new Map<string, number>()

async function readVersion(name: string): Promise<number | null> {
  try {
    const rows = await sql`SELECT version FROM schema_version WHERE name = ${name}`
    return rows.length ? Number(rows[0].version) : null
  } catch {
    // The bookkeeping table itself is missing (or the database is unreachable).
    return null
  }
}

/**
 * Ensure `name`'s schema is at `version`, running `build` only when it is not.
 *
 * Never throws: a database that cannot be reached leaves the schema unverified
 * and lets the caller's own error handling deal with the query that follows.
 * Callers already degrade (an empty feed, a skipped check) — what they must not
 * do is take a page render down, which is how a quota problem once failed the
 * whole production build.
 */
export async function ensureSchema(name: string, version: number, build: () => Promise<void>): Promise<void> {
  if (ensured.get(name) === version) return
  try {
    if (await readVersion(name) === version) { ensured.set(name, version); return }
    await build()
    await sql`
      CREATE TABLE IF NOT EXISTS schema_version (
        name    TEXT PRIMARY KEY,
        version INT  NOT NULL,
        at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `
    await sql`
      INSERT INTO schema_version (name, version, at) VALUES (${name}, ${version}, NOW())
      ON CONFLICT (name) DO UPDATE SET version = EXCLUDED.version, at = NOW()
    `
    ensured.set(name, version)
  } catch {
    // Unreachable database — leave it unstamped so the next cold start retries.
  }
}

/** Tests / local resets. */
export function forgetSchemaCache(): void { ensured = new Map() }
