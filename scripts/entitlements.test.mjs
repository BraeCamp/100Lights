#!/usr/bin/env node
// The tier table, and the mistake it exists to prevent.
//
//   node scripts/entitlements.test.mjs
//
// Brae: "We can separate into multiple paid tiers so we can do expensive
// options as well… Note it by tier so we can move all of it at once whenever
// we need to."
//
// So the two things worth testing are: every feature names exactly one tier
// and moving it is a one-line edit, and — the dangerous one — that nothing in
// the codebase still asks `plan === 'pro'` when it means "is this user
// paying". Nineteen call sites said the second while meaning the first, and
// every one of them would have treated a Max subscriber as a free user.

import assert from 'node:assert'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  FEATURE_TIER, PLAN_RANK, PAID_PLANS, ENTITLEMENTS,
  can, atLeast, isPaid, tierFor, featuresFor, entitlements, exportWatermark,
} from '../.test-build/entitlements.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

const PLANS = Object.keys(PLAN_RANK)

// ── The table itself ────────────────────────────────────────────────────────
check('there are three paid tiers', PAID_PLANS.length === 3, PAID_PLANS.join(', '))
check('every feature names a real plan',
  Object.values(FEATURE_TIER).every(p => PLANS.includes(p)),
  [...new Set(Object.values(FEATURE_TIER))].join(', '))

// Every tier has to be worth buying: if a tier adds nothing, the pricing page
// has a row nobody can be sold.
for (const plan of PAID_PLANS) {
  const added = Object.entries(FEATURE_TIER).filter(([, t]) => t === plan)
  check(`${plan} adds something of its own`, added.length > 0, `${added.length} features`)
}

// ── Ordering ────────────────────────────────────────────────────────────────
check('higher tiers include everything below them',
  PLANS.every(p => featuresFor(p).every(f => atLeast(p, tierFor(f)))))
const counts = PLANS.map(p => featuresFor(p).length)
check('each tier is a superset of the last',
  counts.every((n, i) => i === 0 || n >= counts[i - 1]),
  counts.join(' ≤ '))
check('free gets no gated feature', featuresFor('free').length === 0)

// ── The specific mistake ────────────────────────────────────────────────────
check('every paid plan reads as paying', PAID_PLANS.every(isPaid))
check('free does not', !isPaid('free'))
for (const plan of PAID_PLANS) {
  check(`${plan} can collaborate`, can(plan, 'collaboration'))
  check(`${plan} exports without a watermark`, !exportWatermark(plan))
}
check('free is watermarked', exportWatermark('free'))

// Quotas must exist for every plan — a missing entry silently falls back to
// free, which is the same bug wearing a different hat.
for (const plan of PLANS) {
  const e = entitlements(plan)
  check(`${plan} has its own quotas`,
    e === ENTITLEMENTS[plan] && typeof e.storageMb === 'number' && typeof e.serverRenderSecondsPerMonth === 'number')
}
check('only the top tier gets a real server-render budget',
  ENTITLEMENTS.max.serverRenderSecondsPerMonth > ENTITLEMENTS.studio.serverRenderSecondsPerMonth
  && ENTITLEMENTS.pro.serverRenderSecondsPerMonth === 0
  && ENTITLEMENTS.free.serverRenderSecondsPerMonth === 0)

// ── The guard ───────────────────────────────────────────────────────────────
// Nothing may compare a plan to 'pro' again. This is the check that would have
// caught the original problem before it shipped.
const SKIP = new Set(['node_modules', '.next', '.git', 'dist', '.test-build'])
const offenders = []
const walk = dir => {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) { walk(full); continue }
    if (!/\.(ts|tsx|mjs)$/.test(name)) continue
    const rel = full.slice(ROOT.length + 1)
    // entitlements.ts documents the rule; project-access explains its own fix.
    if (rel === 'lib/entitlements.ts' || rel === 'scripts/entitlements.test.mjs') continue
    readFileSync(full, 'utf8').split('\n').forEach((line, i) => {
      if (line.trim().startsWith('//') || line.trim().startsWith('*')) return
      if (/===\s*['"]pro['"]|['"]pro['"]\s*===/.test(line)) offenders.push(`${rel}:${i + 1}`)
    })
  }
}
walk(join(ROOT, 'lib'))
walk(join(ROOT, 'app'))
walk(join(ROOT, 'components'))
check('nothing asks "is the plan exactly pro" any more', offenders.length === 0,
  offenders.slice(0, 4).join(', ') || 'clean')

console.log(failures ? `\n${failures} failing` : '\nthe tier table holds')
assert.equal(failures, 0)
