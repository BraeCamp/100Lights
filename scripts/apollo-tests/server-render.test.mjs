#!/usr/bin/env node
// The SERVER's way of booting the engine, which is not the CLI's.
//
//   node --experimental-strip-types scripts/apollo-tests/server-render.test.mjs
//
// ⚠️ This test exists because its absence broke a deploy. render-host has two
// ways to find the engine: a relative import (a script, with the repo on disk)
// and an injected source string (a deployed function, where neither the repo
// layout nor the TypeScript exists). Only the first was ever exercised, so the
// second was written, type-checked, passed a local `next build`, and failed on
// Vercel — where the build runs under Turbopack, which refuses an import whose
// specifier is computed: "Module not found: Can't resolve <dynamic>".
//
// The lesson is not about Turbopack. It is that the production path had no
// test, so every green light was reporting on the other one.

import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createRenderHost, apolloModules } from '../../lib/apollo/render-host.mjs'

// A child process reports ONE thing on stdout — the hash — so its own check
// lines would be read back as part of that hash. (They were.)
const isChild = !!process.env.APOLLO_ROUTE
let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  if (!isChild) console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

const source = readFileSync(new URL('../../public/apollo/engine.js', import.meta.url), 'utf8')
const mods = await apolloModules()
const patch = mods.initPatch()

// The server hands over BOTH: the engine as text, and the modules it would
// otherwise have read off disk as TypeScript.
// The parent (and the 'source' child) inject the engine text; the 'file' child
// takes the relative-import route a plain script uses.
const useFile = process.env.APOLLO_ROUTE === 'file'
const host = await createRenderHost(
  useFile ? { patch, bpm: 120 } : { patch, bpm: 120, modules: mods, engineSource: source },
)
host.finish()
const out = host.render([{ note: 52, t: 0, dur: 1.2, vel: 0.9 }], 2)

check('the injected engine boots at all', !!out?.left?.length, `${out?.left?.length ?? 0} frames`)
check('and the engine reported no faults', host.errors().length === 0, host.errors().join(' | '))

let sum = 0
for (let i = 0; i < out.left.length; i++) sum += out.left[i] * out.left[i]
const rms = Math.sqrt(sum / out.left.length)
// Silence is the failure mode that looks like success everywhere downstream —
// a render that "worked" and stores an empty clip under a shared cache key.
check('it makes a sound', rms > 0.001, `rms ${rms.toFixed(5)}`)
check('and the sound is finite', out.left.every(v => Number.isFinite(v)))

// Both routes into the engine must produce the SAME audio, or a clip rendered
// on the server is not the clip the CLI verified.
//
// ⚠️ In SEPARATE PROCESSES. loadEngineClass() caches the class at module scope,
// so a second host in this process reuses whichever route ran first — comparing
// them here would compare a thing with itself and always pass. This test made
// exactly that mistake before it made this call.
const hashOf = out => {
  let h = 0x811c9dc5
  for (let i = 0; i < out.length; i += 97) {
    h ^= Math.round(out[i] * 1e6) | 0
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16)
}

if (isChild) {
  // Child: boot by ONE route and report what it rendered.
  process.stdout.write(hashOf(out.left))
  process.exit(0)
}

const run = route => execFileSync(
  process.execPath,
  ['--experimental-strip-types', fileURLToPath(import.meta.url)],
  { env: { ...process.env, APOLLO_ROUTE: route }, encoding: 'utf8' },
).trim()

// The child renders through whichever branch its env selects; both children
// start clean, so each really does take its own route.
const viaSource = hashOf(out.left)
const viaFile = run('file')
check('injected source and file import render identically', viaSource === viaFile,
  `source ${viaSource} vs file ${viaFile}`)

console.log(failures ? `\n${failures} failing` : '\nthe server can boot the engine the way a deployed function has to')
assert.equal(failures, 0)
