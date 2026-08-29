#!/usr/bin/env node
/**
 * Does EVERY track make a sound when you press play?
 *
 *   PORT=4620 node scripts/check-live-tracks.mjs ~/Desktop/100lights-songs/Drift.cfproj
 *
 * Brae: "It needs to render live when played, but it's only rendering 2 of the
 * four instruments."
 *
 * Two of four is a suspiciously specific number — daw-freeze's own comment says
 * "a browser only keeps a couple of audio contexts alive, so the first one or
 * two produce audio and the rest come back silent" — so the first job is to
 * find out WHICH two, because that decides whether this is contention (any two)
 * or a whole class of instrument failing (always the same two).
 *
 * __dawDiagnose already samples every track's analyser while the transport runs
 * and reports whether it ever crossed the noise floor. That is the measurement;
 * this just drives it against a real project file.
 */

import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'

const BASE = `http://localhost:${process.env.PORT || '4700'}`
const file = process.argv.slice(2).find(a => !a.startsWith('--'))
if (!file) { console.error('usage: check-live-tracks.mjs <song.cfproj>'); process.exit(2) }
const WATCH_SEC = Number(process.env.SECONDS || 25)

const saved = JSON.parse(readFileSync(file, 'utf8'))
const project = saved.dawProject ?? saved
console.log(`${project.name} — ${project.tracks.length} tracks, ${project.arrangementClips.length} clips`)
for (const t of project.tracks) {
  const kind = t.instrument?.type === 'none' ? 'preset-only' : t.instrument?.type
  const clips = project.arrangementClips.filter(c => c.trackId === t.id)
  const preset = [...new Set(clips.map(c => c.presetId).filter(Boolean))].join(',') || '—'
  console.log(`  ${t.name.padEnd(7)} ${String(kind).padEnd(12)} preset ${preset.padEnd(12)} ${clips.length} clips`)
}

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } })
page.on('pageerror', e => console.log('  page error:', String(e).slice(0, 160)))
// The engine reports real trouble through the console — a preset with no
// samples, an effect that failed to build. A track that goes silent with
// nothing logged and a track that logs its reason look identical from outside
// the page, so capture it.
page.on('console', m => {
  const t = m.text()
  if (/error|warn|fail|preset|effect|NaN|non-finite/i.test(t) && !/Fast Refresh|DevTools/i.test(t)) {
    console.log(`  console.${m.type()}: ${t.slice(0, 200)}`)
  }
})
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
await page.waitForTimeout(1500)

// Cold: nothing baked, so this measures LIVE playback, which is what was asked
// about. A warm cache would answer a different question.
await page.evaluate(() => window.__clearCombined?.())
await page.evaluate(p => window.__dawDispatch({ type: 'LOAD_PROJECT', project: p }), project)
await page.waitForTimeout(4000)

await page.evaluate(async () => {
  try { await window.__dawEngine?.ctx?.resume?.() } catch { /* already running */ }
  window.__dawDiagnose?.()
  window.__dawEngine?.play?.()
})
for (let i = 0; i < WATCH_SEC; i++) {
  await page.waitForTimeout(1000)
  if (i % 8 === 0) {
    const s = await page.evaluate(() => {
      const c = window.__combineStats?.()
      return { ready: c?.ready ?? 0, beat: window.__dawEngine?.currentBeat ?? 0 }
    })
    console.log(`   ${String(i + 1).padStart(2)}s  baked=${s.ready}  beat=${s.beat.toFixed(1)}`)
  }
}

const rep = await page.evaluate(() => {
  const r = window.__dawDiagnose?.report?.()
  window.__dawEngine?.stop?.()
  return typeof r === 'string' ? { note: r } : r
})
const smp = await page.evaluate(() => window.__sampleStats?.() ?? null)
await browser.close()

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

console.log()
if (rep?.note) { console.log(rep.note); process.exit(2) }
console.log(`audio clock ${rep.audioClockRate?.toFixed?.(3)} · longest stall ${rep.longestStallMs}ms · master peak ${rep.master?.peak}`)
if (smp) console.log(`samples: asked ${smp.asked}, decoded ${smp.decoded}, reused ${smp.reused}, missing ${smp.missing}, notReady ${smp.notReady}`)
console.log()
console.log('track            sounded    peak   % of time above noise')
const names = Object.keys(rep.tracks ?? {})
for (const n of names) {
  const t = rep.tracks[n]
  console.log(`  ${n.padEnd(14)} ${t.everSounded ? ' yes' : ' NO '}   ${String(t.peak).padStart(7)}   ${t.soundedPct}%`)
}
const silent = names.filter(n => !rep.tracks[n].everSounded)
console.log()
check('the master output made a sound', !!rep.master?.everSounded, `peak ${rep.master?.peak}`)
check('every track made a sound', silent.length === 0,
  silent.length ? `silent: ${silent.join(', ')}` : `all ${names.length}`)

console.log(failures ? `\n${failures} failing` : '\nevery instrument sounds when you press play')
process.exit(failures ? 1 : 0)
