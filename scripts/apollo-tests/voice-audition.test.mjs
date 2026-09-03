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

const { oneNotePerInstrument, buildQueue, readBrowseCommand, recipeTags, matchesWant, presetFromLibrary } =
  await importTs('lib/voice/audition.ts')
const { planVoiceCall } = await importTs('lib/voice/execute-music.ts')

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

// ── recipes browse by the same tags ────────────────────────────────────────
//
// Brae: "Recipes and samples should be navigated through tags. We can add more
// tags to them."
{
  // ⚠️ A GENRE IS A TAG whether or not anybody repeated it in the list.
  // Recipes carried a genre long before they had tags, so "play me the jazz
  // ones" has to work today rather than after a hundred rows are re-labelled.
  check('the genre counts as a tag on its own',
    recipeTags({ genre: 'Jazz' }).includes('Jazz'))
  check('and sits alongside the explicit ones',
    recipeTags({ genre: 'Jazz', tags: ['warm', 'slow'] }).sort().join(',') === 'Jazz,slow,warm')
  check('with no duplicate when they agree',
    recipeTags({ genre: 'Jazz', tags: ['Jazz'] }).length === 1)

  const item = { name: 'ii-V-I', detail: 'the turnaround', tags: ['Jazz', 'warm'] }
  check('a recipe is found by its tag', matchesWant(item, { tag: 'jazz' }))
  check('and by words in its name or tagline', matchesWant(item, { query: 'turnaround' }))
  check('and is passed over when neither matches', !matchesWant(item, { tag: 'techno' }))
}

// ── what recipes play on ───────────────────────────────────────────────────
//
// Brae: "The recipes should play based on the chosen preset, but default will
// be grand piano. Users can choose another preset for it, including saved
// presets."
{
  const lib = [
    ...['C2', 'C4', 'C6'].map(n => note('Grand Piano', n)),
    ...['C3', 'C4'].map(n => note('Rhodes', n)),
  ]
  const piano = presetFromLibrary(lib, 'grand piano')
  check('a sampled instrument becomes something that can play notes',
    piano?.instrument.type === 'poly'
    && piano.instrument.params.oscillators?.[0].source === 'sample',
    JSON.stringify(piano?.instrument?.params?.oscillators?.[0]))
  check('named after the instrument, not the one sample', piano?.name === 'Grand Piano', piano?.name)

  // ⚠️ THE ROOT IS WHAT EVERY OTHER PITCH IS STRETCHED FROM. Picking the bottom
  // note of a piano would leave the top two octaves a resampled smear, so the
  // same nearest-middle-C rule that thins the shelf chooses it here too.
  check('and rooted on the note nearest middle C',
    piano?.instrument.params.oscillators?.[0].sampleRoot === 60,
    String(piano?.instrument?.params?.oscillators?.[0]?.sampleRoot))

  check('another preset can be chosen by name',
    presetFromLibrary(lib, 'rhodes')?.name === 'Rhodes')
  // Silence would be worse than a default: the studio says it could not find it.
  check('and one that is not there is null, not a wrong guess',
    presetFromLibrary(lib, 'harpsichord') === null)
}

// ── ⚠️ the planner must actually start a recipe browse ─────────────────────
//
// Brae: "I asked to see recipes and it said that it can't do that for me. I
// thought that we set it up so that it can show the user recipes and samples by
// tag using voice commands?"
//
// It had been set up — in the queue, the player and the preset — and NOT in
// the tool or the planner: the patch carrying those two aborted on an earlier
// file, and the feature was reported as shipped on the strength of the pieces
// that had landed. So "show me the recipes" reached a planner that still
// demanded a tag and refused. This is the check that would have caught it.
{
  const song = { id: 'p', name: 'T', tempo: 120, timeSignatureNum: 4, timeSignatureDen: 4, tracks: [], arrangementClips: [] }
  const recipes = planVoiceCall({ name: 'browse_sounds', input: { kind: 'recipes' } }, song)
  const act = recipes.actions.find(a => a.type === 'BROWSE')
  check('"the recipes", with no filter, starts a browse', !!act && !recipes.problem, recipes.problem ?? '')
  check('in recipe mode', act?.kind === 'recipes', act?.kind)

  const jazz = planVoiceCall({ name: 'browse_sounds', input: { kind: 'recipes', query: 'jazz', preset: 'rhodes' } }, song)
  const jact = jazz.actions.find(a => a.type === 'BROWSE')
  check('a filter and a preset are passed through', jact?.query === 'jazz' && jact?.preset === 'rhodes', JSON.stringify(jact))

  // Sounds are hours long; an unfiltered sound browse is still a question.
  const bare = planVoiceCall({ name: 'browse_sounds', input: {} }, song)
  check('an unfiltered SOUND browse still asks what to play', !!bare.problem && !bare.actions.length, bare.problem ?? 'no problem')
}

console.log(failures ? `\n${failures} failing` : '\none note each, and the short words are free')
assert.equal(failures, 0)
