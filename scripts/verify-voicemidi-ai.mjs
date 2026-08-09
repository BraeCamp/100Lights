// Headless verification for VoiceMidi AI-instrument wiring.
//   1. /apps/voicemidi mounts, 0 console errors
//   2. the instrument <select> lists an "(AI)" option under an "AI Instruments" optgroup
//   3. seed + resolve + fulfill + decode one in-range AI sample → assert non-silent
//   node scripts/verify-voicemidi-ai.mjs
import { chromium } from 'playwright'

const BASE = 'http://localhost:3001'
const browser = await chromium.launch({
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required', '--disable-dev-shm-usage'],
})
const page = await browser.newPage()
const errors = []
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', e => errors.push('pageerror: ' + e.message))

console.log('→ opening', `${BASE}/apps/voicemidi`)
await page.goto(`${BASE}/apps/voicemidi`, { waitUntil: 'domcontentloaded' })

// 1. mount — wait for the debug probe hook the component installs.
await page.waitForFunction(() => typeof window.__voiceSampleProbe === 'function', null, { timeout: 60000 })
console.log('✓ VoiceMidi mounted (__voiceSampleProbe ready)')

// 2. picker lists AI instruments, grouped in an "AI Instruments" optgroup.
const picker = await page.evaluate(() => {
  const sel = document.querySelector('select[aria-label="Instrument"]')
  if (!sel) return { ok: false }
  const groups = [...sel.querySelectorAll('optgroup')].map(g => g.label)
  const aiOpts = [...sel.querySelectorAll('option')].map(o => o.textContent).filter(t => /\(AI\)/.test(t))
  return { ok: true, groups, aiOpts }
})
console.log('  optgroups:', JSON.stringify(picker.groups))
console.log('  (AI) options:', JSON.stringify(picker.aiOpts))
const hasAiGroup = picker.groups?.includes('AI Instruments')
const hasAiOpt = (picker.aiOpts?.length ?? 0) > 0
console.log(`  ${hasAiGroup ? '✓' : '✗'} "AI Instruments" optgroup present`)
console.log(`  ${hasAiOpt ? '✓' : '✗'} at least one "(AI)" option present`)

// 3. seed + resolve + decode one in-range Electric Guitar (AI) note → non-silent.
console.log('→ seeding AI packs + probing Electric Guitar (AI) E3 (midi 52) …')
const probe = await page.evaluate(() => window.__voiceSampleProbe('Electric Guitar (AI) – All Notes', 52))
console.log('  probe:', JSON.stringify(probe))
const pianoProbe = await page.evaluate(() => window.__voiceSampleProbe('Grand Piano (AI) – All Notes', 60))
console.log('  probe (Grand Piano AI C4):', JSON.stringify(pianoProbe))

await browser.close()

console.log('\nConsole errors:', errors.length)
for (const e of errors.slice(0, 10)) console.log('  [err]', e.slice(0, 200))

const nonSilent = probe?.ok && probe.max > 0.01
const pianoOk = pianoProbe?.ok && pianoProbe.max > 0.01
const pass = errors.length === 0 && hasAiGroup && hasAiOpt && nonSilent && pianoOk
console.log(`\n${pass ? '✓ PASS' : '✗ FAIL'} — guitar max ${probe?.max}, piano max ${pianoProbe?.max}, errors ${errors.length}`)
process.exit(pass ? 0 : 1)
