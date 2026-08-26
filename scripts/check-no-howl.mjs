// The studio must not be able to feed back, whatever the project says.
//
//   npm run check:no-howl
//
// Brae: "I'm getting a LOT of feedback… it even has consistent feedback when
// it's paused."
//
// Feedback that continues with the transport stopped is not a playback bug. A
// delay and a chorus are each a delay line wired back into itself, and that loop
// is live whenever the audio graph is: below a gain of one it decays, at one it
// sustains forever, above one it grows without bound. The safe ceiling was
// written down only as a comment on the type ("0..0.95") while the code assigned
// `feedback.gain.value = params.feedback` directly — so any project carrying a
// larger number, from a preset or an import or an older schema, howls.
//
// This asserts the clamp holds for values no interface should ever produce,
// because the whole point is that they arrive from somewhere else.

import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = readFileSync(join(ROOT, 'lib/daw-effects.ts'), 'utf8')

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

// Every assignment into a recirculating gain must go through the clamp. This is
// a source check rather than a runtime one because Web Audio is not available in
// node — but it catches the thing that actually went wrong, which was an
// assignment written without the guard.
const rawFeedback = [...src.matchAll(/feedback\.gain\.value\s*=\s*([^\n]+)/g)].map(m => m[1].trim())
check('every delay/chorus feedback assignment is clamped',
  rawFeedback.length > 0 && rawFeedback.every(v => v.startsWith('safeFeedback(')),
  rawFeedback.filter(v => !v.startsWith('safeFeedback(')).join(' | ') || `${rawFeedback.length} sites`)

const rawQ = [...src.matchAll(/\.Q\.value\s*=\s*([^\n;]+)/g)].map(m => m[1].trim())
const unguardedQ = rawQ.filter(v => !v.startsWith('safeQ(') && !/^[\d.]+$/.test(v) && !/^1 \/ /.test(v))
check('every resonance assignment is clamped or a literal', unguardedQ.length === 0, unguardedQ.join(' | '))

// And the ceiling itself must leave headroom under unity. At exactly 1.0 the
// loop sustains forever — quieter than a runaway, and just as wrong.
const maxFb = Number(src.match(/const MAX_FEEDBACK = ([\d.]+)/)?.[1])
check('the feedback ceiling is safely below unity', maxFb > 0 && maxFb <= 0.95, `MAX_FEEDBACK = ${maxFb}`)

// Replicate the clamp and check the values that would have caused the howl.
const MAX_FEEDBACK = maxFb
const safeFeedback = v => Number.isFinite(v) ? Math.min(MAX_FEEDBACK, Math.max(0, v)) : 0
for (const [input, why] of [[1, 'sustains forever'], [1.4, 'grows without bound'], [12, 'a wrong range'], [NaN, 'a corrupt value'], [-3, 'negative']]) {
  const out = safeFeedback(input)
  check(`feedback ${String(input)} (${why}) is brought back to a safe value`,
    Number.isFinite(out) && out >= 0 && out < 1, `→ ${out}`)
}

// ── Apollo's own effects ────────────────────────────────────────────────────
//
// Helios runs its FX chain every block, sounding notes or not, so a loop with
// gain over unity there howls exactly the same way — and this is where the bug
// actually was. Apollo's delay clamped feedback to 1.1: not a typo so much as a
// ceiling chosen without noticing that 1.0 is the point where a delay line stops
// decaying and starts growing. Every other recirculating effect in that file
// clamps below 1; this one stood out only once something was looking.
const engine = readFileSync(join(ROOT, 'public/apollo/engine.js'), 'utf8')
const clamps = [...engine.matchAll(/clamp\(\s*P\('feedback'[^)]*\)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)/g)]
  .map(m => ({ lo: Number(m[1]), hi: Number(m[2]) }))
check('Apollo has recirculating effects to check', clamps.length > 0, `${clamps.length} found`)
const overUnity = clamps.filter(c => c.hi >= 1)
check('no Apollo feedback clamp reaches unity', overUnity.length === 0,
  overUnity.map(c => `0..${c.hi}`).join(', '))

// The engine version has to move whenever engine.js does, or browsers keep the
// worklet they already cached and the fix never reaches anyone.
const version = readFileSync(join(ROOT, 'lib/apollo/engine-version.ts'), 'utf8').match(/'([\d-]+)'/)?.[1]
check('the engine version is set', !!version, version)

console.log(failures ? `\n${failures} failing` : '\nthe studio cannot be told to howl')
assert.equal(failures, 0)
