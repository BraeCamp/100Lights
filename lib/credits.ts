// Credits — the shared, AI-only currency, spendable across every 100Lights app. One balance per
// account. Pro ($10/mo) and higher tiers grant a monthly credit allotment; extra credits can be
// bought as top-ups. Non-AI features never touch credits. The hybrid transcription engine
// (lib/transcribe-confidence) keeps the metered fraction small, so everyday use costs ~nothing.
//
// Lazy self-creating tables (mirrors lib/codes.ts / lib/app-targets.ts). Reads fail soft.
//
// ⚠️ SET-THESE: the numbers below are safe defaults. Finalize the tier prices + credit rates,
// create the matching Stripe products/prices, and map price IDs → tiers in TIER_BY_PRICE.
import { sql } from '@/lib/db'

// ── Tiers ────────────────────────────────────────────────────────────────────────────────────
// Prices + monthly credits MIRROR ElevenLabs (2026): our hybrid only partially uses AI, so the
// same credits go much further here. All paid tiers grant "Pro" feature access; they differ only
// in the monthly credit allotment.
export const CREDIT_TIERS = {
  free:     { price: 0,   monthlyCredits: 10_000,    label: 'Free' },
  starter:  { price: 6,   monthlyCredits: 30_000,    label: 'Starter' },
  creator:  { price: 11,  monthlyCredits: 121_000,   label: 'Creator' },
  pro:      { price: 99,  monthlyCredits: 600_000,   label: 'Pro' },
  scale:    { price: 299, monthlyCredits: 1_800_000, label: 'Scale' },
  business: { price: 990, monthlyCredits: 6_000_000, label: 'Business' },
} as const
export type CreditTier = keyof typeof CREDIT_TIERS

/** Map a Stripe price id → tier. Filled by env once the products exist (no secrets in git). */
export const TIER_BY_PRICE: Record<string, CreditTier> = {
  ...(process.env.STRIPE_STARTER_PRICE_ID  ? { [process.env.STRIPE_STARTER_PRICE_ID]:  'starter'  as const } : {}),
  ...(process.env.STRIPE_CREATOR_PRICE_ID  ? { [process.env.STRIPE_CREATOR_PRICE_ID]:  'creator'  as const } : {}),
  ...(process.env.STRIPE_PRO_PRICE_ID      ? { [process.env.STRIPE_PRO_PRICE_ID]:      'pro'      as const } : {}),
  ...(process.env.STRIPE_SCALE_PRICE_ID    ? { [process.env.STRIPE_SCALE_PRICE_ID]:    'scale'    as const } : {}),
  ...(process.env.STRIPE_BUSINESS_PRICE_ID ? { [process.env.STRIPE_BUSINESS_PRICE_ID]: 'business' as const } : {}),
}

// ── AI action costs (credits). Scaled to the new allotments; the hybrid bills only the AI fraction
//    (the low-confidence spans), so real spend is far below the nominal cost. Tune freely. ──
export const CREDIT_COSTS = {
  transcribeMinute: 200,   // per minute of audio sent to the AI/smarter pass (only low-confidence spans)
  visionPage: 500,         // per sheet-music image/PDF page (Claude vision)
  generateClip: 2000,      // per AI music generation
  stems: 1500,             // per stem-separation
}

/** One-time credit top-ups (~ElevenLabs Creator rate). Price ids come from STRIPE_TOPUP_<n>_PRICE_ID. */
export const CREDIT_TOPUPS = [
  { credits: 55_000, usd: 5 },
  { credits: 220_000, usd: 20 },
] as const

/** Stripe price id for a subscription tier (from env, set by scripts/setup-stripe-products.mjs). */
export function priceIdForTier(tier: CreditTier): string | undefined {
  return process.env[`STRIPE_${tier.toUpperCase()}_PRICE_ID`]
}
/** Stripe price id for a one-time top-up of `credits`. */
export function topupPriceId(credits: number): string | undefined {
  return process.env[`STRIPE_TOPUP_${credits}_PRICE_ID`]
}

/** Free-tier AI transcription allowance (no credits needed), per rolling 30 days. */
export const FREE_TRANSCRIBE_SECONDS = 5 * 60

/** Master switch. While false (default), NO endpoint meters credits — everything works as it does
 *  today. Flip CREDITS_ENABLED=true only after the Stripe products/prices + tier grants are live. */
export const CREDITS_ENABLED = process.env.CREDITS_ENABLED === 'true'

let ready = false
async function ensure(): Promise<void> {
  if (ready) return
  await sql`
    CREATE TABLE IF NOT EXISTS user_credits (
      user_id              TEXT PRIMARY KEY,
      balance              INTEGER NOT NULL DEFAULT 0,
      monthly_grant        INTEGER NOT NULL DEFAULT 0,
      cycle_start          TIMESTAMPTZ,
      free_transcribe_used INTEGER NOT NULL DEFAULT 0,
      free_cycle_start     TIMESTAMPTZ,
      updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`
  await sql`
    CREATE TABLE IF NOT EXISTS credit_ledger (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL,
      delta      INTEGER NOT NULL,
      reason     TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`
  ready = true
}

