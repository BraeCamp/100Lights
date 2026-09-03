// Does every automatable parameter actually exist on its effect?
//
//   npm run test:auto-params
//
// The limiter's lane is labelled "Ceiling" and writes `threshold`. LimiterParams
// has no `threshold` — it has `ceilingDb` — and buildLimiter's setParam does
// `p[key] = value` then reads `p.ceilingDb`, so the write lands on a field
// nothing reads. The lane draws, the automation runs, the sound never moves.
//
// That is the second one of these this session (the first was "EQ3 Wet", a wet
// key on an effect with no wet). Both are invisible: nothing errors, the curve
// is right there on screen. So: check every one.

import Module, { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
const BUILD = join(dirname(fileURLToPath(import.meta.url)), '..', '.test-build')
const orig = Module._resolveFilename
Module._resolveFilename = function (r, ...a) { if (r.startsWith('@/lib/')) r = `${BUILD}/${r.slice(6)}.js`; return orig.call(this, r, ...a) }

const T = require(`${BUILD}/daw-types.js`)
const P = require(`${BUILD}/daw-effect-params.js`)
const { ADD_OPTIONS, makeDefaultParams } = require(`${BUILD}/daw-effect-catalog.js`)

let bad = 0
console.log('effect          parameter        exists on the effect?')
console.log('─'.repeat(64))
for (const opt of ADD_OPTIONS) {
  let params
  try { params = makeDefaultParams(opt.type) } catch { continue }
  const effect = { id: 'x', type: opt.type, params }
  const list = P.automatableParams(effect)
  for (const prm of list) {
    const present = Object.prototype.hasOwnProperty.call(params, prm.key)
    if (!present) bad++
    console.log(`${opt.type.padEnd(16)}${(prm.key + ' (' + prm.label + ')').padEnd(24)}${present ? 'yes' : 'NO  ← writes a field nothing reads'}`)
  }
}
console.log('─'.repeat(64))
console.log(bad ? `${bad} automatable parameter(s) do not exist on their effect` : 'every automatable parameter exists')
void T
process.exit(bad ? 1 : 0)
