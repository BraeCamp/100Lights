import { sql } from '@/lib/db'

// Anthropic pricing (USD per token)
const PRICES: Record<string, { in: number; out: number }> = {
  'claude-haiku-4-5-20251001': { in: 0.80 / 1_000_000,  out: 4.00 / 1_000_000 },
  'claude-sonnet-4-6':         { in: 3.00 / 1_000_000,  out: 15.00 / 1_000_000 },
  'claude-opus-4-8':           { in: 15.00 / 1_000_000, out: 75.00 / 1_000_000 },
}

export function estimateCost(model: string, tokensIn: number, tokensOut: number): number {
  const p = PRICES[model] ?? PRICES['claude-haiku-4-5-20251001']
  return tokensIn * p.in + tokensOut * p.out
}

let tableReady = false
async function ensureTable() {
  if (tableReady) return
  await sql`
    CREATE TABLE IF NOT EXISTS ai_calls (
      id         BIGSERIAL PRIMARY KEY,
      user_id    TEXT        NOT NULL,
      route      TEXT        NOT NULL,
      model      TEXT        NOT NULL,
      tokens_in  INT         NOT NULL DEFAULT 0,
      tokens_out INT         NOT NULL DEFAULT 0,
      called_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  await sql`CREATE INDEX IF NOT EXISTS ai_calls_called_at ON ai_calls (called_at DESC)`
  await sql`CREATE INDEX IF NOT EXISTS ai_calls_route     ON ai_calls (route)`
  tableReady = true
}

export async function logAiCall(
  userId: string,
  route:  string,
  model:  string,
  tokensIn:  number,
  tokensOut: number,
) {
  try {
    await ensureTable()
    await sql`
      INSERT INTO ai_calls (user_id, route, model, tokens_in, tokens_out)
      VALUES (${userId}, ${route}, ${model}, ${tokensIn}, ${tokensOut})
    `
  } catch {
    // Non-fatal — logging failure should never break the actual AI response
  }
}
