// Cross-provider token/credit usage ledger. One row per paid API call — WHO (user), WHICH provider,
// WHAT operation, and HOW MUCH it consumed (tokens / credits / seconds / characters) + an optional $ est.
// So we can attribute spend per user across every connected program that burns tokens (ElevenLabs,
// Anthropic, Deepgram, Replicate). Lazy self-creating table; every write fails soft — usage logging must
// NEVER break the request it's measuring.
//
// The same table is written by the .mjs scripts via scripts/_usage.mjs (identical schema).
import { sql } from '@/lib/db'
import { randomUUID } from 'node:crypto'
import { schemaManaged } from './schema-guard'

let ready = false
async function ensure(): Promise<void> {
  if (ready || schemaManaged) return
  await sql`
    CREATE TABLE IF NOT EXISTS api_usage (
      id            TEXT PRIMARY KEY,
      user_id       TEXT,                       -- null = local/script usage
      provider      TEXT NOT NULL,              -- 'elevenlabs' | 'anthropic' | 'deepgram' | 'replicate' | 'openai' | ...
      operation     TEXT,                       -- 'music-gen' | 'stem-sep' | 'vision' | 'transcribe' | 'image' | 'article' | ...
      units         REAL,                       -- amount consumed
      unit_type     TEXT,                       -- 'credits' | 'tokens' | 'seconds' | 'characters' | 'predictions'
      input_tokens  INTEGER,                    -- LLM breakdown (optional)
      output_tokens INTEGER,
      cost_usd      REAL,                        -- optional estimate
      metadata      JSONB,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`
  ready = true
}

export interface UsageEntry {
  userId?: string | null
  provider: 'elevenlabs' | 'anthropic' | 'deepgram' | 'replicate' | 'openai' | string
  operation?: string
  units?: number
  unitType?: 'credits' | 'tokens' | 'seconds' | 'characters' | 'predictions' | string
  inputTokens?: number
  outputTokens?: number
  costUsd?: number
  metadata?: Record<string, unknown>
}

// Rough public list prices for a $ estimate when the provider doesn't return a cost (per-unit USD).
const RATE: Record<string, { in?: number; out?: number; per?: number; unit?: string }> = {
  'anthropic:claude-sonnet-5': { in: 3 / 1e6, out: 15 / 1e6 },     // per token
  'anthropic:claude-opus-4-8': { in: 15 / 1e6, out: 75 / 1e6 },
  'deepgram': { per: 0.0043 / 60, unit: 'seconds' },               // nova ~$0.0043/min
}
function estimate(e: UsageEntry): number | undefined {
  if (e.costUsd != null) return e.costUsd
  const model = (e.metadata?.model as string) || ''
  const r = RATE[`${e.provider}:${model}`] || RATE[e.provider]
  if (!r) return undefined
  if (r.in != null && (e.inputTokens || e.outputTokens)) return +(((e.inputTokens || 0) * r.in) + ((e.outputTokens || 0) * (r.out ?? r.in))).toFixed(5)
  if (r.per != null && e.units != null) return +(e.units * r.per).toFixed(5)
  return undefined
}

/** Record one API call's usage. Fire-and-forget from routes — never await-block the response on it. */
export async function recordUsage(e: UsageEntry): Promise<void> {
  try {
    await ensure()
    await sql`
      INSERT INTO api_usage (id, user_id, provider, operation, units, unit_type, input_tokens, output_tokens, cost_usd, metadata)
      VALUES (${randomUUID()}, ${e.userId ?? null}, ${e.provider}, ${e.operation ?? null}, ${e.units ?? null}, ${e.unitType ?? null},
              ${e.inputTokens ?? null}, ${e.outputTokens ?? null}, ${estimate(e) ?? null}, ${e.metadata ? JSON.stringify(e.metadata) : null})`
  } catch { /* usage logging is best-effort */ }
}

/** Spend attributed per user × provider (for the admin view / billing). */
export async function usageByUser(): Promise<Record<string, unknown>[]> {
  try {
    await ensure()
    return await sql`
      SELECT user_id, provider,
             COUNT(*)::int calls,
             ROUND(SUM(units)::numeric, 2) units,
             SUM(input_tokens)::bigint in_tokens, SUM(output_tokens)::bigint out_tokens,
             ROUND(SUM(cost_usd)::numeric, 4) cost_usd
      FROM api_usage GROUP BY user_id, provider ORDER BY cost_usd DESC NULLS LAST, calls DESC`
  } catch { return [] }
}

/** Totals per provider. */
export async function usageTotals(): Promise<Record<string, unknown>[]> {
  try {
    await ensure()
    return await sql`
      SELECT provider, COUNT(*)::int calls, COUNT(DISTINCT user_id)::int users,
             SUM(input_tokens)::bigint in_tokens, SUM(output_tokens)::bigint out_tokens,
             ROUND(SUM(cost_usd)::numeric, 4) cost_usd
      FROM api_usage GROUP BY provider ORDER BY cost_usd DESC NULLS LAST`
  } catch { return [] }
}

/** Consumption summed per provider × operation × unit_type — so exact ElevenLabs
 *  credits (unit_type='credits') read distinctly from the seconds proxy. */
export async function usageByProviderUnit(): Promise<Record<string, unknown>[]> {
  try {
    await ensure()
    return await sql`
      SELECT provider, operation, unit_type, COUNT(*)::int calls,
             ROUND(SUM(units)::numeric, 2) units, ROUND(SUM(cost_usd)::numeric, 4) cost_usd
      FROM api_usage GROUP BY provider, operation, unit_type
      ORDER BY provider, calls DESC`
  } catch { return [] }
}

/** Most-recent raw rows for a live feed (shows the exact per-call credit/token figure). */
export async function usageRecent(limit = 40): Promise<Record<string, unknown>[]> {
  try {
    await ensure()
    return await sql`
      SELECT id, user_id, provider, operation, units, unit_type, input_tokens, output_tokens,
             cost_usd, metadata, created_at
      FROM api_usage ORDER BY created_at DESC LIMIT ${limit}`
  } catch { return [] }
}
