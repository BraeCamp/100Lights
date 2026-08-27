// Does the DEPLOYED studio open Apollo on the sound you picked?
// Reads the DOM only — no automation hooks, which production does not expose.
import { chromium } from 'playwright'

const BASE = process.argv[2] || 'https://www.100lights.com'
const b = await chromium.launch()
const p = await b.newPage()
p.on('pageerror', e => console.log('pageerror:', e.message))
await p.goto(`${BASE}/create?modules=audio&audioMode=music`, { waitUntil: 'domcontentloaded' })
await p.waitForTimeout(12000)

// Dismiss the first-run studio-tier chooser, or everything below reads a DOM
// sitting behind a modal.
await p.evaluate(() => {
  const x = [...document.querySelectorAll('button')].find(e => /Everything|Standard/i.test(e.textContent || ''))
  x?.click()
})
await p.waitForTimeout(2000)

const drilled = await p.evaluate(() => {
  const x = [...document.querySelectorAll('button')].find(e => /Kick|Grand|Acoustic Guitar/i.test(e.textContent || ''))
  if (!x) return null
  x.click()
  return (x.textContent || '').trim().slice(0, 24)
})
console.log('drilled into:', drilled)
await p.waitForTimeout(2500)

const picked = await p.evaluate(() => {
  const rows = [...document.querySelectorAll('[data-selected], [draggable="true"]')]
  if (!rows.length) return null
  rows[0].click()
  return (rows[0].textContent || '').trim().slice(0, 30)
})
console.log('picked sound:', picked)
await p.waitForTimeout(2000)

await p.evaluate(() => {
  const x = [...document.querySelectorAll('button')].find(e => /apollo/i.test((e.textContent || '').trim()))
  x?.click()
})
await p.waitForTimeout(10000)

const state = await p.evaluate(() => {
  const sels = [...document.querySelectorAll('select')]
  const engineSel = sels.find(el => [...el.options].some(o => o.value === 'wavetable'))
  const slot = document.querySelector('[data-apollo-sample-slot]')
  return {
    rackOpen: /OSCILLATOR A|ENVELOPES/i.test(document.body.innerText),
    engineValue: engineSel ? engineSel.value : null,
    sampleSlot: slot ? (slot.textContent || '').trim().slice(0, 40) : null,
  }
})
console.log(state)
console.log(state.engineValue === 'sample'
  ? 'PASS the deployed studio opens Apollo on the sound you picked'
  : 'FAIL the deployed studio does NOT open Apollo on the sound you picked')
await p.screenshot({ path: 'prod-rack.png' })
await b.close()
