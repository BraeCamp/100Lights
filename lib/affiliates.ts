import { sql } from '@/lib/db'
import { ensureCodeTables, normalizeCode } from '@/lib/codes'
import { getProPrice } from '@/lib/stripe'

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
}

export interface AffiliateStats extends Affiliate {
  /** Attributed signups — users who redeemed this code. */
  referrals: number
  /** Referrals currently on a paid Stripe plan. */
  converted: number
  /** Estimated commission owed per month while current paid referrals stay subscribed (USD). */
  estMonthly: number
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
  ready = true
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
    INSERT INTO affiliates (code, name, contact, commission_pct, commission_months, perk_days)
    VALUES (${code}, ${name}, ${input.contact ?? null}, ${commissionPct}, ${commissionMonths}, ${perkDays})
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

  return affs.map(a => {
    const s = byCode.get(a.code) ?? { referrals: 0, converted: 0 }
    const estMonthly = Math.round(s.converted * monthlyPrice * (a.commissionPct / 100) * 100) / 100
    return { ...a, referrals: s.referrals, converted: s.converted, estMonthly }
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
  })
  return { ...result, emailed }
}

export async function declineApplication(id: string): Promise<void> {
  await ensureAffiliateTables()
  await sql`UPDATE affiliate_applications SET status = 'declined' WHERE id = ${id}`
}