async function record(userId: string, delta: number, reason: string): Promise<void> {
  try { await sql`INSERT INTO credit_ledger (id, user_id, delta, reason) VALUES (${crypto.randomUUID()}, ${userId}, ${delta}, ${reason})` } catch { /* audit only */ }
}

export interface CreditState { balance: number; monthlyGrant: number; freeTranscribeUsed: number }

/** Current balance + free-allowance usage. Fails soft to zeros (so UI never crashes offline). */
export async function getCredits(userId: string): Promise<CreditState> {
  try {
    await ensure()
    const r = await sql`SELECT balance, monthly_grant, free_transcribe_used FROM user_credits WHERE user_id = ${userId}`
    if (!r.length) return { balance: 0, monthlyGrant: 0, freeTranscribeUsed: 0 }
    return { balance: Number(r[0].balance), monthlyGrant: Number(r[0].monthly_grant), freeTranscribeUsed: Number(r[0].free_transcribe_used) }
  } catch { return { balance: 0, monthlyGrant: 0, freeTranscribeUsed: 0 } }
}

/** Add credits (a purchase/top-up or an admin grant). */
export async function grantCredits(userId: string, amount: number, reason: string): Promise<void> {
  await ensure()
  await sql`
    INSERT INTO user_credits (user_id, balance) VALUES (${userId}, ${amount})
    ON CONFLICT (user_id) DO UPDATE SET balance = user_credits.balance + ${amount}, updated_at = NOW()`
  await record(userId, amount, reason)
}

/** Set a tier's monthly allotment + add it (called by the Stripe webhook on invoice paid / renew). */
export async function applyTierGrant(userId: string, tier: CreditTier): Promise<void> {
  await ensure()
  const grant = CREDIT_TIERS[tier].monthlyCredits
  await sql`
    INSERT INTO user_credits (user_id, balance, monthly_grant, cycle_start) VALUES (${userId}, ${grant}, ${grant}, NOW())
    ON CONFLICT (user_id) DO UPDATE SET balance = user_credits.balance + ${grant}, monthly_grant = ${grant}, cycle_start = NOW(), updated_at = NOW()`
  await record(userId, grant, `monthly grant (${tier})`)
}

/** Spend credits atomically. Returns { ok:false } (no deduction) when the balance is short. */
export async function spendCredits(userId: string, amount: number, reason: string): Promise<{ ok: boolean; balance: number }> {
  if (amount <= 0) { const c = await getCredits(userId); return { ok: true, balance: c.balance } }
  await ensure()
  const r = await sql`
    UPDATE user_credits SET balance = balance - ${amount}, updated_at = NOW()
    WHERE user_id = ${userId} AND balance >= ${amount} RETURNING balance`
  if (!r.length) { const c = await getCredits(userId); return { ok: false, balance: c.balance } }
  await record(userId, -amount, reason)
  return { ok: true, balance: Number(r[0].balance) }
}

/** Consume free-tier transcription seconds (rolling 30-day window); false when the 5 min is spent. */
export async function useFreeTranscribe(userId: string, seconds: number): Promise<{ ok: boolean; remaining: number }> {
  await ensure()
  const rows = await sql`SELECT free_transcribe_used, free_cycle_start FROM user_credits WHERE user_id = ${userId}`
  const now = Date.now()
  const cycleStart = rows.length && rows[0].free_cycle_start ? new Date(rows[0].free_cycle_start).getTime() : 0
  const expired = !cycleStart || now - cycleStart > 30 * 864e5
  const used = expired ? 0 : Number(rows[0]?.free_transcribe_used ?? 0)
  if (used + seconds > FREE_TRANSCRIBE_SECONDS) return { ok: false, remaining: Math.max(0, FREE_TRANSCRIBE_SECONDS - used) }
  await sql`
    INSERT INTO user_credits (user_id, free_transcribe_used, free_cycle_start) VALUES (${userId}, ${seconds}, NOW())
    ON CONFLICT (user_id) DO UPDATE SET
      free_transcribe_used = ${expired ? seconds : used + seconds},
      free_cycle_start = ${expired ? new Date(now).toISOString() : new Date(cycleStart).toISOString()},
      updated_at = NOW()`
  return { ok: true, remaining: FREE_TRANSCRIBE_SECONDS - (used + seconds) }
}

/**
 * The one call an AI endpoint makes before doing paid work. Deducts `credits`; on an empty balance
 * returns ok:false so the route can answer 402 + prompt an upgrade/top-up. `freeSeconds` (optional)
 * lets transcription spend the free allowance first for free users.
 */
export async function meterAI(userId: string, credits: number, reason: string): Promise<{ ok: boolean; balance: number }> {
  return spendCredits(userId, credits, reason)
}
