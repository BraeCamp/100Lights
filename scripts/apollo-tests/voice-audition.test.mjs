#!/usr/bin/env node
// Playing your way through a shelf of sounds.
//
//   node --experimental-strip-types scripts/apollo-tests/voice-audition.test.mjs
//
// Brae: "have the program play existing recipes and samples under a tag... We
// will need to change the sample library so that it only plays one note from
// each instrument so that the user doesn't just hear a bunch of notes of the
// same instrument."
//
// ⚠️ THE COLLAPSE RULE IS THE WHOLE FEATURE. A multisample instrument is one
// folder holding every note of it; browsing that plainly is forty seconds of
// the same cello and the shelf never gets past C. But a DRUM folder is not one
// instrument — it holds a kick, a snare, eleven hats — and collapsing it would
// hide almost everything in the library. Getting either half wrong makes
// browsing useless in opposite directions.

import assert from 'node:assert'
import { importTs } from '../lib/ts-import.mjs'

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

const { oneNotePerInstrument, buildQueue, readBrowseCommand } =
  await importTs('lib/voice/audition.ts')

const note = (folder, n, extra = {}) => ({
  id: `${folder}-${n}`, name: `${folder} ${n}`, folder,
  category: 'instrument', duration: 1, addedAt: '', tags: [`note:${n}`], ...extra,
})
const hit = (folder, name, tags = []) => ({
  id: `${folder}-${name}`, name, folder,
  category: 'drums', duration: 1, addedAt: '', tags,
})

// ── an instrument collapses to one note ────────────────────────────────────
{
  const cello = ['C2', 'G2', 'C3', 'A3', 'C4', 'E4', 'C5', 'C6'].map(n => note('Cello', n))
  const kept = oneNotePerInstrument(cello)
  check('a folder of notes becomes one sound', kept.length === 1, `${kept.length} kept`)
  // ⚠️ The MIDDLE one, not the first. The bottom of a piano tells you almost
  // nothing about the piano, and alphabetical order would hand you A3 or C2.
  check('and it is the note nearest middle C', kept[0].name === 'Cello C4', kept[0]?.name)
}

// ── a drum folder does not ─────────────────────────────────────────────────
{
  const kit = [hit('Kit 7', 'Kick'), hit('Kit 7', 'Snare'), hit('Kit 7', 'Hat 1'),
    hit('Kit 7', 'Hat 2'), hit('Kit 7', 'Ride')]
  const kept = oneNotePerInstrument(kit)
  check('a folder of different sounds is kept whole', kept.length === 5, `${kept.length} kept`)
}

// ── and a mixed library does both at once ──────────────────────────────────
{
  const all = [
    ...['C2', 'C4', 'C6'].map(n => note('Cello', n)),
    ...['C2', 'C4', 'C6'].map(n => note('Flute', n)),
    hit('Kit 7', 'Kick'), hit('Kit 7', 'Snare'),
    { id: 'lone', name: 'Vinyl crackle', category: 'fx', duration: 1, addedAt: '', tags: ['vinyl'] },
  ]
  const kept = oneNotePerInstrument(all)
  const names = kept.map(k => k.name).sort()
  check('two instruments collapse, the kit and the loose one do not',
    kept.length === 5, names.join(', '))
  check('one note each from the instruments',
    names.includes('Cello C4') && names.includes('Flute C4'), names.join(', '))
  check('and nothing from a folderless sound is lost', names.includes('Vinyl crackle'))
}

// ── filtering ──────────────────────────────────────────────────────────────
{
  const all = [
    ...['C2', 'C4'].map(n => note('Cello', n, { tags: [`note:${n}`, 'Dark'] })),
    hit('Kit 7', 'Kick', ['Hard']),
    hit('Kit 7', 'Snare', ['Dark']),
  ]
  const dark = buildQueue(all, { tag: 'dark' })
  check('a tag narrows the shelf', dark.length === 2, dark.map(d => d.name).join(', '))
  check('and the instrument in it is still one note',
    dark.filter(d => d.name.startsWith('Cello')).length === 1)

  check('a category narrows it too', buildQueue(all, { category: 'drums' }).length === 2)
  check('a query matches the folder as well as the name',
    buildQueue(all, { query: 'kit' }).length === 2)
  check('and nothing matching means nothing', buildQueue(all, { tag: 'nope' }).length === 0)
}

// ── the words said while browsing ──────────────────────────────────────────
//
// ⚠️ These live outside the command registry because they already mean
// transport and tempo. Read here, they are only consulted while a browse is
// open — but they must still be read RIGHT, because "stop browsing" and "stop"
// are one word apart and mean different things.
{
  const same = (words, action) =>
    check(`"${words[0]}" and its kin mean ${action}`,
      words.every(x => readBrowseCommand(x) === action),
      words.map(x => `${x}=${readBrowseCommand(x)}`).join(' '))

  same(['next', 'next one', 'skip', 'move on'], 'next')
  same(['back', 'go back', 'previous', 'last one'], 'back')
  same(['again', 'repeat the last', 'once more'], 'again')
  same(['restart', 'start over', 'from the top'], 'restart')
  same(['pause', 'wait', 'hold on'], 'pause')
  same(['faster', 'speed up'], 'faster')
  same(['slower', 'slow down'], 'slower')
  same(['this one', 'keep it', 'use that'], 'pick')

  // ⚠️ The pair that would be worst to confuse.
  check('"stop" pauses, "stop browsing" leaves',
    readBrowseCommand('stop') === 'pause' && readBrowseCommand('stop browsing') === 'stop')
  check('and "done" leaves too', readBrowseCommand('done') === 'stop')

  // ⚠️ A REAL REQUEST IS NOT A BROWSE WORD. While browsing, a sentence has to
  // fall through to the rules and the assistant — otherwise entering this mode
  // would quietly deafen the studio to everything else.
  check('a real command is not captured',
    readBrowseCommand('mute the pad') === null
    && readBrowseCommand('add four bars of drums after the chorus') === null
    && readBrowseCommand('') === null)
}

console.log(failures ? `\n${failures} failing` : '\none note each, and the short words are free')
assert.equal(failures, 0)
