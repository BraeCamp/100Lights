#!/usr/bin/env node
// Server loading, after the record of 2026-09-04: the parts were rendered and
// stored and the browser was refused on the hop to storage, then asked again
// four times a second forever; refused parts were never rendered here; and a
// bake could not START while the song played, so a fresh song's first listen
// was entirely live — seven live synths at once, and the audio thread gave out.
//
//   node --experimental-strip-types scripts/apollo-tests/server-loading.test.mjs

import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { importTs } from '../lib/ts-import.mjs'

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

const { serverAskQueue, explainServerFetchFailure, SERVER_RETRY_MS } = await importTs('lib/apollo/server-answers.ts')

// ── What to ask, given what it said ────────────────────────────────────────
{
  const wanted = ['a', 'b', 'c', 'd', 'e'].map(key => ({ key }))
  const now = 1_000_000
  const answered = new Map([
    ['b', { how: 'refused', at: now - 10, why: 'needs-samples' }],
    ['c', { how: 'failed', at: now - 10, why: 'cors' }],
    ['d', { how: 'failed', at: now - SERVER_RETRY_MS - 1, why: 'cors' }],
    ['e', { how: 'served', at: now - 10 }],
  ])
  const have = k => k === 'a'
  const q = serverAskQueue(wanted, have, answered, now).map(w => w.key)
  check('a part already held is not asked', !q.includes('a'))
  check('a refusal is asked once and never again', !q.includes('b'))
  check('a fresh failure is not asked again straight away', !q.includes('c'))
  check('an old failure is tried again', q.includes('d'))
  check('a part that was served and since evicted is asked again (a GET is cheap)', q.includes('e'))
  check('nothing answered yet is asked', serverAskQueue([{ key: 'z' }], () => false, new Map(), now).length === 1)
}

// ── Naming the cause ───────────────────────────────────────────────────────
{
  const err = new TypeError('Failed to fetch')
  const cors = explainServerFetchFailure(err, { type: 'opaqueredirect', status: 0 }, 'https://www.100lights.com')
  check('a route that redirects while the fetch threw is storage refusing the browser', /refused the render by storage/.test(cors) && /https:\/\/www\.100lights\.com/.test(cors), cors)
  const down = explainServerFetchFailure(err, null, 'https://www.100lights.com')
  check('a route that cannot be reached is reported as the error it was', down === 'Failed to fetch', down)
  const other = explainServerFetchFailure(err, { type: 'basic', status: 500 }, 'x')
  check('a route that answered something else is not blamed on storage', !/storage/.test(other))
}

// ── Wired into the loader ──────────────────────────────────────────────────
{
  const src = readFileSync('lib/apollo/freeze-cache.ts', 'utf8')
  check('the server pass uses the remembered answers', /const queue = serverAskQueue\(wanted, k => buffers\.has\(k\), serverAnswered\)/.test(src))
  check('a failure is named once per pass, with the cause', /logEvent\('window-error', \{\n\s+detail: `\$\{failed\} part\$\{failed === 1 \? '' : 's'\} could not be fetched from the server: \$\{failWhy\} — rendering them here`/.test(src))
  check('served parts are written to disk as well', /const serve = \(key: string, buf: AudioBuffer\) => \{[\s\S]*?void keepForNextTime\(key, buf\)/.test(src))
  check('the server branch sizes the cache to the song', /if \(serverLoading && serverPassFor !== groups\) \{[\s\S]*?setProjectNeed\(projectFramesOf\(wantedNow, bpm\)\)/.test(src))
  check('and hands what is still missing to the local bake', /serverPassFor = groups\n[\s\S]*?if \(wantedNow\.some\(w => !buffers\.has\(w\.key\)\)\) requestCombine\(bpm, groups\)/.test(src))
  check('Rule 0 parks only until the server has been asked for this set', /if \(serverLoading && serverPassFor !== lastGroups\) \{/.test(src))
  check('the old park is gone', !/this machine is not rendering/.test(src))
  check('a bake can START while the song plays when the worker renders it', /if \(transportPlaying && !canRenderInWorker\(\)\) \{\n\s+pendingWhilePlaying = true/.test(src))
  check('switching server loading on asks afresh', /if \(on\) \{ serverPassFor = null; serverAnswered\.clear\(\) \}/.test(src))
  check('closing the project forgets the answers', /export function clearCombined\(\): void \{\n\s+serverPassFor = null\n\s+serverAnswered\.clear\(\)/.test(src))
  // ── The rotating eviction ────────────────────────────────────────────────
  check('the cache is sized to renders WITH their tails, in both branches', /\(w\.clip\.durationBeats \* spb \+ RENDER_TAIL_SEC\) \* 48_000/.test(src) && (src.match(/setProjectNeed\(projectFramesOf\(/g) ?? []).length === 2)
  check('and what a pass just rendered is never the thing evicted', /evictIfNeeded\(new Set\(landed\)\)/.test(src) && /if \(protect\.has\(key\)\) continue/.test(src))
}

console.log(failures ? `\n${failures} failing` : '\nserver loading, remembered')
assert.equal(failures, 0)
