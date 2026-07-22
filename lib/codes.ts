import { sql } from '@/lib/db'
import crypto from 'crypto'

// ── Redemption codes ──────────────────────────────────────────────────────
// Self-service "gifts": a code grants a user N days of Pro, sitting alongside
// Stripe and admin gifts. Two kinds:
//   • promo   — a user may redeem any number of DIFFERENT active promo codes
//               (each once). Grants stack (extend the free-time window).
//   • starter — entered at signup. A user may EVER redeem only ONE starter code
//               across all of them.
// A code can also cap its own lifetime (expires_at) and total uses
// (max_redemptions). The granted Pro time is read back by getSubscription via
// getCodeGrantUntil(), so every existing plan gate honours it for free.
//
// Access is computed live from code_redemptions (no denormalised column on
// subscriptions), so codes stay fully decoupled from the Stripe/gift layers.

export type CodeKind = 'promo' | 'starter'

export interface RedemptionCode {
  code: string
  kind: CodeKind
  grantDays: number
  active: boolean
  expiresAt: string | null
  maxRedemptions: number | null
  redeemedCount: number
  note: string | null
  createdAt: string
  /** Derived: why the code can't currently be redeemed, or 'active'. */
  status: 'active' | 'disabled' | 'expired' | 'exhausted'
}

export type RedeemResult =
  | { ok: true; kind: CodeKind; grantDays: number; until: string }
  | { ok: false; reason: RedeemFailReason; error: string }

export type RedeemFailReason =
  | 'empty' | 'not_found' | 'disabled' | 'expired'
  | 'exhausted' | 'already_used' | 'starter_used'

