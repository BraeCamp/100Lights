// End-to-end mount test for the VoiceMidi Tracker (HMM/Onset) toggle.
//   • page mounts, 0 console errors, __voice* hooks present
//   • default segmenter = 'hmm' (matches the code default)
//   • record→refine through a SYNTHETIC mic tone-stream produces notes (HMM)
//   • flipping the Tracker toggle to Onset re-analyzes the SAME take and produces notes
//   • the choice persists to localStorage
//
//   node scripts/verify-voicemidi-tracker-toggle.mjs
import { chromium } from 'playwright'

const BASE = process.env.BASE || 'http://localhost:3001'

// A short sung melody the fake getUserMedia streams into the live detector.
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
await page.waitForFunction(() => typeof window.__voiceAnalyzeBuffer === 'function'
  && typeof window.__voiceGetSegmenter === 'function'
  && typeof window.__VoiceLivePitchDetector === 'function', null, { timeout: 60000 })
console.log('✓ VoiceMidi mounted\n')

// Default segmenter = hmm
const def = await page.evaluate(() => window.__voiceGetSegmenter())
rec(`default segmenter is 'hmm'`, def === 'hmm', `(got '${def}')`)

// Both segmenters produce notes directly via the pure hook (fast sanity).
const direct = await page.evaluate(() => {
  const SR = 44100, mtof = m => 440 * Math.pow(2, (m - 69) / 12)
  function render(dur, fq, am) { const N = Math.round(dur * SR), o = new Float32Array(N); let ph = 0; for (let i = 0; i < N; i++) { const t = i / SR; ph += fq(t) / SR; ph -= Math.floor(ph); o[i] = 2 * (ph - 0.5) * am(t) } return o }
  const midis = [60, 62, 64, 65, 67]; const notes = midis.map((m, i) => ({ midi: m, start: 0.1 + i * 0.4, dur: 0.34 }))
  const noteAt = t => { let c = null; for (const n of notes) if (t >= n.start && t < n.start + n.dur) c = n; return c }
  const fq = t => mtof((noteAt(t) ?? notes[0]).midi)
  const am = t => { const n = noteAt(t); if (!n) return 0; const e = Math.min(t - n.start, n.start + n.dur - t); return 0.3 * Math.max(0, Math.min(1, e / 0.008)) }
  const buf = render(2.2, fq, am)
  return {
    hmm: window.__voiceAnalyzeBuffer(buf, SR, { minDuration: 0.08, segmenter: 'hmm' }).notes.length,
    onset: window.__voiceAnalyzeBuffer(buf, SR, { minDuration: 0.08, segmenter: 'onset' }).notes.length,
  }
})
rec('hook: HMM segmenter produces notes', direct.hmm > 0, `(${direct.hmm})`)
rec('hook: onset segmenter produces notes', direct.onset > 0, `(${direct.onset})`)

// ── Full UI path: record → refine (HMM) → toggle to Onset → re-refine ──────────
// Click the record button, let the fake tone stream play, then stop.
await page.getByRole('button', { name: /Sing a tune/ }).click()
await page.waitForTimeout(CAPTURE_S * 1000)
await page.getByRole('button', { name: /Stop/ }).first().click()

// Wait for the refine to finish and the note strip to render.
await page.waitForSelector('[data-testid="vm-note-strip"]', { timeout: 30000 })
await page.waitForFunction(() => !document.body.textContent?.includes('Refining take'), null, { timeout: 30000 })

const trackerHmm = await page.$('[data-testid="vm-tracker-hmm"]')
const trackerOnset = await page.$('[data-testid="vm-tracker-onset"]')
rec('Tracker HMM button renders', !!trackerHmm)
rec('Tracker Onset button renders', !!trackerOnset)

const noteCount = async () => page.evaluate(() => {
  const el = [...document.querySelectorAll('span')].find(s => /\d+\s+notes?$/.test(s.textContent || ''))
  const m = el?.textContent?.match(/(\d+)\s+notes?/)
  return m ? +m[1] : 0
})
const hmmNotes = await noteCount()
rec('HMM refine produced notes (UI)', hmmNotes > 0, `(${hmmNotes} notes)`)
rec('active segmenter still hmm', (await page.evaluate(() => window.__voiceGetSegmenter())) === 'hmm')

// Flip to Onset → re-analyze the same take.
await page.click('[data-testid="vm-tracker-onset"]')
await page.waitForFunction(() => !document.body.textContent?.includes('Refining take'), null, { timeout: 30000 })
await page.waitForTimeout(300)
const onsetNotes = await noteCount()
rec('Onset re-refine produced notes (UI)', onsetNotes > 0, `(${onsetNotes} notes)`)
rec('active segmenter now onset', (await page.evaluate(() => window.__voiceGetSegmenter())) === 'onset')
rec('choice persisted to localStorage', (await page.evaluate(() => localStorage.getItem('voicemidi-segmenter'))) === 'onset')

// Flip back to HMM to confirm it round-trips.
await page.click('[data-testid="vm-tracker-hmm"]')
await page.waitForFunction(() => !document.body.textContent?.includes('Refining take'), null, { timeout: 30000 })
await page.waitForTimeout(200)
rec('toggles back to hmm', (await page.evaluate(() => window.__voiceGetSegmenter())) === 'hmm')

console.log(`\n  console errors: ${errors.length}`)
for (const e of errors.slice(0, 8)) console.log('   [err]', e.slice(0, 160))
rec('0 console errors', errors.length === 0)

await browser.close()
console.log(`\n${allPass ? '✓ ALL PASS' : '✗ SOME FAIL'}`)
process.exit(allPass ? 0 : 1)
