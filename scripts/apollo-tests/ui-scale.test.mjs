// UI scale (lib/ui-scale.ts): 100 % writes no rules, other scales write a
// stylesheet keyed off the root attribute with floors so 50 % stays legible,
// the steps clamp, and nothing in the sheet touches a lane, a grid, a knob
// or a fader. The studio is driven in .claude/uiscale-check.mjs.
import assert from 'node:assert/strict'
import { importTs } from '../lib/ts-import.mjs'

const { uiScaleCss, stepUiScale, UI_SCALE_STEPS } = await importTs('lib/ui-scale.ts')

let failures = 0
const check = (label, fn) => {
  try { fn(); console.log(`PASS ${label}`) }
  catch (e) { failures++; console.log(`FAIL ${label}\n   ${e.message}`) }
}

check('100 % is no stylesheet at all', () => { assert.equal(uiScaleCss(100), '') })
check('150 % scales the top bar and the type, keyed off the root attribute', () => {
  const css = uiScaleCss(150)
  assert.ok(css.includes(':root[data-ui-scale="150"]'))
  assert.ok(/\.electron-drag-container\{height:69px!important/.test(css), 'top bar 46 → 69')
  assert.ok(/font-size:18px!important/.test(css), 'button type 12 → 18')
})
check('50 % floors the type so it stays readable', () => {
  const css = uiScaleCss(50)
  assert.ok(css.includes('[data-ui-scale="50"]'))
  assert.ok(!/font-size:([0-7](\.\d+)?|8(\.[0-4]\d*)?)px/.test(css), "no font under 8.5px")
  assert.ok(/height:30px!important/.test(css), 'top bar floors at 30')
})
check('the sheet never touches the interactive surfaces', () => {
  const css = uiScaleCss(150)
  for (const forbidden of ['role="slider"]{', 'piano-roll', 'roll-grid', 'ruler', 'data-clip-id', 'overview']) {
    assert.ok(!css.includes(forbidden), `must not style ${forbidden}`)
  }
  assert.ok(css.includes('button:not([role="slider"])'), 'knobs are excluded from the button rule')
})
check('steps clamp to 50–200 and snap to tens', () => {
  assert.equal(stepUiScale(100, 1), 110)
  assert.equal(stepUiScale(195, 1), 200)
  assert.equal(stepUiScale(200, 1), 200)
  assert.equal(stepUiScale(50, -1), 50)
  assert.equal(stepUiScale(123, -1), 110)
  assert.deepEqual([UI_SCALE_STEPS[0], UI_SCALE_STEPS.at(-1), UI_SCALE_STEPS.length], [50, 200, 16])
})

console.log(failures ? `\n${failures} failing` : '\nthe chrome scales, the music does not')
process.exit(failures ? 1 : 0)
