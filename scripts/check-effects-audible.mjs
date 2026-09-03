#!/usr/bin/env node
/**
 * Can any effect silence the track it is on?
 *
 *   PORT=4622 node scripts/check-effects-audible.mjs
 *   PORT=4622 SWEEP=reverb node scripts/check-effects-audible.mjs   (one type, many params)
 *
 * Brae: "test with every type of audio change that we have in Beacon and the
 * Apollo plugin in Beacon".
 *
 * An effect must never be able to make a track inaudible. Most have a dry path
 * or a mix control that cannot reach zero, and the ones that CAN attenuate
 * (a gate, a limiter) still pass signal at their defaults. So "the track went
 * silent" is a bug for every entry in the catalog, and this walks the catalog
 * rather than the one effect that happened to be noticed.
 *
 * It measures the MASTER as well as the track. A silent track with a healthy
 * master would mean the analyser tap moved, not that the audio stopped — a
 * distinction that already cost a wrong diagnosis once in this codebase.
 *
 * Two routes are tested per effect, because Beacon has two. Track effects run
 * through APOLLO/HELIOS by default (`heliosFx !== false`), and fall back to the
 * plain WebAudio chain when that is off. An effect that is silent on one and
 * fine on the other pins the fault to that subsystem immediately.
 */

import { chromium } from 'playwright'
import { importTs } from './lib/ts-import.mjs'
import { makeTrack, makeClip, makeNotes } from './lib/daw-fixture.mjs'

const BASE = `http://localhost:${process.env.PORT || '4700'}`
const SECONDS = Number(process.env.SECONDS || 6)
const ONLY = process.env.SWEEP || ''
const { ADD_OPTIONS, makeDefaultParams } = await importTs('lib/daw-effect-catalog.ts')
const { defaultProject } = await importTs('lib/daw-types.ts')

// A plain synth that is loud and continuous — the source must never be the
// reason a trial reads silent.
const INSTRUMENT = { type: 'poly', params: {
  waveform: 'sawtooth', attack: 0.005, decay: 0.1, sustain: 0.8, release: 0.2,
  detune: 6, filterType: 'lowpass', filterCutoff: 4000, filterResonance: 1,
  lfoEnabled: false, lfoRate: 4, lfoDepth: 0, lfoTarget: 'filter', lfoWaveform: 'sine' } }

function project(effects, heliosFx) {
  const track = makeTrack({ id: 't0', name: 'T', instrument: INSTRUMENT })
  track.effects = effects
  track.heliosFx = heliosFx
  track.volume = 0.8
  return {
    ...defaultProject(), tempo: 120, timeSignatureNum: 4,
    tracks: [track],
    arrangementClips: [makeClip({
      id: 'c0', trackId: 't0', name: 'c0', startBeat: 0, durationBeats: 32,
      notes: makeNotes(32, { step: 1, length: 0.9 }),
    })],
  }
}

