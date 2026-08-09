// Create the 100Lights credit/Pro Stripe products + prices via the API — instead of clicking
// through the dashboard. Idempotent: tagged with metadata.app='100lights-credits' so re-running
// reuses what exists. SAFE BY DEFAULT: dry-runs (prints the plan) unless --create is passed, and
// refuses a LIVE key unless --live is ALSO passed. Keep the amounts in sync with lib/credits.ts.
//
//   node scripts/setup-stripe-products.mjs                 # dry run (prints plan, creates nothing)
//   node scripts/setup-stripe-products.mjs --create        # create — TEST key only
//   node scripts/setup-stripe-products.mjs --create --live # create against a LIVE key (real!)
//
// Key: STRIPE_TEST_SECRET_KEY if set, else STRIPE_SECRET_KEY (from .env.local).
import { readFileSync } from 'node:fs'
import Stripe from 'stripe'

const args = new Set(process.argv.slice(2))
const CREATE = args.has('--create')
const ALLOW_LIVE = args.has('--live')

const env = {}
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
const key = env.STRIPE_TEST_SECRET_KEY || env.STRIPE_SECRET_KEY
if (!key) { console.error('No STRIPE_SECRET_KEY / STRIPE_TEST_SECRET_KEY in .env.local'); process.exit(1) }
const isLive = key.startsWith('sk_live_')
if (CREATE && isLive && !ALLOW_LIVE) {
  console.error('\n⛔ That is a LIVE key. Re-run with --live to create real products, or add a test key\n   as STRIPE_TEST_SECRET_KEY and run --create (test-first is strongly recommended).\n')
  process.exit(1)
}
const stripe = new Stripe(key, { apiVersion: '2026-05-27.dahlia' })
const mode = isLive ? 'LIVE' : 'TEST'

// ── Plan — keep in sync with lib/credits.ts CREDIT_TIERS ────────────────────────────────────────
// Recurring subscription tiers (monthly). All grant "Pro" access; differ by monthly credit grant.
const SUBS = [
  { tier: 'pro',       name: '100Lights Pro',        usd: 10, credits: 500 },
  { tier: 'studio',    name: '100Lights Studio',     usd: 25, credits: 1500 },
  { tier: 'studioMax', name: '100Lights Studio Max', usd: 60, credits: 4000 },
]
// One-time AI credit top-ups.
const TOPUPS = [
  { name: '100Lights AI Credits — 500',  usd: 5,  credits: 500 },
  { name: '100Lights AI Credits — 2500', usd: 20, credits: 2500 },
]

async function findByMeta(metaTier) {
  const r = await stripe.products.search({ query: `metadata['app']:'100lights-credits' AND metadata['tier']:'${metaTier}'` })
  return r.data[0] || null
}
async function ensureProduct(metaTier, name, extraMeta = {}) {
  const existing = await findByMeta(metaTier)
  if (existing) { console.log(`  · product exists: ${name} (${existing.id})`); return existing }
  if (!CREATE) { console.log(`  + would create product: ${name}`); return { id: `(new) ${name}`, _new: true } }
  const p = await stripe.products.create({ name, metadata: { app: '100lights-credits', tier: metaTier, ...extraMeta } })
  console.log(`  ✓ created product: ${name} (${p.id})`)
  return p
}
async function ensurePrice(product, unitAmount, recurring, metaTier, credits) {
  if (product._new) { console.log(`  + would create price: $${unitAmount / 100}${recurring ? '/mo' : ''} (${credits} credits)`); return { id: `(new price)` } }
  const existingPrices = await stripe.prices.list({ product: product.id, active: true, limit: 100 })
  const match = existingPrices.data.find(p => p.unit_amount === unitAmount && (!!p.recurring) === !!recurring)
  if (match) { console.log(`  · price exists: $${unitAmount / 100}${recurring ? '/mo' : ''} → ${match.id}`); return match }
  if (!CREATE) { console.log(`  + would create price: $${unitAmount / 100}${recurring ? '/mo' : ''} (${credits} credits)`); return { id: '(new price)' } }
  const price = await stripe.prices.create({
    product: product.id, currency: 'usd', unit_amount: unitAmount,
    ...(recurring ? { recurring: { interval: 'month' } } : {}),
    metadata: { app: '100lights-credits', tier: metaTier, credits: String(credits) },
  })
  console.log(`  ✓ created price: $${unitAmount / 100}${recurring ? '/mo' : ''} → ${price.id}`)
  return price
}

console.log(`\n=== Stripe products (${mode} mode) — ${CREATE ? 'CREATING' : 'DRY RUN (nothing will be created)'} ===\n`)
const out = {}
for (const s of SUBS) {
  console.log(`Tier ${s.tier} — ${s.name} — $${s.usd}/mo, ${s.credits} credits/mo`)
  const prod = await ensureProduct(s.tier, s.name, { monthlyCredits: String(s.credits) })
  const price = await ensurePrice(prod, s.usd * 100, true, s.tier, s.credits)
  out[s.tier] = price.id
}
console.log(`\nTop-ups (one-time):`)
const topupIds = []
for (const t of TOPUPS) {
  const prod = await ensureProduct('credits', '100Lights AI Credits', {})
  const price = await ensurePrice(prod, t.usd * 100, false, 'credits', t.credits)
  topupIds.push({ credits: t.credits, id: price.id })
}

console.log(`\n=== Add to .env.local (${mode}) ===`)
console.log(`STRIPE_PRO_PRICE_ID=${out.pro || '<pro price id>'}`)
console.log(`STRIPE_STUDIO_PRICE_ID=${out.studio || '<studio price id>'}`)
console.log(`STRIPE_STUDIO_MAX_PRICE_ID=${out.studioMax || '<studio-max price id>'}`)
topupIds.forEach((t, i) => console.log(`STRIPE_TOPUP_${t.credits}_PRICE_ID=${t.id}`))
if (!CREATE) console.log(`\n(dry run — re-run with --create${isLive ? ' --live' : ''} to actually create them)`)
