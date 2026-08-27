#!/usr/bin/env node
/**
 * Regression test for the practice-progress summary.
 *
 *   npm run test:practice
 *
 * The dashboard's "Your progress" card is driven entirely by summarisePractice,
 * and it reads a localStorage blob that has been written by older builds. The
 * cases that actually bite are the boring ones: step ids that were renamed since
 * the progress was saved (must not inflate the count), and picking WHICH path to
 * nudge next (finish what you started, don't start another).
 *
 * Follows the same shape as test:merge — tsc the libs into .test-build, then run
 * this against the compiled output.
 */
import { readdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

const DIR = '.test-build'

// tsc emits extensionless relative imports; Node ESM needs the .js.
for (const f of readdirSync(DIR).filter(n => n.endsWith('.js'))) {
  const p = join(DIR, f)
  writeFileSync(p, readFileSync(p, 'utf8').replace(/from '(\.\/[A-Za-z0-9_-]+)'/g, "from '$1.js'"))
}

const { PRACTICE_PATHS } = await import(`../${DIR}/practice-paths.js`)
const { summarisePractice } = await import(`../${DIR}/practice-progress.js`)

let failures = 0
function check(cond, msg) {
  if (cond) return
  failures++
  console.error(`  FAIL  ${msg}`)
}

const totalSteps = PRACTICE_PATHS.reduce((n, p) => n + p.steps.length, 0)
check(PRACTICE_PATHS.length > 0, 'there is at least one practice path')
check(totalSteps > 0, 'paths have steps')

// A user who has never done anything.
let s = summarisePractice({})
check(s.fresh === true, 'a new user reads as fresh')
check(s.stepsDone === 0, 'a new user has zero completed steps')
check(s.stepsTotal === totalSteps, 'stepsTotal counts every step in the curriculum')
check(!!s.nextPath, 'a new user is still given somewhere to start')

// One path finished, one path started: nudge the started one, not a new one.
const [p1, p2] = PRACTICE_PATHS
s = summarisePractice({
  [p1.id]: p1.steps.map(x => x.id),
  [p2.id]: p2.steps.slice(0, 1).map(x => x.id),
})
check(s.fresh === false, 'someone with progress is not fresh')
check(s.pathsComplete === 1, 'a fully-completed path counts as complete')
check(s.pathsStarted === 1, 'a partially-completed path counts as started')
check(s.nextPath?.id === p2.id, 'nudges the furthest-along unfinished path')
check(s.nextRemaining === p2.steps.length - 1, 'remaining excludes completed steps')

// Step ids that no longer exist (renamed in a later build) must not count.
s = summarisePractice({ [p1.id]: ['step-that-was-renamed', 'another-ghost'] })
check(s.stepsDone === 0, 'unknown step ids do not inflate the completed count')
check(s.fresh === true, 'progress made only of ghost ids still reads as fresh')

// Everything done.
const all = {}
for (const p of PRACTICE_PATHS) all[p.id] = p.steps.map(x => x.id)
s = summarisePractice(all)
check(s.stepsDone === totalSteps, 'a finished user has every step counted')
check(s.pathsComplete === PRACTICE_PATHS.length, 'every path reads complete')
check(s.nextPath === null, 'nothing left to nudge when everything is done')

// Malformed stored values must degrade, not throw.
for (const bad of [{}, { unknownPath: [] }, { [p1.id]: [] }, { [p1.id]: ['a', 'b'] }]) {
  let ok = true
  try { summarisePractice(bad) } catch { ok = false }
  check(ok, `summarisePractice survives ${JSON.stringify(bad)}`)
}

if (failures) {
  console.error(`\npractice-progress: ${failures} assertion(s) failed`)
  process.exit(1)
}
console.log(`practice-progress: all assertions passed (${PRACTICE_PATHS.length} paths, ${totalSteps} steps)`)
