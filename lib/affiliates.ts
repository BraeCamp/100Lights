import { randomBytes } from 'crypto'
import { sql } from '@/lib/db'
import { ensureCodeTables, normalizeCode } from '@/lib/codes'
import { getProPrice } from '@/lib/stripe'
import { encryptField, fieldEncryptionAvailable } from '@/lib/crypto-field'

// ── Affiliate (creator referral) program ─────────────────────────────────────
// An affiliate is a creator who shares a referral link (100lights.com/?ref=CODE)
// or a bare CODE. The code is ALSO a `promo` redemption code (see lib/codes.ts):
// redeeming it grants the new user bonus Pro time (the perk) AND records the
// signup in `code_redemptions` — which is our attribution ledger. Commission is
// a recurring % of the Pro price for every referred user who is actively paying.
//
// This layer owns only the affiliate metadata + the reporting joins; the perk
// grant and attribution reuse the existing, battle-tested codes machinery.

export interface Affiliate {
  code: string
  name: string
  contact: string | null
  /** Recurring commission as a percent of the referred user's Pro payments, e.g. 20 = 20%. */
  commissionPct: number
  /** How many months each referral earns commission, or null for lifetime. */
  commissionMonths: number | null
  /** Bonus Pro days the referred user receives on signup (the perk). */
  perkDays: number
  active: boolean
  createdAt: string
  /** Whether the affiliate has submitted their W-9 / payee details. */
  w9Received: boolean
  /** Whether a connected Stripe account is ready to receive payouts. */
  connectReady: boolean
}

export interface AffiliateStats extends Affiliate {
  /** Attributed signups — users who redeemed this code. */
  referrals: number
  /** Referrals currently on a paid Stripe plan. */
  converted: number
  /** Estimated commission owed per month while current paid referrals stay subscribed (USD). */
  estMonthly: number
  /** Real commission accrued from paid invoices, all-time (USD). */
  accrued: number
  /** Total you've recorded paying this affiliate (USD). */
  paid: number
  /** Outstanding balance = accrued − paid (USD). */
  owed: number
  /** Total paid to this affiliate in the current calendar year (USD). */
  ytdPaid: number
}

export interface CommissionEntry {
  userId: string
  invoice: number       // amount the referred user paid (USD)
  commission: number    // credited to the affiliate (USD)
  invoiceAt: string
}

export interface PayoutEntry {
  id: string
  amount: number        // USD
  method: string | null
  note: string | null
  paidAt: string
}

export interface AffiliateReferral {
  userId: string
  redeemedAt: string
  paying: boolean
}

const DEFAULT_PERK_DAYS = 14
const DEFAULT_COMMISSION_PCT = 20

/** The current "Founding Affiliate" beta offer — used when approving applicants. */
export const BETA_TERMS = { commissionPct: 30, commissionMonths: 12, perkDays: 30 }

