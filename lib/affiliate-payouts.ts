import { stripe } from '@/lib/stripe'
import { sql } from '@/lib/db'
import { normalizeCode } from '@/lib/codes'
import { looksLikeEmail } from '@/lib/email'
import { ensureAffiliateTables, recordPayout, affiliateOwed, listAffiliates } from '@/lib/affiliates'

// Automated affiliate payouts via Stripe Connect — V2 "recipient" accounts.
//
// An affiliate is a payee, not a merchant: they receive funds, never process
// charges. So we create a V2 account with only the `recipient` configuration
// (stripe_transfers capability). They onboard through Stripe-hosted pages
// (KYC + bank), and we pay them with a plain Transfer from the platform balance
// — recorded in the existing payout ledger so owed / paid / YTD / 1099 stay
// correct. Stripe issues their 1099-Ks. Readiness updates arrive as V2 thin
// events (see app/api/webhook/stripe-connect); we cache it on the affiliate row
// so the admin panel never has to hit Stripe per render.
//
// Every Stripe call is wrapped so a failure (e.g. Connect not enabled yet)
// surfaces as a clear error string and never moves money by surprise.

const RETURN_URL = 'https://100lights.com/creators/payouts/done'
const REFRESH_URL = 'https://100lights.com/creators/payouts/start'

export interface ConnectStatus {
  accountId: string | null
  payoutsEnabled: boolean
  /** Requirements gate: 'currently_due' | 'past_due' | null (null = clear). */
  requirements: string | null
}

export async function getConnectStatus(code: string): Promise<ConnectStatus | null> {
  await ensureAffiliateTables()
  const rows = await sql`
    SELECT stripe_account_id, connect_payouts_enabled, connect_requirements
    FROM affiliates WHERE code = ${normalizeCode(code)}
  `
  if (rows.length === 0) return null
  return {
    accountId: (rows[0].stripe_account_id as string) ?? null,
    payoutsEnabled: Boolean(rows[0].connect_payouts_enabled),
    requirements: (rows[0].connect_requirements as string) ?? null,
  }
}

/** Create (or reuse) the affiliate's V2 recipient account; returns its id. */
async function getOrCreateConnectAccount(code: string): Promise<string> {
  await ensureAffiliateTables()
  const c = normalizeCode(code)
  const rows = await sql`SELECT stripe_account_id, name, contact FROM affiliates WHERE code = ${c}`
  if (rows.length === 0) throw new Error('Unknown affiliate.')
  const existing = rows[0].stripe_account_id as string | null
  if (existing) return existing

  const contact = rows[0].contact as string | null
  const account = await stripe.v2.core.accounts.create({
    display_name: (rows[0].name as string) || c,
    ...(looksLikeEmail(contact) ? { contact_email: contact! } : {}),
    identity: { country: 'us' },
    dashboard: 'express',
    defaults: { responsibilities: { fees_collector: 'application', losses_collector: 'application' } },
    configuration: { recipient: { capabilities: { stripe_balance: { stripe_transfers: { requested: true } } } } },
    metadata: { affiliate_code: c },
  })
  await sql`UPDATE affiliates SET stripe_account_id = ${account.id}, connect_updated_at = NOW() WHERE code = ${c}`
  return account.id
}

/** A Stripe-hosted onboarding URL the affiliate visits to link their bank + verify. */
export async function connectOnboardingLink(code: string): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  try {
    const account = await getOrCreateConnectAccount(code)
    const link = await stripe.v2.core.accountLinks.create({
      account,
      use_case: {
        type: 'account_onboarding',
        account_onboarding: { configurations: ['recipient'], refresh_url: REFRESH_URL, return_url: RETURN_URL },
      },
    })
    return { ok: true, url: link.url }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not start onboarding.' }
  }
}

/**
 * Re-read a connected account from Stripe and cache its payout readiness.
 * Called from the thin-event webhook (requirements / capability changes) and on
 * demand. Best-effort — never throws.
 */
export async function syncConnectAccount(accountId: string): Promise<void> {
  try {
    await ensureAffiliateTables()
    const account = await stripe.v2.core.accounts.retrieve(accountId, {
      include: ['configuration.recipient', 'requirements'],
    })
    const ready = account.configuration?.recipient?.capabilities?.stripe_balance?.stripe_transfers?.status === 'active'
    const requirements = account.requirements?.summary?.minimum_deadline?.status ?? null
    await sql`
      UPDATE affiliates SET
        connect_payouts_enabled = ${ready},
        connect_requirements = ${requirements},
        connect_updated_at = NOW()
      WHERE stripe_account_id = ${accountId}
    `
  } catch { /* non-critical */ }
}

export type PayResult = { ok: true; amount: number; transferId: string } | { ok: false; error: string }

/** Pay one affiliate their full outstanding balance via a Connect transfer. */
export async function payAffiliateViaConnect(code: string): Promise<PayResult> {
  const c = normalizeCode(code)
  const status = await getConnectStatus(c)
  if (!status?.accountId) return { ok: false, error: 'No payout account connected yet.' }
  if (!status.payoutsEnabled) return { ok: false, error: 'Payout account isn’t ready (onboarding incomplete).' }

  const owed = await affiliateOwed(c)
  if (owed <= 0) return { ok: false, error: 'Nothing outstanding.' }

  try {
    // Recipient accounts are paid with a standard transfer to the acct_ id
    // (Separate Charges & Transfers). This is unchanged from the V1 model.
    const transfer = await stripe.transfers.create({
      amount: Math.round(owed * 100),
      currency: 'usd',
      destination: status.accountId,
      metadata: { affiliate_code: c },
    })
    await recordPayout({ code: c, amount: owed, method: 'stripe', note: transfer.id })
    return { ok: true, amount: owed, transferId: transfer.id }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Transfer failed.' }
  }
}

export interface BatchPayResult {
  paid: Array<{ code: string; amount: number }>
  skipped: Array<{ code: string; reason: string }>
  totalPaid: number
}

/** Pay every affiliate with a positive balance and a ready Connect account. */
export async function payAllOwedViaConnect(): Promise<BatchPayResult> {
  const affiliates = await listAffiliates()
  const paid: BatchPayResult['paid'] = []
  const skipped: BatchPayResult['skipped'] = []
  for (const a of affiliates) {
    if (a.owed <= 0) continue
    if (!a.connectReady) { skipped.push({ code: a.code, reason: 'no payout account' }); continue }
    const r = await payAffiliateViaConnect(a.code)
    if (r.ok) paid.push({ code: a.code, amount: r.amount })
    else skipped.push({ code: a.code, reason: r.error })
  }
  return { paid, skipped, totalPaid: Math.round(paid.reduce((s, p) => s + p.amount, 0) * 100) / 100 }
}
