// The one key table (lib/keymap.ts): a keystroke resolves to exactly one
// binding per scope, no two bindings in a scope answer to the same chord,
// the help panel lists every visible binding, and momentary latching tells a
// tap from a hold. The real-path check (.claude/keymap-check.mjs) presses the
// keys in the studio.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { importTs } from '../lib/ts-import.mjs'

const { KEYMAP, resolveKey, releasedMomentary, parseChord, keysFor, keysForCommand, shortcutGroups, keymapConflicts, MomentaryLatch, MOMENTARY_HOLD_MS } =
  await importTs('lib/keymap.ts')

let failures = 0
const check = (label, fn) => {
  try { fn(); console.log(`PASS ${label}`) }
  catch (e) { failures++; console.log(`FAIL ${label}\n   ${e.message}`) }
}
const key = (k, extra = {}) => ({ key: k, ...extra })
const letter = (ch, extra = {}) => ({ key: ch, code: `Key${ch.toUpperCase()}`, ...extra })

check('chords parse into modifiers and a key', () => {
  assert.deepEqual(parseChord('⇧⌘Z'), { meta: true, shift: true, alt: false, key: 'z' })
  assert.deepEqual(parseChord('⌘⌥B'), { meta: true, shift: false, alt: true, key: 'b' })
  assert.deepEqual(parseChord('Space'), { meta: false, shift: false, alt: false, key: ' ' })
  assert.deepEqual(parseChord('←'), { meta: false, shift: false, alt: false, key: 'ArrowLeft' })
  assert.deepEqual(parseChord('Esc'), { meta: false, shift: false, alt: false, key: 'Escape' })
  assert.deepEqual(parseChord('Ctrl+S'), { meta: true, shift: false, alt: false, key: 's' })
})

check('the studio keys resolve', () => {
  assert.equal(resolveKey(key(' ', { code: 'Space' }), ['global']).id, 'transport.play')
  assert.equal(resolveKey(letter('z', { metaKey: true }), ['global']).id, 'edit.undo')
  assert.equal(resolveKey(letter('z', { ctrlKey: true }), ['global']).id, 'edit.undo')
  assert.equal(resolveKey(letter('Z', { metaKey: true, shiftKey: true }), ['global']).id, 'edit.redo')
  assert.equal(resolveKey(key('Delete'), ['global']).id, 'edit.deleteClip')
  assert.equal(resolveKey(key('Backspace'), ['global']).id, 'edit.deleteClip')
  assert.equal(resolveKey(letter('m'), ['global']).id, 'transport.metronome')
  assert.equal(resolveKey(key('Tab'), ['global']).id, 'view.session')
  assert.equal(resolveKey(key('?', { shiftKey: true }), ['global']).id, 'help.open')
  assert.equal(resolveKey(letter('h'), ['global']).id, 'help.open')
})

check('a modifier that is not in the chord is a different key', () => {
  assert.equal(resolveKey(key(' ', { code: 'Space', metaKey: true }), ['global']), null)
  assert.equal(resolveKey(letter('m', { altKey: true }), ['global']), null)
  assert.equal(resolveKey(letter('m', { shiftKey: true }), ['global']), null)
})

check('the library moved off B — B is Draw Mode; ⌘⌥B opens the library, even when ⌥ turns the letter into ∫', () => {
  assert.equal(resolveKey(letter('b'), ['global']).id, 'view.draw')
  assert.equal(resolveKey({ key: '∫', code: 'KeyB', metaKey: true, altKey: true }, ['global']).id, 'view.library')
  assert.equal(keysFor('view.library'), '⌘⌥B')
  assert.equal(keysForCommand('audio.library'), '⌘⌥B')
})

check('scopes are searched in the order given', () => {
  assert.equal(resolveKey(key('ArrowLeft'), ['arrangement', 'global']).id, 'clip.nudgeLeft')
  assert.equal(resolveKey(key('ArrowLeft'), ['global']).id, 'transport.back')
  assert.equal(resolveKey(key('ArrowLeft', { shiftKey: true }), ['arrangement']).id, 'clip.nudgeLeftBeat')
  assert.equal(resolveKey(letter('s'), ['arrangement']).id, 'clip.split')
  assert.equal(resolveKey(letter('s', { metaKey: true }), ['arrangement']), null)
  assert.equal(resolveKey(letter('s', { metaKey: true }), ['global']).id, 'file.save')
  assert.equal(resolveKey(key('3'), ['arrangement']).id, 'snap.8th')
  assert.equal(resolveKey(letter('q'), ['roll']).id, 'notes.quantize')
  assert.equal(resolveKey(key('ArrowUp', { shiftKey: true }), ['roll']).id, 'notes.upOctave')
})