let ready = false
export async function ensureAffiliateTables(): Promise<void> {
  if (ready) return
  await ensureCodeTables() // affiliates reference redemption_codes + code_redemptions
  await sql`
    CREATE TABLE IF NOT EXISTS affiliates (
      code              TEXT        PRIMARY KEY,
      name              TEXT        NOT NULL,
      contact           TEXT,
      commission_pct    NUMERIC     NOT NULL DEFAULT 20,
      commission_months INTEGER,
      perk_days         INTEGER     NOT NULL DEFAULT 14,
      active            BOOLEAN     NOT NULL DEFAULT TRUE,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  // Inbound applications from the public /creators page. Approving one mints an
  // affiliate (and its code); declining just archives the row.
  await sql`
    CREATE TABLE IF NOT EXISTS affiliate_applications (
      id          BIGSERIAL   PRIMARY KEY,
      name        TEXT        NOT NULL,
      contact     TEXT        NOT NULL,
      platform    TEXT,
      audience    TEXT,
      links       TEXT,
      note        TEXT,
      status      TEXT        NOT NULL DEFAULT 'pending',
      code        TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  // Accrual ledger — one row per referred user's paid Stripe invoice, crediting
  // the affiliate their % of the real amount paid. UNIQUE(invoice) makes webhook
  // replays idempotent. Amounts in cents.
  await sql`
    CREATE TABLE IF NOT EXISTS affiliate_commissions (
      id                BIGSERIAL   PRIMARY KEY,
      code              TEXT        NOT NULL,
      user_id           TEXT        NOT NULL,
      stripe_invoice_id TEXT        NOT NULL UNIQUE,
      invoice_cents     INTEGER     NOT NULL,
      commission_cents  INTEGER     NOT NULL,
      currency          TEXT        NOT NULL DEFAULT 'usd',
      invoice_at        TIMESTAMPTZ NOT NULL,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  await sql`CREATE INDEX IF NOT EXISTS affiliate_commissions_code_idx ON affiliate_commissions (code)`
  await sql`CREATE INDEX IF NOT EXISTS affiliate_commissions_code_user_idx ON affiliate_commissions (code, user_id)`
  // Payout log — payments you've actually sent an affiliate. Amounts in cents.
  await sql`
    CREATE TABLE IF NOT EXISTS affiliate_payouts (
      id          BIGSERIAL   PRIMARY KEY,
      code        TEXT        NOT NULL,
      amount_cents INTEGER    NOT NULL,
      method      TEXT,
      note        TEXT,
      paid_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  await sql`CREATE INDEX IF NOT EXISTS affiliate_payouts_code_idx ON affiliate_payouts (code)`
  // Tax / W-9 fields on the affiliate (additive — never stores a raw TIN unless
  // AFFILIATE_TAX_KEY is set, in which case tin_enc holds it encrypted).
  await sql`ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS tax_token TEXT`
  await sql`ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS legal_name TEXT`
  await sql`ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS business_name TEXT`
  await sql`ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS tax_address TEXT`
  await sql`ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS tax_city TEXT`
  await sql`ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS tax_state TEXT`
  await sql`ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS tax_zip TEXT`
  await sql`ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS tax_class TEXT`
  await sql`ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS tin_last4 TEXT`
  await sql`ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS tin_enc TEXT`
  await sql`ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS w9_received_at TIMESTAMPTZ`
  await sql`ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS tax_updated_at TIMESTAMPTZ`
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS affiliates_tax_token_idx ON affiliates (tax_token) WHERE tax_token IS NOT NULL`
  // Stripe Connect payout account (Tier 2 — automated payouts).
  await sql`ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS stripe_account_id TEXT`
  await sql`ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS connect_payouts_enabled BOOLEAN NOT NULL DEFAULT FALSE`
  await sql`ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS connect_details_submitted BOOLEAN NOT NULL DEFAULT FALSE`
  await sql`ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS connect_requirements TEXT`
  await sql`ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS connect_updated_at TIMESTAMPTZ`
  await sql`CREATE INDEX IF NOT EXISTS affiliates_stripe_account_idx ON affiliates (stripe_account_id) WHERE stripe_account_id IS NOT NULL`
  ready = true
}

/** Outstanding balance for one affiliate (accrued − paid), in USD. */
export async function affiliateOwed(code: string): Promise<number> {
  await ensureAffiliateTables()
  const c = normalizeCode(code)
  const [acc, paid] = await Promise.all([
    sql`SELECT COALESCE(SUM(commission_cents), 0)::bigint AS cents FROM affiliate_commissions WHERE code = ${c}`,
    sql`SELECT COALESCE(SUM(amount_cents), 0)::bigint AS cents FROM affiliate_payouts WHERE code = ${c}`,
  ])
  return Math.round(Number(acc[0].cents) - Number(paid[0].cents)) / 100
}

/** Unguessable token for an affiliate's self-service W-9 link; created on demand. */
function newTaxToken(): string {
  return randomBytes(18).toString('base64url')
}

function mapAffiliate(r: Record<string, unknown>): Affiliate {
  return {
    code: r.code as string,
    name: r.name as string,
    contact: (r.contact as string) ?? null,
    commissionPct: Number(r.commission_pct),
    commissionMonths: r.commission_months == null ? null : Number(r.commission_months),
    perkDays: Number(r.perk_days),
    active: Boolean(r.active),
    createdAt: (r.created_at as Date | string).toString(),
    w9Received: r.w9_received_at != null,
    connectReady: Boolean(r.connect_payouts_enabled),
  }
}

export type CreateAffiliateResult =
  | { ok: true; affiliate: Affiliate; emailed?: boolean }
  | { ok: false; error: string }

/**
 * Create an affiliate + its backing promo code in one shot. The code grants
 * `perkDays` of Pro to anyone who redeems it, and every redemption is
 * attributed to this affiliate for commission.
 */
export async function createAffiliate(input: {
  code: string
  name: string
  contact?: string | null
  commissionPct?: number
  commissionMonths?: number | null
  perkDays?: number
}): Promise<CreateAffiliateResult> {
  await ensureAffiliateTables()
  const code = normalizeCode(input.code)
  const name = (input.name || '').trim()
  if (!code) return { ok: false, error: 'A referral code is required.' }
  if (!/^[A-Z0-9]{3,32}$/.test(code)) return { ok: false, error: 'Code must be 3–32 letters/numbers (no spaces or symbols).' }
  if (!name) return { ok: false, error: 'An affiliate name is required.' }

  const perkDays = Math.max(0, Math.round(input.perkDays ?? DEFAULT_PERK_DAYS))
  const commissionPct = Math.max(0, Math.min(100, input.commissionPct ?? DEFAULT_COMMISSION_PCT))
  const commissionMonths = input.commissionMonths == null ? null : Math.max(1, Math.round(input.commissionMonths))

  // Guard against colliding with an existing code (affiliate or plain promo).
  const existing = await sql`SELECT 1 FROM redemption_codes WHERE code = ${code}`
  if (existing.length > 0) return { ok: false, error: 'That code is already in use.' }

  // Backing promo code delivers the perk + writes the attribution row on redeem.
  await sql`
    INSERT INTO redemption_codes (code, kind, grant_days, active, max_redemptions, note)
    VALUES (${code}, 'promo', ${perkDays}, TRUE, NULL, ${'Affiliate: ' + name})
  `
  await sql`
    INSERT INTO affiliates (code, name, contact, commission_pct, commission_months, perk_days, tax_token)
    VALUES (${code}, ${name}, ${input.contact ?? null}, ${commissionPct}, ${commissionMonths}, ${perkDays}, ${newTaxToken()})
  `
  const rows = await sql`SELECT * FROM affiliates WHERE code = ${code}`
  return { ok: true, affiliate: mapAffiliate(rows[0]) }
}

export async function setAffiliateActive(code: string, active: boolean): Promise<void> {
  await ensureAffiliateTables()
  const c = normalizeCode(code)
  // Disabling an affiliate also disables its code so no new signups attribute to it.
  await sql`UPDATE affiliates SET active = ${active} WHERE code = ${c}`
  await sql`UPDATE redemption_codes SET active = ${active} WHERE code = ${c}`
}

/** List affiliates with live referral / conversion / commission stats. */
export async function listAffiliates(): Promise<AffiliateStats[]> {
  await ensureAffiliateTables()
  const affs = (await sql`SELECT * FROM affiliates ORDER BY created_at DESC`).map(mapAffiliate)
  if (affs.length === 0) return []

  const codes = affs.map(a => a.code)
  const statRows = await sql`
    SELECT r.code,
           COUNT(DISTINCT r.user_id)::int AS referrals,
           COUNT(DISTINCT r.user_id) FILTER (
             WHERE s.stripe_sub_id IS NOT NULL AND s.plan = 'pro'
               AND s.status IN ('active', 'trialing')
           )::int AS converted
    FROM code_redemptions r
    LEFT JOIN subscriptions s ON s.user_id = r.user_id
    WHERE r.code = ANY(${codes})
    GROUP BY r.code
  `
  const byCode = new Map<string, { referrals: number; converted: number }>()
  for (const row of statRows) {
    byCode.set(row.code as string, { referrals: Number(row.referrals), converted: Number(row.converted) })
  }

  // Monthly Pro price (dollars) drives the recurring-% estimate. Fail soft to 0
  // so the panel still renders if Stripe is briefly unreachable.
  let monthlyPrice = 0
  try {
    monthlyPrice = (await getProPrice('monthly')).amount / 100
  } catch { /* leave estimate at 0 */ }

  // Real balances from the accrual ledger + payout log (cents → dollars).
  const [accRows, payRows, ytdRows] = await Promise.all([
    sql`SELECT code, COALESCE(SUM(commission_cents), 0)::bigint AS cents FROM affiliate_commissions WHERE code = ANY(${codes}) GROUP BY code`,
    sql`SELECT code, COALESCE(SUM(amount_cents), 0)::bigint AS cents FROM affiliate_payouts WHERE code = ANY(${codes}) GROUP BY code`,
    sql`SELECT code, COALESCE(SUM(amount_cents), 0)::bigint AS cents FROM affiliate_payouts WHERE code = ANY(${codes}) AND paid_at >= date_trunc('year', NOW()) GROUP BY code`,
  ])
  const accByCode = new Map(accRows.map(r => [r.code as string, Number(r.cents) / 100]))
  const paidByCode = new Map(payRows.map(r => [r.code as string, Number(r.cents) / 100]))
  const ytdByCode = new Map(ytdRows.map(r => [r.code as string, Number(r.cents) / 100]))

  return affs.map(a => {
    const s = byCode.get(a.code) ?? { referrals: 0, converted: 0 }
    const estMonthly = Math.round(s.converted * monthlyPrice * (a.commissionPct / 100) * 100) / 100
    const accrued = accByCode.get(a.code) ?? 0
    const paid = paidByCode.get(a.code) ?? 0
    const owed = Math.round((accrued - paid) * 100) / 100
    const ytdPaid = ytdByCode.get(a.code) ?? 0
    return { ...a, referrals: s.referrals, converted: s.converted, estMonthly, accrued, paid, owed, ytdPaid }
  })
}

/** Per-affiliate breakdown of referred users for the detail view. */
export async function affiliateReferrals(code: string): Promise<AffiliateReferral[]> {
  await ensureAffiliateTables()
  const c = normalizeCode(code)
  const rows = await sql`
    SELECT r.user_id, r.redeemed_at,
           (s.stripe_sub_id IS NOT NULL AND s.plan = 'pro'
            AND s.status IN ('active', 'trialing')) AS paying
    FROM code_redemptions r
    LEFT JOIN subscriptions s ON s.user_id = r.user_id
    WHERE r.code = ${c}
    ORDER BY r.redeemed_at DESC
  `
  return rows.map(r => ({
    userId: r.user_id as string,
    redeemedAt: (r.redeemed_at as Date | string).toString(),
    paying: Boolean(r.paying),
  }))
}

// ── Applications (public /creators page → admin approval) ────────────────────

export type ApplicationStatus = 'pending' | 'approved' | 'declined'

export interface AffiliateApplication {
  id: string
  name: string
  contact: string
  platform: string | null
  audience: string | null
  links: string | null
  note: string | null
  status: ApplicationStatus
  code: string | null
  createdAt: string
}

function mapApplication(r: Record<string, unknown>): AffiliateApplication {
  return {
    id: String(r.id),
    name: r.name as string,
    contact: r.contact as string,
    platform: (r.platform as string) ?? null,
    audience: (r.audience as string) ?? null,
    links: (r.links as string) ?? null,
    note: (r.note as string) ?? null,
    status: r.status as ApplicationStatus,
    code: (r.code as string) ?? null,
    createdAt: (r.created_at as Date | string).toString(),
  }
}

const clip = (s: unknown, max: number): string | null => {
  const v = (typeof s === 'string' ? s : '').trim()
  return v ? v.slice(0, max) : null
}

/** Public: record an inbound affiliate application (pending review). */
export async function submitApplication(input: {
  name?: string; contact?: string; platform?: string
  audience?: string; links?: string; note?: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  await ensureAffiliateTables()
  const name = clip(input.name, 120)
  const contact = clip(input.contact, 200)
  if (!name) return { ok: false, error: 'Please add your name or handle.' }
  if (!contact) return { ok: false, error: 'Please add an email or handle so we can reach you.' }
  await sql`
    INSERT INTO affiliate_applications (name, contact, platform, audience, links, note)
    VALUES (${name}, ${contact}, ${clip(input.platform, 40)}, ${clip(input.audience, 60)},
            ${clip(input.links, 500)}, ${clip(input.note, 1000)})
  `
  return { ok: true }
}

export async function listApplications(): Promise<AffiliateApplication[]> {
  await ensureAffiliateTables()
  // Pending first, then most recent.
  const rows = await sql`
    SELECT * FROM affiliate_applications
    ORDER BY (status = 'pending') DESC, created_at DESC
  `
  return rows.map(mapApplication)
}

/** Approve an application → mint the affiliate + its code on the beta terms. */
export async function approveApplication(id: string, code?: string): Promise<CreateAffiliateResult> {
  await ensureAffiliateTables()
  const rows = await sql`SELECT * FROM affiliate_applications WHERE id = ${id}`
  if (rows.length === 0) return { ok: false, error: 'Application not found.' }
  const app = mapApplication(rows[0])
  if (app.status === 'approved') return { ok: false, error: 'Already approved.' }

  // Derive a code from their name if the admin didn't type one.
  const desired = normalizeCode(code || app.name)
  const result = await createAffiliate({
    code: desired,
    name: app.name,
    contact: app.contact,
    commissionPct: BETA_TERMS.commissionPct,
    commissionMonths: BETA_TERMS.commissionMonths,
    perkDays: BETA_TERMS.perkDays,
  })
  if (!result.ok) return result
  await sql`UPDATE affiliate_applications SET status = 'approved', code = ${result.affiliate.code} WHERE id = ${id}`

  // Best-effort welcome email with their link + the deal. No-ops when email is
  // disabled or the applicant gave a social handle instead of an address; the
  // `emailed` flag tells the admin whether to follow up by hand.
  const { sendAffiliateApprovalEmail } = await import('@/lib/email')
  const emailed = await sendAffiliateApprovalEmail({
    to: app.contact,
    name: result.affiliate.name,
    code: result.affiliate.code,
    commissionPct: result.affiliate.commissionPct,
    commissionMonths: result.affiliate.commissionMonths,
    perkDays: result.affiliate.perkDays,
    taxToken: await getOrCreateTaxToken(result.affiliate.code),
  })
  return { ...result, emailed }
}

export async function declineApplication(id: string): Promise<void> {
  await ensureAffiliateTables()
  await sql`UPDATE affiliate_applications SET status = 'declined' WHERE id = ${id}`
}

// ── Commission accrual (Stripe invoice.paid → real earnings) ─────────────────

interface Referrer { code: string; commissionPct: number; commissionMonths: number | null }

/**
 * The affiliate that gets credit for a user's payments: first-touch — the
 * earliest affiliate code they redeemed. Returns null if they weren't referred.
 */
async function resolveReferrer(userId: string): Promise<Referrer | null> {
  const rows = await sql`
    SELECT a.code, a.commission_pct, a.commission_months
    FROM code_redemptions r
    JOIN affiliates a ON a.code = r.code
    WHERE r.user_id = ${userId}
    ORDER BY r.redeemed_at ASC
    LIMIT 1
  `
  if (rows.length === 0) return null
  const r = rows[0]
  return {
    code: r.code as string,
    commissionPct: Number(r.commission_pct),
    commissionMonths: r.commission_months == null ? null : Number(r.commission_months),
  }
}

/** Whole calendar months between two dates (a ≤ b). */
function monthsBetween(a: Date, b: Date): number {
  let m = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth())
  if (b.getUTCDate() < a.getUTCDate()) m -= 1
  return Math.max(0, m)
}

/**
 * Credit an affiliate their commission on a referred user's paid invoice.
 * Idempotent (UNIQUE invoice), and respects the commission-month window: the
 * clock starts at the referral's first credited invoice. No-ops when the user
 * wasn't referred, the window has closed, or nothing was actually paid.
 */
export async function recordInvoiceCommission(input: {
  userId: string; invoiceId: string; amountPaidCents: number; currency?: string; invoiceAt: Date
}): Promise<void> {
  const { userId, invoiceId, amountPaidCents, invoiceAt } = input
  if (!userId || !invoiceId || !Number.isFinite(amountPaidCents) || amountPaidCents <= 0) return
  try {
    await ensureAffiliateTables()
    const ref = await resolveReferrer(userId)
    if (!ref) return

    if (ref.commissionMonths != null) {
      const startRows = await sql`
        SELECT MIN(invoice_at) AS start FROM affiliate_commissions
        WHERE code = ${ref.code} AND user_id = ${userId}
      `
      const start = startRows[0]?.start ? new Date(startRows[0].start as string) : invoiceAt
      if (monthsBetween(start, invoiceAt) >= ref.commissionMonths) return // window closed
    }

    const commissionCents = Math.round(amountPaidCents * (ref.commissionPct / 100))
    if (commissionCents <= 0) return

    await sql`
      INSERT INTO affiliate_commissions (code, user_id, stripe_invoice_id, invoice_cents, commission_cents, currency, invoice_at)
      VALUES (${ref.code}, ${userId}, ${invoiceId}, ${Math.round(amountPaidCents)}, ${commissionCents}, ${input.currency ?? 'usd'}, ${invoiceAt.toISOString()})
      ON CONFLICT (stripe_invoice_id) DO NOTHING
    `
  } catch { /* commission tracking is best-effort — never fail the webhook */ }
}

// ── Payouts (recording what you've actually paid affiliates) ─────────────────

export async function recordPayout(input: {
  code: string; amount: number; method?: string | null; note?: string | null
}): Promise<{ ok: true } | { ok: false; error: string }> {
  await ensureAffiliateTables()
  const code = normalizeCode(input.code)
  const cents = Math.round((Number(input.amount) || 0) * 100)
  if (cents <= 0) return { ok: false, error: 'Enter a positive amount.' }
  const exists = await sql`SELECT 1 FROM affiliates WHERE code = ${code}`
  if (exists.length === 0) return { ok: false, error: 'Unknown affiliate.' }
  await sql`
    INSERT INTO affiliate_payouts (code, amount_cents, method, note)
    VALUES (${code}, ${cents}, ${input.method?.trim() || null}, ${input.note?.trim() || null})
  `
  return { ok: true }
}

/** Recent commission ledger entries for one affiliate. */
export async function affiliateLedger(code: string, limit = 50): Promise<CommissionEntry[]> {
  await ensureAffiliateTables()
  const rows = await sql`
    SELECT user_id, invoice_cents, commission_cents, invoice_at
    FROM affiliate_commissions WHERE code = ${normalizeCode(code)}
    ORDER BY invoice_at DESC LIMIT ${limit}
  `
  return rows.map(r => ({
    userId: r.user_id as string,
    invoice: Number(r.invoice_cents) / 100,
    commission: Number(r.commission_cents) / 100,
    invoiceAt: (r.invoice_at as Date | string).toString(),
  }))
}

export async function listPayouts(code: string): Promise<PayoutEntry[]> {
  await ensureAffiliateTables()
  const rows = await sql`
    SELECT id, amount_cents, method, note, paid_at
    FROM affiliate_payouts WHERE code = ${normalizeCode(code)}
    ORDER BY paid_at DESC
  `
  return rows.map(r => ({
    id: String(r.id),
    amount: Number(r.amount_cents) / 100,
    method: (r.method as string) ?? null,
    note: (r.note as string) ?? null,
    paidAt: (r.paid_at as Date | string).toString(),
  }))
}

/** One-click: log a payout for the exact outstanding balance. */
export async function markFullyPaid(code: string, method?: string | null): Promise<{ ok: true; amount: number } | { ok: false; error: string }> {
  await ensureAffiliateTables()
  const c = normalizeCode(code)
  const [acc, paid] = await Promise.all([
    sql`SELECT COALESCE(SUM(commission_cents), 0)::bigint AS cents FROM affiliate_commissions WHERE code = ${c}`,
    sql`SELECT COALESCE(SUM(amount_cents), 0)::bigint AS cents FROM affiliate_payouts WHERE code = ${c}`,
  ])
  const owed = Math.round((Number(acc[0].cents) - Number(paid[0].cents))) / 100
  if (owed <= 0) return { ok: false, error: 'Nothing outstanding.' }
  const r = await recordPayout({ code: c, amount: owed, method: method || 'marked fully paid', note: null })
  if (!r.ok) return r
  return { ok: true, amount: owed }
}

// ── W-9 / tax details (self-service) ─────────────────────────────────────────

export const TAX_CLASSES = [
  'Individual / sole proprietor',
  'Single-member LLC',
  'LLC — taxed as C corp',
  'LLC — taxed as S corp',
  'Partnership',
  'C corporation',
  'S corporation',
  'Other',
]

export interface AffiliateTax {
  legalName: string | null
  businessName: string | null
  address: string | null
  city: string | null
  state: string | null
  zip: string | null
  taxClass: string | null
  tinLast4: string | null
  w9Received: boolean
  hasEncryptedTin: boolean
}

function mapTax(r: Record<string, unknown>): AffiliateTax {
  return {
    legalName: (r.legal_name as string) ?? null,
    businessName: (r.business_name as string) ?? null,
    address: (r.tax_address as string) ?? null,
    city: (r.tax_city as string) ?? null,
    state: (r.tax_state as string) ?? null,
    zip: (r.tax_zip as string) ?? null,
    taxClass: (r.tax_class as string) ?? null,
    tinLast4: (r.tin_last4 as string) ?? null,
    w9Received: r.w9_received_at != null,
    hasEncryptedTin: r.tin_enc != null,
  }
}

/** The self-service W-9 link token for an affiliate (created on demand). */
export async function getOrCreateTaxToken(code: string): Promise<string | null> {
  await ensureAffiliateTables()
  const c = normalizeCode(code)
  const rows = await sql`SELECT tax_token FROM affiliates WHERE code = ${c}`
  if (rows.length === 0) return null
  let token = rows[0].tax_token as string | null
  if (!token) { token = newTaxToken(); await sql`UPDATE affiliates SET tax_token = ${token} WHERE code = ${c}` }
  return token
}

/** Public: resolve a tax-form token to the affiliate + whether we retain TINs. */
export async function affiliateTaxContext(token: string): Promise<{ code: string; name: string; storeTin: boolean; existing: AffiliateTax; connectReady: boolean; connectStarted: boolean } | null> {
  if (!token) return null
  await ensureAffiliateTables()
  const rows = await sql`SELECT * FROM affiliates WHERE tax_token = ${token}`
  if (rows.length === 0) return null
  return {
    code: rows[0].code as string,
    name: rows[0].name as string,
    storeTin: fieldEncryptionAvailable(),
    existing: mapTax(rows[0]),
    connectReady: Boolean(rows[0].connect_payouts_enabled),
    connectStarted: rows[0].stripe_account_id != null,
  }
}

/** Public: an affiliate submits their W-9 / payee details via their token. */
export async function saveAffiliateTaxByToken(token: string, input: {
  legalName?: string; businessName?: string; address?: string; city?: string
  state?: string; zip?: string; taxClass?: string; tin?: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  await ensureAffiliateTables()
  const rows = await sql`SELECT code FROM affiliates WHERE tax_token = ${token}`
  if (rows.length === 0) return { ok: false, error: 'This link is invalid or expired.' }
  const legalName = (input.legalName || '').trim()
  const address = (input.address || '').trim()
  if (!legalName) return { ok: false, error: 'Your legal name is required.' }
  if (!address) return { ok: false, error: 'A mailing address is required.' }

  // TIN is only retained when field encryption is configured; otherwise we keep
  // just the non-sensitive details and the e-file service collects the TIN.
  let encTin: string | null = null
  let last4: string | null = null
  const digits = (input.tin || '').replace(/\D/g, '')
  if (digits && fieldEncryptionAvailable()) {
    encTin = encryptField(digits)
    last4 = digits.slice(-4)
  }

  await sql`
    UPDATE affiliates SET
      legal_name = ${legalName},
      business_name = ${(input.businessName || '').trim() || null},
      tax_address = ${address},
      tax_city = ${(input.city || '').trim() || null},
      tax_state = ${(input.state || '').trim() || null},
      tax_zip = ${(input.zip || '').trim() || null},
      tax_class = ${(input.taxClass || '').trim() || null},
      tin_enc = COALESCE(${encTin}, tin_enc),
      tin_last4 = COALESCE(${last4}, tin_last4),
      w9_received_at = COALESCE(w9_received_at, NOW()),
      tax_updated_at = NOW()
    WHERE tax_token = ${token}
  `
  return { ok: true }
}

export async function getAffiliateTax(code: string): Promise<AffiliateTax | null> {
  await ensureAffiliateTables()
  const rows = await sql`SELECT * FROM affiliates WHERE code = ${normalizeCode(code)}`
  return rows.length ? mapTax(rows[0]) : null
}

// ── 1099 / tax report ────────────────────────────────────────────────────────

export interface TaxReportRow {
  code: string
  name: string
  contact: string | null
  legalName: string | null
  businessName: string | null
  address: string
  taxClass: string | null
  ytdPaid: number
  w9Received: boolean
  /** Paid ≥ $600 this year via a method a processor won't report → you must 1099. */
  needs1099: boolean
  /** California: same trigger as needs1099 (EDD DE 542, due within 20 days of $600). */
  de542Due: boolean
  methods: string
}

// A method that a third-party settlement org reports on a 1099-K, so you don't.
function processorCovered(method: string | null | undefined): boolean {
  return /paypal|venmo|stripe|card|credit|cash app/i.test(method || '')
}

/** Per-affiliate 1099 picture for a calendar year (default: current year). */
export async function taxReport(year?: number): Promise<TaxReportRow[]> {
  await ensureAffiliateTables()
  const y = year ?? new Date().getUTCFullYear()
  const affs = await sql`SELECT * FROM affiliates ORDER BY name`
  if (affs.length === 0) return []
  const pays = await sql`
    SELECT code, amount_cents, method FROM affiliate_payouts
    WHERE EXTRACT(YEAR FROM paid_at) = ${y}
  `
  const byCode = new Map<string, { cents: number; methods: Set<string>; selfFile: boolean }>()
  for (const p of pays) {
    const code = p.code as string
    const e = byCode.get(code) ?? { cents: 0, methods: new Set<string>(), selfFile: false }
    e.cents += Number(p.amount_cents)
    if (p.method) e.methods.add(p.method as string)
    // Any non-processor (or unlabeled) payment means the 1099 falls on you.
    if (!processorCovered(p.method as string)) e.selfFile = true
    byCode.set(code, e)
  }

  return affs.map(a => {
    const t = mapTax(a)
    const e = byCode.get(a.code as string) ?? { cents: 0, methods: new Set<string>(), selfFile: false }
    const ytdPaid = e.cents / 100
    const needs1099 = ytdPaid >= 600 && e.selfFile
    return {
      code: a.code as string,
      name: a.name as string,
      contact: (a.contact as string) ?? null,
      legalName: t.legalName,
      businessName: t.businessName,
      address: [t.address, t.city, t.state, t.zip].filter(Boolean).join(', '),
      taxClass: t.taxClass,
      ytdPaid,
      w9Received: t.w9Received,
      needs1099,
      de542Due: needs1099,
      methods: [...e.methods].join(', '),
    }
  }).filter(r => r.ytdPaid > 0)
}
