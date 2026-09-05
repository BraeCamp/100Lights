// The detail area's state (lib/detail-area.ts): toggles are pure, full size
// never shows an empty area, the palette labels follow the state, and every
// key the area advertises is in the one key table. The panes themselves are
// driven in .claude/detail-check.mjs.
import assert from 'node:assert/strict'
import { importTs } from '../lib/ts-import.mjs'

const { nextDetail, detailLabel, DETAIL_DEFAULT } = await importTs('lib/detail-area.ts')
const { KEYMAP, resolveKey } = await importTs('lib/keymap.ts')

let failures = 0
const check = (label, fn) => {
  try { fn(); console.log(`PASS ${label}`) }
  catch (e) { failures++; console.log(`FAIL ${label}\n   ${e.message}`) }
}

check('both panes show by default, not stretched', () => {
  assert.deepEqual(DETAIL_DEFAULT, { clip: true, device: true, full: false })
})
check('a toggle flips one pane and leaves the other', () => {
  const s = nextDetail(DETAIL_DEFAULT, 'clip')
  assert.deepEqual(s, { clip: false, device: true, full: false })
  assert.deepEqual(nextDetail(s, 'clip'), DETAIL_DEFAULT)
  assert.deepEqual(nextDetail(DETAIL_DEFAULT, 'device', false), { clip: true, device: false, full: false })
})
check('full size with nothing showing opens the device pane', () => {
  const none = { clip: false, device: false, full: false }
  assert.deepEqual(nextDetail(none, 'full'), { clip: false, device: true, full: true })
  assert.deepEqual(nextDetail({ clip: true, device: false, full: false }, 'full'), { clip: true, device: false, full: true })
})
check('the palette label says what the toggle will do', () => {
  assert.equal(detailLabel(DETAIL_DEFAULT, 'clip'), 'Hide the clip pane')
  assert.equal(detailLabel({ ...DETAIL_DEFAULT, clip: false }, 'clip'), 'Show the clip pane')
  assert.equal(detailLabel(DETAIL_DEFAULT, 'full'), 'Detail area full size')
  assert.equal(detailLabel({ ...DETAIL_DEFAULT, full: true }, 'full'), 'Detail area back to normal size')
})
check('the detail keys are in the table and distinct from Tab', () => {
  for (const id of ['detail.flip', 'detail.clip', 'detail.device', 'detail.full']) assert.ok(KEYMAP.some(b => b.id === id), id)
  assert.equal(resolveKey({ key: 'Tab', shiftKey: true }, ['global']).id, 'detail.flip')
  assert.equal(resolveKey({ key: 'Tab' }, ['global']).id, 'view.session')
  assert.equal(resolveKey({ key: '3', code: 'Digit3', metaKey: true, altKey: true }, ['global']).id, 'detail.clip')
  assert.equal(resolveKey({ key: '™', code: 'Digit4', metaKey: true, altKey: true }, ['global']).id, 'detail.device', '⌥4 on a Mac types ™; the code still says 4')
  assert.equal(resolveKey({ key: '´', code: 'KeyE', metaKey: true, altKey: true }, ['global']).id, 'detail.full')
})

console.log(failures ? `\n${failures} failing` : '\nthe detail area holds')
process.exit(failures ? 1 : 0)
