#!/usr/bin/env node
// Does a deployed engine fix actually reach the browser?
//
//   node --experimental-strip-types scripts/apollo-tests/engine-freshness.test.mjs
//
// Brae: "Can you make sure that they are going through because it still cuts
// out after a chord."
//
// ⚠️ A FIX THAT NEVER ARRIVED AND A FIX THAT DID NOT WORK LOOK IDENTICAL from
// the outside, and days can go into telling them apart. This is the check that
// tells them apart.
//
// The service worker answers anything ending in .js with stale-while-revalidate:
// the CACHED copy is returned immediately and a fresh one is fetched for next
// time. For /apollo/engine.js that means the worklet running today is the one
// from the previous visit — unless the URL carries the version, which makes
// every release a distinct cache key that cannot be served stale.
//
// ⚠️ AND THE FIRST REGISTRATION WINS. addModule registers `apollo-engine` for
// the whole AudioContext; a later addModule of a DIFFERENT url re-registering
// the same name throws, and every call site swallows that. So one unversioned
// call anywhere can pin an entire session to old code while every other call
// site correctly asks for the new build.

import assert from 'node:assert'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

// ── every addModule of the engine carries the version ──────────────────────
{
  const roots = ['lib', 'components', 'app', 'scripts']
  const offenders = []
  let sites = 0

  const walk = dir => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); continue }
      if (!/\.(ts|tsx|mjs|js)$/.test(e.name)) continue
      const src = readFileSync(p, 'utf8')
      for (const m of src.matchAll(/addModule\(\s*([`'"])([^`'"]*apollo\/engine\.js[^`'"]*)\1/g)) {
        sites++
        // A bare path, with no ?v= and no interpolation carrying one.
        if (!/\?v=/.test(m[2])) offenders.push(`${p}: ${m[2]}`)
      }
      // Template-literal form, e.g. `${base}/apollo/engine.js?v=${V}`
      for (const m of src.matchAll(/addModule\(\s*`([^`]*apollo\/engine\.js[^`]*)`/g)) {
        if (!/\?v=/.test(m[1])) offenders.push(`${p}: ${m[1]}`)
      }
    }
  }
  for (const r of roots) walk(r)

  check('found the places that load the worklet', sites >= 2, `${sites} call sites`)
  // ⚠️ THE ONE THAT MATTERED. daw-instrument.ts loaded it unversioned, which is
  // the path Beacon takes when a track has no destination yet.
  check('every one of them asks for a specific engine version',
    offenders.length === 0, offenders.join(' | '))
}

// ── the version actually changes when the engine does ──────────────────────
{
  const v = readFileSync('lib/apollo/engine-version.ts', 'utf8')
  const stamp = /ENGINE_VERSION\s*=\s*'([^']+)'/.exec(v)?.[1] ?? ''
  check('the version is a dated stamp, so a bump is obvious in a diff',
    /^\d{4}-\d{2}-\d{2}-\d{2}$/.test(stamp), stamp)

  // The service worker is what makes the version load-bearing; if it ever stops
  // treating .js as an asset this whole hazard changes shape.
  const sw = readFileSync('public/sw.js', 'utf8')
  check('the service worker still serves .js stale-while-revalidate',
    /staleWhileRevalidate\(request, ASSET_CACHE\)/.test(sw)
    && /\\\.\(\?:js\|/.test(sw))
}

// ── and it can be read from a running page ─────────────────────────────────
{
  const diag = readFileSync('lib/daw-diagnose.ts', 'utf8')
  check('the diagnostic reports which engine build is live',
    /engineVersion: ENGINE_VERSION/.test(diag))
}

console.log(failures ? `\n${failures} failing` : '\nfixes reach the browser')
assert.equal(failures, 0)
