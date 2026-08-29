#!/usr/bin/env node
// ---------------------------------------------------------------------------
//  Is the plug-in store actually ready to take money?
//
//    node --env-file=.env.local scripts/check-plugin-readiness.mjs
//
//  Six external services have to line up before a purchase works end to end,
//  and every one of them fails quietly in its own way: a webhook pointed at a
//  path that 404s, a sender domain Resend will not accept, a checksum that no
//  longer matches the file being served. Each check below asks the service
//  itself rather than trusting configuration.
//
//  What this CANNOT check: whether the webhook signing secret is the right one.
//  That is only knowable by having Stripe sign a real request and seeing the
//  deployed endpoint accept it, which needs the code live first.
// ---------------------------------------------------------------------------
import { PLUGINS } from '../lib/plugins-catalog.ts'

const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://100lights.com').replace(/\/$/, '')

let failures = 0
const line = (ok, label, detail) => {
  if (!ok) failures++
  console.log(`  ${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${label.padEnd(34)} ${detail}`)
}
const section = (name) => console.log(`\n\x1b[1m${name}\x1b[0m`)

const stripeGet = async (path) => {
  const r = await fetch(`https://api.stripe.com/v1/${path}`, {
    headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` },
  })
  return r.json()
}

// ---------------------------------------------------------------- Stripe --
section('Stripe')
if (!process.env.STRIPE_SECRET_KEY) {
  line(false, 'STRIPE_SECRET_KEY', 'not set')
} else {
  const mode = process.env.STRIPE_SECRET_KEY.startsWith('sk_live') ? 'LIVE' : 'test'
  line(true, 'API key', `present (${mode} mode)`)

  const hooks = await stripeGet('webhook_endpoints?limit=20')
  const wanted = `${SITE}/api/plugins/webhook`
  const hook = (hooks.data ?? []).find(h => h.url === wanted)
  line(!!hook, 'plugin webhook registered', hook ? `${hook.status}, ${hook.enabled_events.length} event(s)` : `no endpoint at ${wanted}`)
  if (hook) {
    const only = hook.enabled_events.length === 1 && hook.enabled_events[0] === 'checkout.session.completed'
    line(only, 'webhook events', only ? 'checkout.session.completed only' : `subscribed to ${hook.enabled_events.join(', ')} — extra events will be ignored`)
  }

  for (const p of PLUGINS) {
    if (!p.stripePriceId) { line(false, `${p.name} price`, 'no stripePriceId in the catalog'); continue }
    const price = await stripeGet(`prices/${p.stripePriceId}`)
    const ok = !price.error && price.active
    line(ok, `${p.name} price`, ok ? `${(price.unit_amount / 100).toFixed(2)} ${price.currency.toUpperCase()}, ${price.type}` : (price.error?.message ?? 'inactive'))
  }
}

// ---------------------------------------------------------------- Resend --
section('Email (Resend)')
if (!process.env.RESEND_API_KEY) {
  line(false, 'RESEND_API_KEY', 'not set')
} else {
  line(true, 'API key', 'present')
  const r = await fetch('https://api.resend.com/domains', {
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
  })
  const domains = (await r.json()).data ?? []
  const verified = domains.filter(d => d.status === 'verified').map(d => d.name)
  line(verified.length > 0, 'verified sending domain', verified.join(', ') || 'none')

  const from = process.env.EMAIL_FROM ?? ''
  const fromDomain = (from.match(/@([^\s>]+)/) ?? [])[1]
  // The trap: EMAIL_FROM defaults to the bare domain, which Resend rejects with
  // a 403 that sendEmail() swallows. Every email silently fails.
  line(!!fromDomain && verified.includes(fromDomain),
       'EMAIL_FROM uses that domain',
       fromDomain ? `${fromDomain}${verified.includes(fromDomain) ? '' : ' — NOT verified, every send will 403'}` : 'EMAIL_FROM not set')
}

// -------------------------------------------------------------- Database --
section('Database (Neon)')
if (!process.env.DATABASE_URL) {
  line(false, 'DATABASE_URL', 'not set')
} else {
  const { neon } = await import('@neondatabase/serverless')
  const sql = neon(process.env.DATABASE_URL)
  const rows = await sql`SELECT table_name FROM information_schema.tables WHERE table_name LIKE 'luz_%'`
  const names = rows.map(r => r.table_name)
  const need = ['luz_licenses', 'luz_license_seats']
  const missing = need.filter(n => !names.includes(n))
  line(missing.length === 0, 'licence tables', missing.length ? `missing ${missing.join(', ')} — run db/luz-schema.sql` : `${names.length} tables present`)
}

// ------------------------------------------------------------- Downloads --
section('Installer hosting (R2)')
for (const p of PLUGINS) {
  if (!p.downloadUrl) { line(false, `${p.name} download`, 'no downloadUrl in the catalog'); continue }
  const head = await fetch(p.downloadUrl, { method: 'HEAD' })
  line(head.ok, `${p.name} download`, head.ok ? `HTTP 200, ${(Number(head.headers.get('content-length') ?? 0) / 1048576).toFixed(1)} MB` : `HTTP ${head.status}`)

  if (head.ok && p.checksum) {
    const buf = new Uint8Array(await (await fetch(p.downloadUrl)).arrayBuffer())
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', buf))]
      .map(b => b.toString(16).padStart(2, '0')).join('')
    // A stale checksum is worse than none: it makes an honest file look tampered with.
    line(digest === p.checksum, `${p.name} checksum`, digest === p.checksum ? 'matches the catalog' : `served file is ${digest.slice(0, 16)}…, catalog says ${p.checksum.slice(0, 16)}…`)
  }
}

// ------------------------------------------------------------------ Live --
section(`Deployed at ${SITE}`)
const probe = async (path, method = 'GET') => {
  try { return (await fetch(`${SITE}${path}`, { method })).status } catch { return 0 }
}
const hook = await probe('/api/plugins/webhook', 'POST')
// 400 = deployed and correctly rejecting an unsigned body. 503 = deployed but
// the signing secret is missing from THIS build. 404 = code not shipped.
line(hook !== 404 && hook !== 0, 'webhook route live',
     hook === 404 ? 'HTTP 404 — not deployed yet (merge the PR)'
     : hook === 503 ? 'HTTP 503 — deployed but no signing secret in this build; redeploy'
     : hook === 400 ? 'HTTP 400 — deployed, rejecting unsigned requests (correct)'
     : `HTTP ${hook}`)
line((await probe('/store/plugins')) === 200, 'store page live', 'GET /store/plugins')

// ----------------------------------------------------------------- Sale --
section('On sale')
for (const p of PLUGINS) {
  line(true, `${p.name}`, p.available ? 'AVAILABLE — buyable now' : 'not on sale (available: false)')
}

console.log(failures === 0
  ? '\n\x1b[32mEverything checked is connected.\x1b[0m\n'
  : `\n\x1b[31m${failures} item(s) need attention.\x1b[0m\n`)
process.exit(failures === 0 ? 0 : 1)