// What to try. Defaults for every catalog entry, plus a parameter sweep for the
// ones with a continuous control worth walking.
const trials = []
if (ONLY) {
  const spread = {
    reverb:  [['decay', [0.5, 0.8, 1.0, 1.2, 1.5, 1.8, 2.0, 2.5, 3.0, 4.0, 6.0]],
              ['wet', [0, 0.25, 0.5, 1]],
              ['preDelay', [0, 0.02, 0.05, 0.2]]],
    delay:   [['time', [0.05, 0.2, 0.5, 1]], ['feedback', [0, 0.3, 0.6, 0.9]], ['wet', [0, 0.5, 1]]],
    chorus:  [['rate', [0.05, 0.3, 1, 5]], ['depth', [0, 0.3, 0.8]], ['mix', [0, 0.5, 1]]],
    filter:  [['frequency', [40, 200, 1000, 8000, 18000]], ['q', [0.1, 1, 8, 20]]],
    saturator: [['drive', [0, 0.2, 0.6, 1]]],
    redux:   [['bits', [1, 4, 8, 16]], ['rate', [500, 4000, 22050]]],
  }[ONLY]
  if (!spread) { console.error(`no sweep defined for "${ONLY}"`); process.exit(2) }
  for (const [key, values] of spread) {
    for (const v of values) {
      const params = { ...makeDefaultParams(ONLY), enabled: true, [key]: v }
      trials.push({ label: `${ONLY} ${key}=${v}`, effects: [{ id: 'fx', type: ONLY, params }] })
    }
  }
} else {
  for (const { type } of ADD_OPTIONS) {
    trials.push({
      label: type,
      effects: [{ id: 'fx', type, params: { ...makeDefaultParams(type), enabled: true } }],
    })
  }
}

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
page.on('pageerror', e => console.log('  page error:', String(e).slice(0, 140)))
await page.goto(`${BASE}/create?modules=audio&audioMode=music`, { waitUntil: 'domcontentloaded', timeout: 180000 })
await page.waitForFunction(() => !!window.__dawDispatch, null, { timeout: 240000 })
const dlg = page.locator('[role="dialog"][aria-label="Choose your studio setup"]')
if (await dlg.count()) {
  await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"][aria-label="Choose your studio setup"]')
    const b = d && [...d.querySelectorAll('button,div[role=button]')].find(e => /Everything/i.test(e.textContent || ''))
    b?.click()
  })
  await dlg.waitFor({ state: 'hidden', timeout: 20000 }).catch(() => {})
}
await page.waitForTimeout(1200)

async function run(p) {
  return page.evaluate(async ({ project, seconds }) => {
    window.__clearCombined?.()
    window.__dawDispatch({ type: 'LOAD_PROJECT', project })
    await new Promise(r => setTimeout(r, 1800))
    const eng = window.__dawEngine
    try { await eng?.ctx?.resume?.() } catch { /* running */ }
    eng?.seek?.(0)
    window.__dawDiagnose?.()
    eng?.play?.()
    await new Promise(r => setTimeout(r, seconds * 1000))
    const rep = window.__dawDiagnose?.report?.()
    eng?.stop?.()
    const t = typeof rep === 'string' ? null : Object.values(rep?.tracks ?? {})[0]
    return { peak: t?.peak ?? -1, master: rep?.master?.peak ?? -1 }
  }, { project: p, seconds: SECONDS })
}

// A baseline with no effects at all, so a silent result can be blamed on the
// effect rather than on the rig.
const base = await run(project([], true))
console.log(`baseline (no effects): track ${base.peak}  master ${base.master}`)
if (!(base.peak > 0)) { console.log('\nthe rig itself is silent — nothing below would mean anything'); await browser.close(); process.exit(2) }
console.log(`\n${trials.length} trials x 2 routes (Helios on / off), ${SECONDS}s each\n`)
console.log('effect                      helios          webaudio')

const silent = []
for (const t of trials) {
  const on = await run(project(t.effects, true))
  const off = await run(project(t.effects, false))
  const f = r => `${r.peak > 0 ? 'ok  ' : 'MUTE'} ${String(r.peak).padStart(7)}`
  console.log(`  ${t.label.padEnd(24)} ${f(on)}   ${f(off)}`)
  if (!(on.peak > 0) || !(off.peak > 0)) {
    silent.push({ label: t.label, helios: on.peak > 0, webaudio: off.peak > 0 })
  }
  await page.waitForTimeout(200)
}

await browser.close()
console.log()
if (!silent.length) {
  console.log('no effect silences its track')
  process.exit(0)
}
console.log(`${silent.length} silencing combination(s):`)
for (const s of silent) {
  const where = !s.helios && !s.webaudio ? 'BOTH routes' : !s.helios ? 'Helios only' : 'WebAudio only'
  console.log(`  ${s.label.padEnd(24)} ${where}`)
}
process.exit(1)
