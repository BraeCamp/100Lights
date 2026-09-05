// Display settings (lib/display-settings.ts): the clip editor lives in the
// pane by default, inline is the other choice, and the UI scale clamps and
// snaps. The panes themselves are driven in .claude/clip-pane-check.mjs.
import assert from 'node:assert/strict'
import { importTs } from '../lib/ts-import.mjs'

const { DISPLAY_DEFAULT, clampUiScale, UI_SCALE_MIN, UI_SCALE_MAX } = await importTs('lib/display-settings.ts')

let failures = 0
const check = (label, fn) => {
  try { fn(); console.log(`PASS ${label}`) }
  catch (e) { failures++; console.log(`FAIL ${label}\n   ${e.message}`) }
}

check('defaults: clip editor in the pane, 100%, mixer row hidden, overview on, Follow off, linear waveforms, status bar on', () => {
  assert.deepEqual(DISPLAY_DEFAULT, { clipEditor: 'pane', uiScale: 100, arrangementMixer: { open: false, section: 'mixer' }, overview: true, follow: 'off', waveformScale: 'linear', infoView: true })
})
check('the UI scale clamps to its range and snaps to tens', () => {
  assert.equal(clampUiScale(100), 100)
  assert.equal(clampUiScale(123), 120)
  assert.equal(clampUiScale(126), 130)
  assert.equal(clampUiScale(10), UI_SCALE_MIN)
  assert.equal(clampUiScale(999), UI_SCALE_MAX)
  assert.equal(clampUiScale(NaN), 100)
})

console.log(failures ? `\n${failures} failing` : '\nthe display settings hold')
process.exit(failures ? 1 : 0)
