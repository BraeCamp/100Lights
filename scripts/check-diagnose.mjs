#!/usr/bin/env node
// Does window.__dawDiagnose() actually report what is happening?
//
//   node scripts/check-diagnose.mjs [baseUrl]
//
// A diagnostic that lies is worse than none, because it sends the next hour of
// work in the wrong direction. So this drives a known-good playback and checks
// the report agrees with it — and then mutes a track and checks the report
// notices, which is the thing it exists to detect.

import { chromium } from 'playwright'
import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const BASE = process.argv[2]?.replace(/\/$/, '') || `http://localhost:${process.env.PORT || '4618'}`
const FIXTURE = join(homedir(), 'Desktop', '100lights-ai-renders', 'Hallway Light.cfproj')
if (!existsSync(FIXTURE)) { console.log('no fixture — run scripts/song-hallwaylight.mjs'); process.exit(1) }
const dawProject = JSON.parse(readFileSync(FIXTURE, 'utf8')).dawProject

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

const browser = await chromium.launch({ args: ['--mute-audio'] })
const page = await browser.newPage()
page.on('pageerror', e => console.log('  page error:', e.message))
await page.goto(`${BASE}/create?modules=audio&audioMode=music`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(9000)
// Dismiss the first-run studio-tier chooser. It is a modal that intercepts
// pointer events, so it has to be gone before any click on the transport can
// land — and it can appear a moment after the page settles, so this waits for
// it rather than firing once and hoping.
const dialog = page.locator('[role="dialog"][aria-label="Choose your studio setup"]')
await dialog.waitFor({ state: 'visible', timeout: 20000 }).catch(() => {})
if (await dialog.count()) {
  await dialog.getByRole('button', { name: /Everything|Standard/i }).first().click().catch(() => {})
  await dialog.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {})
}
await page.waitForTimeout(1500)

check('the diagnostic exists without any dev flag',
  await page.evaluate(() => typeof window.__dawDiagnose === 'function'))

await page.evaluate(p => window.__dawDispatch?.({ type: 'LOAD_PROJECT', project: p }), dawProject)
await page.waitForTimeout(4000)

// A normal play-through.
await page.evaluate(() => window.__dawDiagnose())
const playBtn = page.locator('button[title="Play / Stop (Space)"]').first()
if (await playBtn.count()) await playBtn.click()
await page.waitForTimeout(25000)
const rep = await page.evaluate(() => window.__dawDiagnose.report())
await page.evaluate(() => window.__dawEngine?.stop())

console.log(`  context ${rep.context?.state} @ ${rep.context?.sampleRate}Hz, audio clock ${rep.audioClockRate}x`)
console.log(`  transport ${rep.transport?.fromBeat} -> ${rep.transport?.toBeat} (${rep.transport?.beatsPerSecond} beats/s)`)
console.log(`  master peak ${rep.master?.peak}, longest stall ${rep.longestStallMs}ms`)
// Only tracks whose notes fall inside the stretch actually played can be
// expected to have sounded. The first version of this asserted that EVERY track
// sounds in any 25-second window, and then blamed the diagnostic when Kick,
// Keys, Choir and Organ did not — they enter at beats 48, 48, 85 and 120, and
// playback had reached 17.8. The report was right; the assertion was not.
const names = new Map((dawProject.tracks ?? []).map(t => [t.id, t.name]))
const firstNote = new Map()
for (const c of dawProject.arrangementClips ?? []) {
  const n = names.get(c.trackId)
  for (const note of c.notes ?? []) {
    const b = (c.startBeat ?? 0) + (note.startBeat ?? 0)
    if (!firstNote.has(n) || b < firstNote.get(n)) firstNote.set(n, b)
  }
}
const reached = rep.transport?.toBeat ?? 0
const expected = [...firstNote].filter(([, b]) => b < reached - 1).map(([n]) => n)
const silent = expected.filter(n => !(rep.tracks || {})[n]?.everSounded)
console.log(`  played to beat ${reached.toFixed(1)}; expected to hear: ${expected.join(', ') || 'none'}`)
console.log(`  of those, silent: ${silent.length ? silent.join(', ') : 'none'}`)

check('it sees the audio clock running at real time',
  rep.audioClockRate > 0.9 && rep.audioClockRate < 1.1, String(rep.audioClockRate))
check('it sees the transport moving', rep.transport?.beatsPerSecond > 0.5,
  String(rep.transport?.beatsPerSecond))
check('it sees the master output', rep.master?.everSounded === true, String(rep.master?.peak))
check('it names tracks rather than printing ids',
  Object.keys(rep.tracks || {}).some(k => /^[A-Z][a-z]/.test(k) && k.length < 20),
  Object.keys(rep.tracks || {}).slice(0, 3).join(', '))
check('every track whose notes were reached did sound', silent.length === 0, silent.join(', ') || 'all sounded')

// Now BREAK one track on purpose. A diagnostic that cannot see a real fault is
// not going to find Brae's.
const muted = await page.evaluate(() => {
  const e = window.__dawEngine
  const [id, n] = [...e.trackNodes][0]
  n.gain.gain.value = 0
  n.effectsInput.gain.value = 0
  n.midiInput.gain.value = 0
  return id
})
await page.evaluate(() => window.__dawDiagnose())
if (await playBtn.count()) await playBtn.click()
await page.waitForTimeout(20000)
const rep2 = await page.evaluate(() => window.__dawDiagnose.report())
await page.evaluate(() => window.__dawEngine?.stop())
const silent2 = expected.filter(n => !(rep2.tracks || {})[n]?.everSounded)
console.log(`  after silencing one track, silent: ${silent2.length ? silent2.join(', ') : 'none'}`)
check('it notices a track that has been silenced', silent2.length >= 1,
  `${silent2.length} of the expected tracks went silent (muted ${muted.slice(0, 8)})`)

await browser.close()
console.log(failures ? `\n${failures} failing` : '\nthe diagnostic reports what is actually happening')
process.exit(failures ? 1 : 0)
