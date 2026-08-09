// End-to-end test for the VoiceMidi CORRECTION + learning-capture feature.
//   • page mounts, 0 console errors, __voiceCorrections hook present
//   • record→refine (synthetic mic) produces a take + the edit/Save/Export/Clear UI renders
//   • programmatically EDIT the corrected notes (change a pitch, add one, delete one)
//   • SAVE → listCorrections() returns a record whose corrected reflects the edits,
//     detected differs, evidence arrays are non-empty + length-consistent, audio decodes
//     to ~the take length, and exportCorrections() yields valid JSON containing it
//
//   node scripts/verify-voicemidi-corrections.mjs
import { chromium } from 'playwright'

const BASE = process.env.BASE || 'http://localhost:3001'

const MELODY = [
  { freq: 293.66, t0: 0.10, t1: 0.55 }, // D4
  { freq: 329.63, t0: 0.65, t1: 1.10 }, // E4
  { freq: 392.00, t0: 1.20, t1: 1.65 }, // G4
  { freq: 440.00, t0: 1.75, t1: 2.20 }, // A4
]
const CAPTURE_S = 2.5

const browser = await chromium.launch({
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required', '--disable-dev-shm-usage', '--use-fake-ui-for-media-stream'],
})
const page = await browser.newPage()
const errors = []
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', e => errors.push('pageerror: ' + e.message))

await page.addInitScript((melody) => {
  const build = () => {
    const AC = window.AudioContext || window.webkitAudioContext
    const ctx = new AC()
    const osc = ctx.createOscillator(); osc.type = 'sawtooth'
    const gain = ctx.createGain()
    const dest = ctx.createMediaStreamDestination()
    osc.connect(gain); gain.connect(dest)
    const t = ctx.currentTime + 0.05
    gain.gain.setValueAtTime(0, t)
    for (const n of melody) {
      osc.frequency.setValueAtTime(n.freq, t + n.t0)
      gain.gain.setValueAtTime(0.3, t + n.t0)
      gain.gain.setValueAtTime(0.0, t + n.t1)
    }
    osc.start(t)
    ;(window.__fakeKeep = window.__fakeKeep || []).push({ ctx, osc, gain, dest })
    return dest.stream
  }
  if (!navigator.mediaDevices) Object.defineProperty(navigator, 'mediaDevices', { value: {}, configurable: true })
  navigator.mediaDevices.getUserMedia = async () => build()
}, MELODY)

let allPass = true
const P = ok => ok ? '✓' : '✗'
const rec = (name, ok, extra = '') => { allPass = allPass && ok; console.log(`  ${P(ok)} ${name}${extra ? '  ' + extra : ''}`) }

console.log('→', `${BASE}/apps/voicemidi`)
await page.goto(`${BASE}/apps/voicemidi`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => typeof window.__voiceCorrections === 'object'
  && typeof window.__voiceCorrections.save === 'function'
  && typeof window.__voiceAnalyzeBuffer === 'function', null, { timeout: 60000 })
console.log('✓ VoiceMidi mounted (__voiceCorrections ready)\n')

// Start from a clean store.
await page.evaluate(() => window.__voiceCorrections.clear())
rec('store cleared', (await page.evaluate(() => window.__voiceCorrections.count())) === 0)

// ── Record → refine ────────────────────────────────────────────────────────────
await page.getByRole('button', { name: /Sing a tune/ }).click()
await page.waitForTimeout(CAPTURE_S * 1000)
await page.getByRole('button', { name: /Stop/ }).first().click()
await page.waitForSelector('[data-testid="vm-note-strip"]', { timeout: 30000 })
await page.waitForFunction(() => !document.body.textContent?.includes('Refining take'), null, { timeout: 30000 })

// UI affordances present.
rec('note strip renders', !!(await page.$('[data-testid="vm-note-strip"]')))
rec('Save button renders', !!(await page.$('[data-testid="vm-save-correction"]')))
rec('Export button renders', !!(await page.$('[data-testid="vm-export-corrections"]')))
rec('Clear button renders', !!(await page.$('[data-testid="vm-clear-corrections"]')))
rec('count label renders', !!(await page.$('[data-testid="vm-corrections-count"]')))

const detected = await page.evaluate(() => window.__voiceCorrections.getDetected())
rec('refine produced detected notes', detected.length > 0, `(${detected.length})`)

// ── Programmatic edit: change a pitch, add one, delete one ──────────────────────
await page.evaluate(() => {
  const notes = window.__voiceCorrections.getNotes().map(n => ({ ...n }))
  if (notes.length > 0) notes[0] = { ...notes[0], midi: notes[0].midi + 3 }   // pitch change
  notes.push({ startSec: 2.4, midi: 72, durSec: 0.3, velocity: 0.8 })          // add
  if (notes.length > 1) notes.splice(1, 1)                                     // delete one
  window.__voiceCorrections.applyEdit(notes)
})
await page.waitForTimeout(250)
const editedBadge = await page.$('[data-testid="vm-edited-badge"]')
rec('edited badge shows after edit', !!editedBadge)

