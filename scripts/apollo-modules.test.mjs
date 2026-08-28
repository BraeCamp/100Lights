#!/usr/bin/env node
// The module manifest: is every path in it real?
//
//   npm run test:modules
//
// A knob whose param path does not exist still renders — it just does nothing
// when you turn it. Same for an enable path: the toggle moves, the sound does
// not change. Both failures are invisible in a screenshot and obvious the
// moment someone tries to use the thing, which is the worst order to find out.
//
// So every path in the manifest is resolved against a real initPatch() here.

import assert from 'node:assert'
import Module from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// The compiled output keeps the app's '@/' alias in its require() calls, and
// Node has never heard of it. Map it onto the same .test-build tree rather
// than rewriting the source, which would make lib/apollo/patch.ts different
// from every other module in the app just to suit a test.
const BUILD = join(dirname(fileURLToPath(import.meta.url)), '..', '.test-build')
const origResolve = Module._resolveFilename
Module._resolveFilename = function (request, ...rest) {
  if (request.startsWith('@/lib/')) request = join(BUILD, request.slice('@/lib/'.length) + '.js')
  return origResolve.call(this, request, ...rest)
}

// Both loaded through require AFTER the hook is installed. A static `import`
// here would be hoisted above the hook and fail on the very alias it exists to
// resolve — which is exactly what happened the first time.
const require = Module.createRequire(import.meta.url)
const { initPatch, PARAM_MAP, resolvePatchPath } = require('../.test-build/apollo/patch.js')
const {
  APOLLO_MODULES, MODULE_BY_ID, GROUP_LABEL,
  moduleIsOn, moduleCanToggle, setModuleOn, liveKnobs, shortLabel,
} = require('../.test-build/apollo/modules.js')

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

const patch = initPatch()
const read = (p, path) => {
  let cur = p
  for (const part of resolvePatchPath(path).split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = cur[part]
  }
  return cur
}

console.log(`  ${APOLLO_MODULES.length} modules, ${APOLLO_MODULES.reduce((n, m) => n + m.knobs.length, 0)} knobs declared\n`)

// ── Every knob is a real, turnable parameter ────────────────────────────────
const deadKnobs = []
for (const m of APOLLO_MODULES) {
  for (const path of m.knobs) {
    if (!PARAM_MAP[path]) { deadKnobs.push(`${m.id}: ${path}`); continue }
    if (typeof read(patch, path) !== 'number') deadKnobs.push(`${m.id}: ${path} (not a number on the patch)`)
  }
}
check('every knob path is a real parameter', deadKnobs.length === 0, deadKnobs.slice(0, 4).join(', ') || 'all live')
check('liveKnobs() agrees with the manifest',
  APOLLO_MODULES.every(m => liveKnobs(m).length === m.knobs.length))

// ── Every enable path is a real boolean ─────────────────────────────────────
const deadSwitches = []
for (const m of APOLLO_MODULES) {
  for (const path of m.enablePaths) {
    if (typeof read(patch, path) !== 'boolean') deadSwitches.push(`${m.id}: ${path}`)
  }
}
check('every enable path is a real boolean', deadSwitches.length === 0, deadSwitches.join(', ') || 'all live')

// ── Toggling actually changes the patch ─────────────────────────────────────
for (const m of APOLLO_MODULES.filter(moduleCanToggle)) {
  const p = initPatch()
  setModuleOn(p, m, true)
  const onAfter = moduleIsOn(p, m)
  setModuleOn(p, m, false)
  const offAfter = moduleIsOn(p, m)
  check(`${m.id} can be switched on and off`, onAfter && !offAfter, `on=${onAfter} off=${offAfter}`)
}

// Switching a multi-switch module back ON must not light everything: turning
// "Sub / Noise" on should not start a noise source nobody asked for.
const sn = MODULE_BY_ID.subnoise
const p2 = initPatch()
setModuleOn(p2, sn, true)
check('switching a module on lights only its first switch',
  read(p2, 'sub.enabled') === true && read(p2, 'noise.enabled') === false,
  `sub=${read(p2, 'sub.enabled')} noise=${read(p2, 'noise.enabled')}`)

// …and switching OFF must clear all of them, or the module reads as off while
// still making sound.
const p3 = initPatch()
p3.sub.enabled = true; p3.noise.enabled = true
setModuleOn(p3, sn, false)
check('switching a module off clears every switch',
  !moduleIsOn(p3, sn) && read(p3, 'noise.enabled') === false)

// ── The modules with no switch are named, not hidden ────────────────────────
const noToggle = APOLLO_MODULES.filter(m => !moduleCanToggle(m)).map(m => m.id)
console.log(`  cannot be switched off yet: ${noToggle.join(', ')}`)
check('only envelopes and LFOs lack a switch among modulation sources',
  noToggle.includes('env') && noToggle.includes('lfo'),
  noToggle.join(', '))
check('and a module with no switch reads as on',
  APOLLO_MODULES.filter(m => !moduleCanToggle(m)).every(m => moduleIsOn(patch, m)))

// ── Bar labels have to fit ──────────────────────────────────────────────────
// A knob is 30px wide; past about seven characters the label is clipped, and
// a clipped label is worse than a short one — "NOISE LE…" and "NOISE PI…" are
// the same word to anyone glancing at a bar.
const MAX_LABEL = 7
const longLabels = []
for (const m of APOLLO_MODULES) {
  for (const path of liveKnobs(m)) {
    const l = shortLabel(path, m)
    if (l.length > MAX_LABEL) longLabels.push(`${m.id}: ${path} → "${l}"`)
  }
}
check(`bar labels fit under a knob (${MAX_LABEL} chars)`, longLabels.length === 0,
  longLabels.slice(0, 4).join(', ') || 'all fit')

// And no bar may show the same label twice, which is what happens when the
// qualifier is stripped from "Sub Level" and "Noise Level".
const dupes = []
for (const m of APOLLO_MODULES) {
  const labels = liveKnobs(m).map(p => shortLabel(p, m))
  const seen = new Set()
  for (const l of labels) { if (seen.has(l)) dupes.push(`${m.id}: "${l}"`); seen.add(l) }
}
check('no bar labels two knobs the same', dupes.length === 0, dupes.join(', ') || 'all distinct')
console.log(`    envelopes: ${liveKnobs(MODULE_BY_ID.env).map(p => shortLabel(p, MODULE_BY_ID.env)).join(', ')}`)
console.log(`    sub/noise: ${liveKnobs(MODULE_BY_ID.subnoise).map(p => shortLabel(p, MODULE_BY_ID.subnoise)).join(', ')}`)

// ── Structure ───────────────────────────────────────────────────────────────
check('every module belongs to a named group',
  APOLLO_MODULES.every(m => !!GROUP_LABEL[m.group]))
check('module ids are unique', new Set(APOLLO_MODULES.map(m => m.id)).size === APOLLO_MODULES.length)
check('every module says what it is', APOLLO_MODULES.every(m => m.blurb.length > 20 && m.name.length > 0))
// Macros carries eight knobs on purpose: it is the module that proves the
// overflow control works rather than being a hypothetical.
check('at least one module has more knobs than a bar can show',
  APOLLO_MODULES.some(m => m.knobs.length >= 7),
  `${MODULE_BY_ID.macros.knobs.length} on Macros`)

console.log(failures ? `\n${failures} failing` : '\nevery path in the manifest is live')
assert.equal(failures, 0)