check('podcast mode has no session view to Tab into', () => {
  assert.equal(resolveKey(key('Tab'), ['global'], 'podcast'), null)
  assert.equal(resolveKey(key(' ', { code: 'Space' }), ['global'], 'podcast').id, 'transport.play')
})

check('no two bindings in one scope answer to the same chord', () => {
  assert.deepEqual(keymapConflicts(), [])
})

check('every binding has a stable id, a group and a help line; ids are unique', () => {
  const ids = new Set()
  for (const b of KEYMAP) {
    assert.ok(b.id && b.group && b.action, `incomplete: ${JSON.stringify(b)}`)
    assert.ok(!ids.has(b.id), `duplicate id ${b.id}`)
    ids.add(b.id)
  }
})

check('the help panel lists every visible binding, once, under its group', () => {
  const groups = shortcutGroups()
  const rows = groups.flatMap(g => g.items)
  const visible = KEYMAP.filter(b => !b.hidden)
  assert.equal(rows.length, visible.length)
  for (const b of visible) {
    const g = groups.find(x => x.label === b.group)
    assert.ok(g && g.items.some(r => r.id === b.id), `${b.id} missing from "${b.group}"`)
  }
  // A group is mode-limited only when everything in it is.
  assert.equal(groups.find(g => g.label === 'Transport & Global').modes, undefined)
  assert.deepEqual(groups.find(g => g.label === 'Piano Roll').modes, ['music'])
})

check('a pair shows once with its display and the second half hidden', () => {
  const rows = shortcutGroups().flatMap(g => g.items)
  assert.equal(rows.filter(r => r.keys === '← / →' && r.action.startsWith('Move playhead')).length, 1)
  assert.ok(!rows.some(r => r.id === 'transport.forward'))
})

check('momentary: a tap latches, a hold comes back', () => {
  const latch = new MomentaryLatch()
  assert.equal(latch.down('view.session', 0), true)
  assert.equal(latch.down('view.session', 30), false, 'auto-repeat is ignored')
  assert.equal(latch.up('view.session', 120), false, 'a tap does not toggle back')
  assert.equal(latch.down('view.session', 1000), true)
  assert.equal(latch.up('view.session', 1000 + MOMENTARY_HOLD_MS), true, 'held long enough: toggle back')
  assert.equal(latch.up('view.session', 2000), false, 'nothing held')
})

check('a released momentary key is found even when its modifiers already came up', () => {
  const ids = releasedMomentary({ key: 'b', code: 'KeyB' }, ['global']).map(b => b.id)
  assert.deepEqual(ids.sort(), ['view.draw', 'view.library'])   // both answer to the letter; the latch knows which was held
  assert.deepEqual(releasedMomentary({ key: 'Tab' }, ['global']).map(b => b.id), ['view.session'])
  assert.deepEqual(releasedMomentary({ key: 'Tab' }, ['global'], 'podcast'), [])
  assert.deepEqual(releasedMomentary({ key: 'm', code: 'KeyM' }, ['global']), [])
})

check('every palette command a key names exists in the editor source', () => {
  const src = readFileSync(new URL('../../components/editor/AudioEditor.tsx', import.meta.url), 'utf8')
    + readFileSync(new URL('../../components/editor/daw/ArrangementView.tsx', import.meta.url), 'utf8')
  for (const b of KEYMAP) if (b.command) assert.ok(src.includes(`id: '${b.command}'`), `${b.id} → ${b.command} not registered`)
})

check('the editor no longer hand-matches the keys the table owns', () => {
  const editor = readFileSync(new URL('../../components/editor/AudioEditor.tsx', import.meta.url), 'utf8')
  assert.ok(!/e\.code === 'KeyR'|e\.code === 'KeyM'|e\.key !== 'Tab'/.test(editor), 'a key is matched by hand in AudioEditor.tsx')
  const help = readFileSync(new URL('../../components/editor/daw/HelpButton.tsx', import.meta.url), 'utf8')
  assert.ok(help.includes('shortcutGroups()'), 'the help panel must read the table')
  assert.ok(!/keys: 'B'/.test(help), 'the help panel still advertises B')
})

console.log(failures ? `\n${failures} failing` : '\nevery key means one thing')
process.exit(failures ? 1 : 0)
