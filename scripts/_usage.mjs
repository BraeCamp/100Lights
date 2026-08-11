// Usage recorder for .mjs scripts — writes the SAME api_usage table lib/api-usage.ts uses, so script
// (local/dev) token spend shows up in the same per-user ledger. Fails soft. Reads DATABASE_URL.
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { neon } from '@neondatabase/serverless'
import { randomUUID } from 'node:crypto'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
if (!process.env.DATABASE_URL) {
  try { for (const l of readFileSync(join(ROOT, '.env.local'), 'utf8').split('\n')) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '') } } catch { /* no env */ }
}

let sql, ready = false
export async function recordUsage(e) {
  try {
    if (!process.env.DATABASE_URL) return
    if (!sql) sql = neon(process.env.DATABASE_URL)
    if (!ready) {
      await sql`CREATE TABLE IF NOT EXISTS api_usage (id TEXT PRIMARY KEY, user_id TEXT, provider TEXT NOT NULL, operation TEXT,
        units REAL, unit_type TEXT, input_tokens INTEGER, output_tokens INTEGER, cost_usd REAL, metadata JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`
      ready = true
    }
    await sql`INSERT INTO api_usage (id, user_id, provider, operation, units, unit_type, input_tokens, output_tokens, cost_usd, metadata)
      VALUES (${randomUUID()}, ${e.userId ?? null}, ${e.provider}, ${e.operation ?? null}, ${e.units ?? null}, ${e.unitType ?? null},
        ${e.inputTokens ?? null}, ${e.outputTokens ?? null}, ${e.costUsd ?? null}, ${e.metadata ? JSON.stringify(e.metadata) : null})`
  } catch { /* best-effort */ }
}
