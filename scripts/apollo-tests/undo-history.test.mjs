// Undo History (lib/undo-history.ts): the stack as a readable list, one row per
// REQUEST rather than per action.
//
//   node scripts/apollo-tests/undo-history.test.mjs

import assert from 'node:assert/strict'
import { importTs } from '../lib/ts-import.mjs'

const { historyRows, undosToReach, redosToReach, countLabel } = await importTs('lib/undo-history.ts')

let passed = 0
const ok = (name, fn) => { fn(); passed++; console.log(`PASS ${name}`) }

const describe = a => `did ${a.type}`

// Oldest first, the way a stack grows: a lone edit, then a three-action request,
// then another lone edit.
const stack = () => [
  { before: {}, action: { type: 'ADD_TRACK' } },
  { before: {}, action: { type: 'ADD_EFFECT' }, group: 'g1', label: 'make the pad fuzzier' },
  { before: {}, action: { type: 'ADD_AUTOMATION' }, group: 'g1', label: 'make the pad fuzzier' },
  { before: {}, action: { type: 'UPDATE_CLIP' }, group: 'g1', label: 'make the pad fuzzier' },
  { before: {}, action: { type: 'MOVE_CLIP' } },
]

console.log('\none row per request')

ok('a grouped request is ONE row, not three', () => {
  // ⚠️ Listing all three would be a worse version of pressing undo three times.
  const rows = historyRows(stack(), describe)
  assert.equal(rows.length, 3)
  assert.deepEqual(rows.map(r => r.count), [1, 3, 1])
})

ok('newest first — the order a panel reads in', () => {
  const rows = historyRows(stack(), describe)
  assert.equal(rows[0].label, 'did MOVE_CLIP')
  assert.equal(rows[1].label, 'make the pad fuzzier')
  assert.equal(rows[2].label, 'did ADD_TRACK')
})

ok('the group label wins over the action', () => {
  // What somebody ASKED for beats what the last action of it happened to do.
  const rows = historyRows(stack(), describe)
  assert.equal(rows[1].label, 'make the pad fuzzier')
})

ok('an ungrouped entry falls back to the description', () => {
  const rows = historyRows(stack(), describe)
  assert.equal(rows[0].label, 'did MOVE_CLIP')
})

ok('each row knows how many are above it', () => {
  assert.deepEqual(historyRows(stack(), describe).map(r => r.groupsAbove), [0, 1, 2])
})

ok('an empty stack is an empty list, not a crash', () => {
  assert.deepEqual(historyRows([], describe), [])
})

ok('two different groups do not merge', () => {
  const s = [
    { before: {}, action: { type: 'A' }, group: 'g1', label: 'first' },
    { before: {}, action: { type: 'B' }, group: 'g2', label: 'second' },
  ]
  const rows = historyRows(s, describe)
  assert.equal(rows.length, 2)
  assert.deepEqual(rows.map(r => r.count), [1, 1])
})

ok('a row keys off its group so it is stable across re-reads', () => {
  const rows = historyRows(stack(), describe)
  assert.equal(rows[1].key, 'g1')
  assert.equal(new Set(rows.map(r => r.key)).size, 3)
})

console.log('\ngetting back there')

ok('clicking the newest row is one undo', () => {
  // ⚠️ Undo takes one GROUP at a time, so these count rows and not entries —
  // getting that wrong is how a panel undoes half of somebody\'s chord.
  assert.equal(undosToReach(0), 1)
  assert.equal(undosToReach(2), 3)
})

ok('redo counts the rows above the one you want back', () => {
  assert.equal(redosToReach(0, 3), 1)
  assert.equal(redosToReach(2, 3), 3)
  assert.equal(redosToReach(9, 3), 3, 'never more redos than there are')
})

ok('a count is only worth showing when it is more than one', () => {
  assert.equal(countLabel(1), '')
  assert.equal(countLabel(3), '3 edits')
})

console.log(`\n${passed} passed`)