// ── Save the correction ─────────────────────────────────────────────────────────
const saved = await page.evaluate(async () => await window.__voiceCorrections.save())
rec('save returned a record', !!saved && !!saved.id)
rec('record marked edited', saved?.edited === true)

// ── Assertions on the listed record ─────────────────────────────────────────────
const list = await page.evaluate(() => window.__voiceCorrections.list())
rec('listCorrections returns exactly 1', list.length === 1, `(${list.length})`)
const r = list[0]

const corrected = await page.evaluate(() => window.__voiceCorrections.getNotes())
rec('record.corrected matches current edited notes', !!r && r.corrected.length === corrected.length
  && r.corrected.every((n, i) => Math.abs(n.midi - corrected[i].midi) < 1e-6
    && Math.abs(n.startSec - corrected[i].startSec) < 1e-6), `(${r?.corrected.length} notes)`)
rec('record.detected differs from corrected', !!r && JSON.stringify(r.detected) !== JSON.stringify(r.corrected))
rec('diff reflects an added note', !!r && r.diff && r.diff.added >= 1, `(diff=${JSON.stringify(r?.diff)})`)

// Evidence non-empty + length-consistent across every per-frame array.
const ev = r?.evidence
const evLens = ev ? [ev.time.length, ev.midi.length, ev.clarity.length, ev.flux.length, ev.energy.length, ev.pitchDelta.length] : []
rec('evidence arrays non-empty', !!ev && ev.time.length > 0, `(len ${ev?.time.length})`)
rec('evidence arrays length-consistent', evLens.length > 0 && evLens.every(l => l === evLens[0]), `(${evLens.join(',')})`)
rec('evidence has onsets array', !!ev && Array.isArray(ev.onsets))

// Audio decodes back to ~the take length.
rec('audio present (int16 base64)', !!r && r.audio.encoding === 'int16' && r.audio.samples > 0 && r.audio.pcmBase64.length > 0,
  `(${r?.audio.samples} smp @ ${r?.audio.sampleRate}Hz, ${r?.audio.pcmBase64.length}b64)`)
rec('audio ≤ 16 kHz', !!r && r.audio.sampleRate <= 16000, `(${r?.audio.sampleRate})`)
// Decode the base64 Int16 back to PCM and confirm it round-trips to the stored sample
// count and spans the analyzed evidence frames (i.e. re-analyzable at ~the take length).
const decoded = await page.evaluate((audio) => {
  const bin = atob(audio.pcmBase64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  const int16 = new Int16Array(bytes.buffer, 0, Math.floor(bytes.length / 2))
  return { len: int16.length }
}, r.audio)
const lastFrameT = ev && ev.time.length ? ev.time[ev.time.length - 1] : 0
rec('audio decodes to stored sample count', !!r && decoded.len === r.audio.samples, `(${decoded.len} == ${r?.audio.samples})`)
rec('audio spans the analyzed frames', !!r && r.audio.durSec > 0.3 && r.audio.durSec + 0.15 >= lastFrameT,
  `(${r?.audio.durSec?.toFixed(2)}s covers ${lastFrameT.toFixed(2)}s)`)
// Approx payload size (KB) for the report.
const kb = r ? (r.audio.pcmBase64.length / 1024).toFixed(0) : '?'
console.log(`     audio payload ≈ ${kb} KB base64`)

// Settings snapshot.
rec('settings captured', !!r && typeof r.settings.sensitivity === 'number'
  && (r.settings.tracker === 'hmm' || r.settings.tracker === 'onset')
  && typeof r.settings.bpm === 'number', `(${JSON.stringify(r?.settings)})`)

// ── Export yields valid JSON containing the record ──────────────────────────────
const exp = await page.evaluate(async () => {
  const blob = await window.__voiceCorrections.export()
  const text = await blob.text()
  return { type: blob.type, text }
})
let parsed = null
try { parsed = JSON.parse(exp.text) } catch { /* invalid */ }
rec('export is application/json', exp.type === 'application/json')
rec('export parses as JSON', !!parsed)
rec('export contains the saved record', !!parsed && parsed.count === 1 && parsed.corrections?.[0]?.id === r.id)
rec('export includes a systematic summary', !!parsed && !!parsed.summary && typeof parsed.summary.count === 'number')

// ── Clear ────────────────────────────────────────────────────────────────────────
await page.evaluate(() => window.__voiceCorrections.clear())
rec('clear empties the store', (await page.evaluate(() => window.__voiceCorrections.count())) === 0)

console.log(`\n  console errors: ${errors.length}`)
for (const e of errors.slice(0, 8)) console.log('   [err]', e.slice(0, 160))
rec('0 console errors', errors.length === 0)

await browser.close()
console.log(`\n${allPass ? '✓ ALL PASS' : '✗ SOME FAIL'}`)
process.exit(allPass ? 0 : 1)
