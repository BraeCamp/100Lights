#!/usr/bin/env node
/**
 * What would a good voice cost, and how much of it can be bought once?
 *
 *   node scripts/voice-tts-cost.mjs [--rate 0.22] [--tracks 8] [--commands 200]
 *
 * Brae: "calculate the cost of using quality AI voices and recording the
 * responses from them to our system so that we can reuse them for free for
 * common responses."
 *
 * The browser's own voice is free and sounds it. A studio voice would be a real
 * improvement and a real per-character bill, and the question is how much of
 * that bill is avoidable — which turns entirely on how much of what the studio
 * says is FIXED.
 *
 * So this counts, rather than estimates: it reads the actual response strings
 * out of the source and sorts them into the ones that can be rendered once
 * before anybody speaks, and the ones that carry a track name and cannot.
 *
 * The rate is a parameter because it is the one number here that is not ours to
 * measure — the API key in this repo lacks the permission to read the account's
 * own plan, so nothing here pretends to know it. Pass --rate with the real
 * dollars-per-1000-characters and the arithmetic follows.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : fallback
}

// Dollars per 1,000 characters. The published creator/pro tiers land around
// here; pass the real one.
const RATE = arg('rate', 0.22)
const TRACKS = arg('tracks', 8)
/** Spoken responses in a working session. */
const PER_SESSION = arg('commands', 200)

const FILES = [
  'lib/voice/execute-music.ts',
  'lib/voice/queue.ts',
  'lib/voice/calibrate.ts',
  'components/editor/daw/VoiceControl.tsx',
]

const fixed = new Set()
const shapes = new Set()
for (const f of FILES) {
  const src = readFileSync(path.join(ROOT, f), 'utf8')
  for (const re of [
    /\bsay:\s*(`[^`]*`|'[^']*')/g,
    /\bfail\(\s*(`[^`]*`|'[^']*')/g,
    /\brespond\(\s*(`[^`]*`|'[^']*')/g,
    /\bsetSaid\(\s*(`[^`]*`|'[^']*')/g,
    /\bsetProblem\(\s*(`[^`]*`|'[^']*')/g,
  ]) {
    for (const m of src.matchAll(re)) {
      const lit = m[1].slice(1, -1).trim()
      if (!lit || lit.length < 3) continue
      ;(lit.includes('${') ? shapes : fixed).add(lit)
    }
  }
}

const chars = set => [...set].reduce((n, s) => n + s.length, 0)
const usd = c => (c / 1000) * RATE

// A shape with the interpolations removed, plus a name-sized token for each.
const shapeChars = [...shapes].reduce((n, s) => {
  const vars = (s.match(/\$\{/g) || []).length
  return n + s.replace(/\$\{[^}]*\}/g, '').length + vars * 8
}, 0)

const fixedChars = chars(fixed)
const variantChars = shapeChars * TRACKS

console.log('WHAT THE STUDIO SAYS')
console.log(`  fixed responses        ${String(fixed.size).padStart(4)}   ${String(fixedChars).padStart(6)} characters`)
console.log(`  templated shapes       ${String(shapes.size).padStart(4)}   ${String(shapeChars).padStart(6)} characters of fixed wording`)
console.log(`  ...as strings (${TRACKS} tracks) ${String(shapes.size * TRACKS).padStart(4)}   ${String(variantChars).padStart(6)} characters`)

console.log(`\nRENDERING IT ONCE, at $${RATE.toFixed(2)} per 1,000 characters`)
console.log(`  the fixed set              $${usd(fixedChars).toFixed(2)}   — once, ever`)
console.log(`  every phrasing, per project $${usd(variantChars).toFixed(2)}   — once per project, if pre-rendered`)
console.log(`  both                      $${usd(fixedChars + variantChars).toFixed(2)}`)

console.log('\nNOT RENDERING IT AT ALL')
const avg = Math.round((fixedChars + shapeChars) / Math.max(1, fixed.size + shapes.size))
const perSession = PER_SESSION * avg
console.log(`  average response          ${avg} characters`)
console.log(`  ${PER_SESSION} responses in a session   ${perSession} characters  =  $${usd(perSession).toFixed(2)} per session`)
console.log(`  100 sessions              $${usd(perSession * 100).toFixed(2)}`)

console.log('\nWITH A CACHE')
// The saving is repetition, so it has to be modelled rather than asserted.
//
// Nobody uses eighty-six kinds of command on eight tracks in one sitting: they
// work on a few tracks with a handful of verbs, and say the same things about
// them over and over. The distinct set is therefore the shapes actually used
// times the tracks actually touched — everything past that is a cache hit.
//
// Both are parameters because both are guesses about how somebody works, and a
// number that decides the answer should be visible rather than buried.
const SHAPES_USED = arg('shapes-used', 20)
const TRACKS_TOUCHED = arg('tracks-touched', 5)
const distinctPerSession = Math.min(
  PER_SESSION,
  Math.round(fixed.size * 0.3) + SHAPES_USED * TRACKS_TOUCHED,
)
const cachedSession = distinctPerSession * avg
console.log(`  ${SHAPES_USED} command shapes on ${TRACKS_TOUCHED} tracks`)
console.log(`  distinct strings in a session  ~${distinctPerSession} of ${PER_SESSION} responses`
  + `  (${(PER_SESSION / Math.max(1, distinctPerSession)).toFixed(1)}x repeat)`)
console.log(`  first session             $${usd(cachedSession).toFixed(2)}`)
console.log(`  every session after       $${usd(cachedSession * 0.25).toFixed(2)}   (new names and numbers only)`)
console.log(`  100 sessions              $${usd(cachedSession + cachedSession * 0.25 * 99).toFixed(2)}`)

const naive = usd(perSession * 100)
const cached = usd(fixedChars + cachedSession + cachedSession * 0.25 * 99)
console.log(`\n  over 100 sessions: $${naive.toFixed(2)} uncached vs $${cached.toFixed(2)} cached`)
console.log(`  saving ${Math.round((1 - cached / naive) * 100)}%`)

console.log(`\nPER USER PER MONTH, if a user works 20 sessions`)
console.log(`  uncached  $${usd(perSession * 20).toFixed(2)}`)
console.log(`  cached    $${usd(cachedSession + cachedSession * 0.25 * 19).toFixed(2)}`)
console.log(`\n  at ~5,000 credits per dollar, the cached figure is`
  + ` ${Math.round(usd(cachedSession + cachedSession * 0.25 * 19) * 5000).toLocaleString()} credits of the user's balance.`)
