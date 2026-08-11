#!/usr/bin/env node
// View the cross-provider token/credit usage ledger (lib/api-usage.ts / scripts/_usage.mjs).
//   node scripts/usage.mjs             # spend per user × provider
//   node scripts/usage.mjs totals      # per provider
//   node scripts/usage.mjs recent [n]  # latest calls
//   node scripts/usage.mjs purge --yes # wipe
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { neon } from '@neondatabase/serverless'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
if (!process.env.DATABASE_URL) { try { for (const l of readFileSync(join(ROOT, '.env.local'), 'utf8').split('\n')) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '') } } catch { /* */ } }
const sql = neon(process.env.DATABASE_URL)
const cmd = process.argv[2]

async function main() {
  await sql`CREATE TABLE IF NOT EXISTS api_usage (id TEXT PRIMARY KEY, user_id TEXT, provider TEXT NOT NULL, operation TEXT, units REAL, unit_type TEXT, input_tokens INTEGER, output_tokens INTEGER, cost_usd REAL, metadata JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`
  if (cmd === 'totals') {
    console.table(await sql`SELECT provider, COUNT(*)::int calls, COUNT(DISTINCT user_id)::int users, SUM(input_tokens)::bigint in_tok, SUM(output_tokens)::bigint out_tok, ROUND(SUM(units)::numeric,1) units, ROUND(SUM(cost_usd)::numeric,4) usd FROM api_usage GROUP BY provider ORDER BY usd DESC NULLS LAST`)
  } else if (cmd === 'recent') {
    console.table(await sql`SELECT created_at, COALESCE(user_id,'(local)') user_id, provider, operation, units, unit_type, input_tokens in_tok, output_tokens out_tok, cost_usd usd FROM api_usage ORDER BY created_at DESC LIMIT ${Number(process.argv[3]) || 30}`)
  } else if (cmd === 'purge') {
    if (!process.argv.includes('--yes')) { console.log('Re-run with --yes to wipe api_usage.'); return }
    await sql`DELETE FROM api_usage`; console.log('✓ purged')
  } else {
    console.table(await sql`SELECT COALESCE(user_id,'(local)') user_id, provider, COUNT(*)::int calls, ROUND(SUM(units)::numeric,1) units, SUM(input_tokens)::bigint in_tok, SUM(output_tokens)::bigint out_tok, ROUND(SUM(cost_usd)::numeric,4) usd FROM api_usage GROUP BY user_id, provider ORDER BY usd DESC NULLS LAST, calls DESC`)
  }
}
main().catch(e => { console.error(e); process.exit(1) })
