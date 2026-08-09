import Stripe from 'stripe'
import { ENTITLEMENTS } from './entitlements'

// In dev, prefer the TEST secret key when present so local billing runs entirely in test mode
// (production has no STRIPE_TEST_SECRET_KEY set → uses the live key). Keeps live/test separated.
const stripeKey = (process.env.NODE_ENV !== 'production' && process.env.STRIPE_TEST_SECRET_KEY) || process.env.STRIPE_SECRET_KEY
export const stripe = new Stripe(stripeKey!, { apiVersion: '2026-05-27.dahlia' })

// App-side limits per plan, derived from the single source of truth in
// lib/entitlements.ts. Stripe owns the price/product; entitlements.ts owns the
// feature gates. This shape is kept for existing callers (projectsMax/storageMb).
export const PLAN_LIMITS = {
  free: { storageMb: ENTITLEMENTS.free.storageMb, projectsMax: ENTITLEMENTS.free.projectsMax },
  pro:  { storageMb: ENTITLEMENTS.pro.storageMb,  projectsMax: ENTITLEMENTS.pro.projectsMax  },
} as const

// Legacy alias used by subscription.ts — keeps existing callers working
export const PLANS = {
  free: PLAN_LIMITS.free,
  pro:  { ...PLAN_LIMITS.pro, priceId: '' }, // priceId filled at runtime via getProPrice()
}

// ── Runtime price lookup ─────────────────────────────────────────────────────
// Prices are fetched from Stripe by lookup key so no price ID ever lives in
// env vars or code. To add a new plan: create a Stripe product + price with
// a lookup_key and update PLAN_LIMITS above — no deploy needed for price changes.

export type BillingPeriod = 'monthly' | 'annual'

interface PriceInfo { id: string; productId: string; amount: number; currency: string }

const CACHE_TTL = 5 * 60 * 1000
const _cache: Partial<Record<BillingPeriod, PriceInfo>> = {}
const _cacheExpiry: Partial<Record<BillingPeriod, number>> = {}

export async function getProPrice(period: BillingPeriod = 'monthly'): Promise<PriceInfo> {
  const now = Date.now()
  if (_cache[period] && now < (_cacheExpiry[period] ?? 0)) return _cache[period]!

  const lookupKey = period === 'annual' ? 'pro_annual' : 'pro_monthly'
  const list = await stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 })

  const price = list.data[0]
  if (!price) throw new Error(`Pro ${period} price not found in Stripe (lookup_key=${lookupKey}).`)

  _cache[period] = {
    id:        price.id,
    productId: typeof price.product === 'string' ? price.product : (price.product as { id: string }).id,
    amount:    price.unit_amount ?? 0,
    currency:  price.currency,
  }
  _cacheExpiry[period] = now + CACHE_TTL
  return _cache[period]!
}
