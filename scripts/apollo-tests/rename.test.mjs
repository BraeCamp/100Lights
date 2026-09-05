// Renaming a run of tracks (lib/rename.ts): the auto-number and where Tab goes.
//
//   node scripts/apollo-tests/rename.test.mjs

import assert from 'node:assert/strict'
import { importTs } from '../lib/ts-import.mjs'

const { autoNumber, isNumbered, nextToRename, previewRun } = await importTs('lib/rename.ts')

let passed = 0
const ok = (name, fn) => { fn(); passed++; console.log(`PASS ${name}`) }

console.log('\nthe auto-number')

ok('a hash becomes the position in the run', () => {
  assert.equal(autoNumber('Gtr #', 1), 'Gtr 1')
  assert.equal(autoNumber('Gtr #', 4), 'Gtr 4')
  assert.equal(autoNumber('# Vox', 2), '2 Vox')
})

ok('several hashes pad, for a set that gets sorted as text', () => {
  assert.equal(autoNumber('Gtr ##', 2), 'Gtr 02')
  assert.equal(autoNumber('Gtr ###', 7), 'Gtr 007')
  assert.equal(autoNumber('Gtr ##', 123), 'Gtr 123', 'padding never truncates')
})

ok('a name with no hash is left exactly alone', () => {
  // ⚠️ Noticing a trailing number and incrementing it reads well until somebody
  // renames a track "Take 2" and finds the next one called "Take 3".
  assert.equal(autoNumber('Take 2', 1), 'Take 2')
  assert.equal(autoNumber('Take 2', 5), 'Take 2')
  assert.equal(autoNumber('Bass', 3), 'Bass')
})

ok('every hash in a name is numbered, not just the first', () => {
  assert.equal(autoNumber('# of #', 3), '3 of 3')
})

ok('and the studio can tell whether a name numbers itself', () => {
  assert.equal(isNumbered('Gtr #'), true)
  assert.equal(isNumbered('Gtr'), false)
})

console.log('\nwhere Tab goes')

const ids = ['a', 'b', 'c']

ok('to the next track in the list', () => {
  assert.equal(nextToRename(ids, 'a'), 'b')
  assert.equal(nextToRename(ids, 'b'), 'c')
})

ok('and it STOPS at the end rather than wrapping', () => {
  // ⚠️ A run that wrapped would quietly overwrite the names just typed.
  assert.equal(nextToRename(ids, 'c'), null)
})

ok('a track that is not in the list goes nowhere', () => {
  assert.equal(nextToRename(ids, 'zzz'), null)
  assert.equal(nextToRename([], 'a'), null)
})

console.log('\nsaid before you commit to it')

ok('the preview shows what the run will produce', () => {
  assert.equal(previewRun('Gtr #', 4), 'Gtr 1, Gtr 2, … Gtr 4')
  assert.equal(previewRun('Gtr #', 2), 'Gtr 1, Gtr 2')
  assert.equal(previewRun('Gtr', 4), 'Gtr', 'nothing to preview without a hash')
  assert.equal(previewRun('Gtr #', 1), 'Gtr #', 'a run of one is not a run')
})

console.log(`\n${passed} passed`)
