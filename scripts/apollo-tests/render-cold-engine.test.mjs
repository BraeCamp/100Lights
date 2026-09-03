#!/usr/bin/env node
// A clip with FX Motion must be IN the render.
//
//   node --experimental-strip-types scripts/apollo-tests/render-cold-engine.test.mjs
//
// Found while verifying the tempo-change fix: FX Motion (or any effect bar
// under the notes) on an Apollo or translated-poly MIDI clip rendered as total
// silence offline, with no error, on the committed engine too.
//
// ⚠️ THE SCHEDULER CREATES ENGINES OF ITS OWN. preloadApolloInstrument warms
// one engine per TRACK destination. But a clip with FX Motion plays into a
// chain of its own, and an Apollo engine is keyed by its destination — so the
// single offline scheduling pass called ensure() on a node nobody had preloaded,
// a fresh engine began its async init, and the clip's notes went to its queue.
// apolloDrain() flushed only READY engines, so that queue was never delivered
// before startRendering(). Live playback hid it: the queue flushes when the
// engine comes up, a beat late. Beacon plugins queue the same way.

import assert from 'node:assert'
import { readFileSync } from 'node:fs'

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

const engine = readFileSync('lib/daw-engine.ts', 'utf8')
const apollo = readFileSync('lib/apollo/daw-instrument.ts', 'utf8')
const plugins = readFileSync('lib/beacon-plugins/host.ts', 'utf8')

{
  const at = engine.indexOf('async renderOffline(')
  // (to the CALL — a comment above the awaits mentions startRendering too)
  const body = engine.slice(at, engine.indexOf('await octx.startRendering()', at))
  check('the offline render waits for engines the scheduler created, before draining',
    /await apolloAwaitReady\(this\.ctx\)[\s\S]*await pluginAwaitReady\(this\.ctx\)[\s\S]*await apolloDrain\(this\.ctx\)/.test(body))
  check('and only after the scheduling pass that creates them',
    body.indexOf('this._tick()') < body.indexOf('apolloAwaitReady'))
}

{
  const fn = apollo.slice(apollo.indexOf('export async function apolloAwaitReady'))
  check('apolloAwaitReady waits on engines that are neither ready, released nor crashed',
    /!m\.released && !m\.engine\.crashed && !m\.isReady/.test(fn))
  check('polls rather than trusting a promise nobody kept', /setTimeout\(r, 25\)/.test(fn))
  check('and says so when it gives up', /not ready after/.test(fn))
  // The gap it closes: drain only ever flushed ready engines.
  check('(apolloDrain still flushes ready engines only — the wait is what makes that safe)',
    /filter\(m => m\.isReady\)\.map\(m => m\.engine\.flush\(\)\)/.test(apollo))
}

{
  const fn = plugins.slice(plugins.indexOf('export async function pluginAwaitReady'))
  check('plugins get the same wait', fn.length > 0 && /!m\.ready && !m\.failed/.test(fn))
}

console.log(failures ? `\n${failures} failing` : '\nevery clip is in the render')
assert.equal(failures, 0)
