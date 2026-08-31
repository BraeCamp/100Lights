// Repairing automation points must fix the broken ones and touch nothing else.
//
//   npm run test:auto-repair
//
// An automation point is a 0–1 POSITION; lane.min/max carry the units. For a
// while the spoken filter sweep wrote real Hertz into the points instead, so
// the engine computed `min + 12000 × (max − min)` — tens of millions of Hertz,
// clamped wide open at both ends, and the sweep played as a flat line.
//
// Fixing the code does nothing for a song already saved that way, so
// migrateProject repairs them on load. That is a rewrite of somebody's saved
// automation, which is exactly the kind of change that has to be provably
// narrow: these check that it corrects the impossible and leaves everything
// else completely alone.

import Module, { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const BUILD = join(dirname(fileURLToPath(import.meta.url)), '..', '.test-build')
const orig = Module._resolveFilename
Module._resolveFilename = function (r, ...a) { if (r.startsWith('@/lib/')) r = join(BUILD, r.slice('@/lib/'.length) + '.js'); return orig.call(this, r, ...a) }

// The repair lives in its own module so this can compile it alone — pulling
// the whole reducer into the CommonJS test build dragged in unrelated files
// that do not compile that way, which would have broken every other test.
const { repairAutomationPoints } = require('../.test-build/automation-repair.js')

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${extra ? `  ${extra}` : ''}`)
}
const lane = (over) => ({
  id: 'L', trackId: 't', parameter: 'fx:f1:frequency', label: 'Cutoff',
  min: 200, max: 18000, defaultValue: 18000, points: [], expanded: true, ...over,
})
const run = l => repairAutomationPoints([l])[0]

// ── the broken shape: Hertz where positions belong ─────────────────────────
{
  const out = run(lane({ curve: 'log', points: [{ id: 'a', beat: 0, value: 18000 }, { id: 'b', beat: 16, value: 900 }] }))
  const vals = out.points.map(p => +p.value.toFixed(3))
  check('Hertz points become positions', vals[0] === 1 && vals[1] > 0 && vals[1] < 1, JSON.stringify(vals))
  // and they must map BACK to roughly the frequencies they were
  const back = out.points.map(p => Math.round(200 * Math.pow(18000 / 200, p.value)))
  check('the repaired curve still means the same frequencies', back[0] === 18000 && Math.abs(back[1] - 900) < 20, JSON.stringify(back))
  check('the repaired sweep still descends', out.points[0].value > out.points[1].value)
}

// ── a lane drawn by hand must not be touched ───────────────────────────────
{
  const pts = [{ id: 'a', beat: 0, value: 1 }, { id: 'b', beat: 8, value: 0.15 }, { id: 'c', beat: 16, value: 0.5 }]
  const out = run(lane({ curve: 'log', points: pts.map(p => ({ ...p })) }))
  check('a correct lane is left exactly as it was',
    JSON.stringify(out.points.map(p => p.value)) === JSON.stringify(pts.map(p => p.value)),
    JSON.stringify(out.points.map(p => p.value)))
}

// ── a MIXTURE is ambiguous, so nothing is guessed ──────────────────────────
{
  const pts = [{ id: 'a', beat: 0, value: 0.8 }, { id: 'b', beat: 16, value: 4000 }]
  const out = run(lane({ points: pts.map(p => ({ ...p })) }))
  check('a lane with some points in range is left alone',
    JSON.stringify(out.points.map(p => p.value)) === JSON.stringify(pts.map(p => p.value)),
    JSON.stringify(out.points.map(p => p.value)))
}

// ── a 0–1 lane (volume, wet) can never be misread as broken ────────────────
{
  const out = run(lane({ parameter: 'volume', min: 0, max: 1, defaultValue: 0.8, points: [{ id: 'a', beat: 0, value: 0.9 }, { id: 'b', beat: 4, value: 0.1 }] }))
  check('a volume lane is untouched', out.points[0].value === 0.9 && out.points[1].value === 0.1)
}

// ── an empty lane, and a degenerate range, must not throw ──────────────────
{
  check('an empty lane survives', run(lane({ points: [] })).points.length === 0)
  check('a zero-width range survives', run(lane({ min: 5, max: 5, points: [{ id: 'a', beat: 0, value: 900 }] })).points[0].value === 900)
}

// ── a linear lane converts through its own range ───────────────────────────
{
  const out = run(lane({ min: 0, max: 100, points: [{ id: 'a', beat: 0, value: 25 }] }))
  check('a linear lane maps by its own range', Math.abs(out.points[0].value - 0.25) < 1e-9, String(out.points[0].value))
}

console.log(failures ? `\n${failures} FAILED` : '\nall good')
process.exit(failures ? 1 : 0)
