#!/usr/bin/env node
// Are the endpoints that claim to be public actually reachable signed out?
//
//   node scripts/check-public-api.mjs [baseUrl]
//
// proxy.ts runs Clerk's auth.protect() on everything not listed in
// isPublicRoute, and in this setup that answers **404**, not 401 — so a public
// route left off the list looks exactly like a route that does not exist.
//
// That is what happened to the sound catalog. syncCatalog says it "runs for
// every user, signed in or not", and for signed-out visitors every request
// 404'd, so the catalog could not reach a guest at all. The announcements 404
// sat in the notes as "pre-existing, site-wide" for weeks for the same reason.
//
// Endpoints that legitimately need a signed-in user are listed separately and
// asserted to be protected — a check that only looked for 200s would "pass"
// beautifully if auth were removed altogether.

import assert from 'node:assert'

const BASE = (process.argv[2] || 'https://www.100lights.com').replace(/\/$/, '')

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

const status = async path => {
  try {
    const r = await fetch(`${BASE}${path}`, {
      redirect: 'manual',
      signal: AbortSignal.timeout(30000),
      headers: { accept: 'application/json' },
    })
    return r.status
  } catch { return 0 }
}

// Reachable without an account, by design.
const PUBLIC = [
  ['/api/catalog', 'the sound catalog every library syncs'],
  ['/api/announcements', 'banners shown to signed-out visitors'],
  ['/api/platform-flags', 'feature flags read before sign-in'],
]

// Require an account. Included so this check cannot pass by everything being open.
const PROTECTED = [
  ['/api/projects', 'someone else’s projects'],
  ['/api/usage', 'someone else’s storage usage'],
]

console.log(`signed out against ${BASE}\n`)
for (const [path, why] of PUBLIC) {
  const s = await status(path)
  check(`${path} is reachable — ${why}`, s !== 0 && s !== 404 && s < 500, `HTTP ${s}`)
}
for (const [path, why] of PROTECTED) {
  const s = await status(path)
  check(`${path} still refuses a stranger — ${why}`, s === 401 || s === 403 || s === 404, `HTTP ${s}`)
}

console.log(failures ? `\n${failures} failing` : '\npublic endpoints are public, private ones are not')
assert.equal(failures, 0)