// ── Table provisioning (lazy, idempotent — mirrors the codebase convention) ─
let tablesReady = false
export async function ensureCodeTables(): Promise<void> {
  if (tablesReady) return
  await sql`
    CREATE TABLE IF NOT EXISTS redemption_codes (
      code            TEXT        PRIMARY KEY,
      kind            TEXT        NOT NULL DEFAULT 'promo',
      grant_days      INTEGER     NOT NULL,
      active          BOOLEAN     NOT NULL DEFAULT TRUE,
      expires_at      TIMESTAMPTZ,
      max_redemptions INTEGER,
      redeemed_count  INTEGER     NOT NULL DEFAULT 0,
      note            TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  await sql`
    CREATE TABLE IF NOT EXISTS code_redemptions (
      code        TEXT        NOT NULL,
      user_id     TEXT        NOT NULL,
      kind        TEXT        NOT NULL,
      grant_days  INTEGER     NOT NULL,
      grant_until TIMESTAMPTZ NOT NULL,
      redeemed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (code, user_id)
    )
  `
  await sql`CREATE INDEX IF NOT EXISTS code_redemptions_user_idx ON code_redemptions (user_id)`
  await sql`CREATE INDEX IF NOT EXISTS code_redemptions_user_kind_idx ON code_redemptions (user_id, kind)`
  tablesReady = true
}

/** Codes are case-insensitive and whitespace-insensitive; stored uppercase. */
export function normalizeCode(raw: string): string {
  return (raw || '').trim().toUpperCase().replace(/\s+/g, '')
}

function deriveStatus(r: {
  active: boolean; expires_at: string | null; max_redemptions: number | null; redeemed_count: number
}): RedemptionCode['status'] {
  if (!r.active) return 'disabled'
  if (r.expires_at && new Date(r.expires_at) <= new Date()) return 'expired'
  if (r.max_redemptions != null && r.redeemed_count >= r.max_redemptions) return 'exhausted'
  return 'active'
}

// ── Entitlement read (used by getSubscription) ─────────────────────────────
/** The end of the user's active code-granted Pro window, or null if none. */
export async function getCodeGrantUntil(userId: string): Promise<Date | null> {
  try {
    await ensureCodeTables()
    const rows = await sql`
      SELECT MAX(grant_until) AS until
      FROM code_redemptions
      WHERE user_id = ${userId} AND grant_until > NOW()
    `
    const until = rows[0]?.until
    return until ? new Date(until as string) : null
  } catch {
    // Table not provisioned yet / transient error — never break access checks.
    return null
  }
}

// ── Redemption ─────────────────────────────────────────────────────────────
export async function redeemCode(userId: string, rawCode: string): Promise<RedeemResult> {
  await ensureCodeTables()
  const code = normalizeCode(rawCode)
  if (!code) return { ok: false, reason: 'empty', error: 'Enter a code.' }

  const rows = await sql`
    SELECT code, kind, grant_days, active, expires_at, max_redemptions, redeemed_count
    FROM redemption_codes WHERE code = ${code}
  `
  if (rows.length === 0) return { ok: false, reason: 'not_found', error: 'That code doesn’t exist.' }
  const c = rows[0]
  const kind = c.kind as CodeKind
  const grantDays = Number(c.grant_days)

  if (!c.active) return { ok: false, reason: 'disabled', error: 'This code is no longer active.' }
  if (c.expires_at && new Date(c.expires_at as string) <= new Date()) {
    return { ok: false, reason: 'expired', error: 'This code has expired.' }
  }
  if (c.max_redemptions != null && Number(c.redeemed_count) >= Number(c.max_redemptions)) {
    return { ok: false, reason: 'exhausted', error: 'This code has reached its redemption limit.' }
  }

  // Starter codes: one ever, across all starter codes.
  if (kind === 'starter') {
    const used = await sql`
      SELECT 1 FROM code_redemptions WHERE user_id = ${userId} AND kind = 'starter' LIMIT 1
    `
    if (used.length > 0) {
      return { ok: false, reason: 'starter_used', error: 'You’ve already used a starter code.' }
    }
  }

  // Claim the redemption. Insert first (UNIQUE (code,user_id) enforces
  // once-per-user), stacking grant_until from the later of NOW() or the user's
  // current active grant so multiple codes extend the window rather than
  // overlap. ON CONFLICT DO NOTHING => already redeemed.
  const inserted = await sql`
    INSERT INTO code_redemptions (code, user_id, kind, grant_days, grant_until)
    VALUES (
      ${code}, ${userId}, ${kind}, ${grantDays},
      GREATEST(
        NOW(),
        COALESCE(
          (SELECT MAX(grant_until) FROM code_redemptions WHERE user_id = ${userId} AND grant_until > NOW()),
          NOW()
        )
      ) + (${grantDays}::int * INTERVAL '1 day')
    )
    ON CONFLICT (code, user_id) DO NOTHING
    RETURNING grant_until
  `
  if (inserted.length === 0) {
    return { ok: false, reason: 'already_used', error: 'You’ve already used this code.' }
  }

  // Atomically claim a slot on the code itself under the same guards — this is
  // what makes max_redemptions race-safe. If it fails, another redemption won
  // the last slot (or the code was just disabled/expired): roll back our row.
  const claimed = await sql`
    UPDATE redemption_codes
    SET redeemed_count = redeemed_count + 1
    WHERE code = ${code}
      AND active = TRUE
      AND (expires_at IS NULL OR expires_at > NOW())
      AND (max_redemptions IS NULL OR redeemed_count < max_redemptions)
    RETURNING redeemed_count
  `
  if (claimed.length === 0) {
    await sql`DELETE FROM code_redemptions WHERE code = ${code} AND user_id = ${userId}`
    return { ok: false, reason: 'exhausted', error: 'This code just reached its limit.' }
  }

  return { ok: true, kind, grantDays, until: new Date(inserted[0].grant_until as string).toISOString() }
}

/** Has this user ever redeemed a starter code? (drives the signup prompt) */
export async function hasUsedStarterCode(userId: string): Promise<boolean> {
  try {
    await ensureCodeTables()
    const rows = await sql`
      SELECT 1 FROM code_redemptions WHERE user_id = ${userId} AND kind = 'starter' LIMIT 1
    `
    return rows.length > 0
  } catch {
    return false
  }
}

// ── Admin operations ───────────────────────────────────────────────────────
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no ambiguous 0/O/1/I

function randomCode(kind: CodeKind): string {
  const bytes = crypto.randomBytes(8)
  let s = ''
  for (let i = 0; i < 8; i++) s += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length]
  return `${kind === 'starter' ? 'START' : 'PROMO'}-${s}`
}

export async function createCode(input: {
  code?: string | null
  kind: CodeKind
  grantDays: number
  expiresAt?: string | null
  maxRedemptions?: number | null
  note?: string | null
}): Promise<{ ok: true; code: RedemptionCode } | { ok: false; error: string }> {
  await ensureCodeTables()

  const kind: CodeKind = input.kind === 'starter' ? 'starter' : 'promo'
  const grantDays = Math.floor(Number(input.grantDays))
  if (!Number.isFinite(grantDays) || grantDays <= 0) {
    return { ok: false, error: 'Grant days must be a positive whole number.' }
  }
  const maxRedemptions = input.maxRedemptions == null || `${input.maxRedemptions}` === ''
    ? null
    : Math.floor(Number(input.maxRedemptions))
  if (maxRedemptions != null && (!Number.isFinite(maxRedemptions) || maxRedemptions <= 0)) {
    return { ok: false, error: 'Usage limit must be a positive whole number (or blank for unlimited).' }
  }
  let expiresAt: string | null = null
  if (input.expiresAt) {
    const d = new Date(input.expiresAt)
    if (isNaN(d.getTime())) return { ok: false, error: 'Expiry date is invalid.' }
    expiresAt = d.toISOString()
  }

  const code = input.code ? normalizeCode(input.code) : randomCode(kind)
  if (!/^[A-Z0-9][A-Z0-9-]{1,63}$/.test(code)) {
    return { ok: false, error: 'Code must be 2–64 letters, numbers, or dashes.' }
  }

  const rows = await sql`
    INSERT INTO redemption_codes (code, kind, grant_days, expires_at, max_redemptions, note)
    VALUES (${code}, ${kind}, ${grantDays}, ${expiresAt}, ${maxRedemptions}, ${input.note?.trim() || null})
    ON CONFLICT (code) DO NOTHING
    RETURNING code, kind, grant_days, active, expires_at, max_redemptions, redeemed_count, note, created_at
  `
  if (rows.length === 0) return { ok: false, error: 'That code already exists.' }
  return { ok: true, code: rowToCode(rows[0]) }
}

export async function listCodes(): Promise<RedemptionCode[]> {
  await ensureCodeTables()
  const rows = await sql`
    SELECT code, kind, grant_days, active, expires_at, max_redemptions, redeemed_count, note, created_at
    FROM redemption_codes
    ORDER BY created_at DESC
  `
  return rows.map(rowToCode)
}

export async function setCodeActive(code: string, active: boolean): Promise<boolean> {
  await ensureCodeTables()
  const rows = await sql`
    UPDATE redemption_codes SET active = ${active} WHERE code = ${normalizeCode(code)} RETURNING code
  `
  return rows.length > 0
}

export async function deleteCode(code: string): Promise<boolean> {
  await ensureCodeTables()
  // Only removes the code from being redeemable — already-granted time lives in
  // code_redemptions and is intentionally left intact.
  const rows = await sql`DELETE FROM redemption_codes WHERE code = ${normalizeCode(code)} RETURNING code`
  return rows.length > 0
}

function rowToCode(r: Record<string, unknown>): RedemptionCode {
  const base = {
    active: !!r.active,
    expires_at: r.expires_at ? new Date(r.expires_at as string).toISOString() : null,
    max_redemptions: r.max_redemptions == null ? null : Number(r.max_redemptions),
    redeemed_count: Number(r.redeemed_count),
  }
  return {
    code: r.code as string,
    kind: r.kind as CodeKind,
    grantDays: Number(r.grant_days),
    active: base.active,
    expiresAt: base.expires_at,
    maxRedemptions: base.max_redemptions,
    redeemedCount: base.redeemed_count,
    note: (r.note as string | null) ?? null,
    createdAt: new Date(r.created_at as string).toISOString(),
    status: deriveStatus(base),
  }
}
