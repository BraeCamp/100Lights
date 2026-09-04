// Finding a library sound from what was said — by name, by kind, by folder.
//
// Brae: "It said 'There is no hihat sample' but it should be in the sample
// library as a whole folder."
import assert from 'node:assert'
import { importTs } from '../lib/ts-import.mjs'

const { findLibrarySound, describeLibraryKinds } = await importTs('lib/voice/library-match.ts')

let failures = 0
const check = (label, pass, extra = '') => { if (!pass) failures++; console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`) }
// The rules' own tokeniser keeps apostrophes and hyphens: "hi-hat" is one token.
const words = s => s.toLowerCase().replace(/[^a-z0-9\s'-]/g, ' ').split(/\s+/).filter(Boolean)

const LIB = [
  { id: 'seed-hat', name: 'Hi-Hat', folder: 'Drums', category: 'hihat' },
  { id: 'seed-open', name: 'Open Hat', folder: 'Drums', category: 'open-hihat' },
  { id: 'seed-kick', name: 'Kick', folder: 'Drums', category: 'kick' },
  { id: 'c1', name: 'Closed Hat 01', folder: 'hihat/closed', category: 'hihat' },
  { id: 'c2', name: 'Closed Hat 02 Tight', folder: 'hihat/closed', category: 'hihat' },
  { id: 'k1', name: 'Kick Acoustic 01', folder: 'kick', category: 'kick' },
  { id: 'k808', name: '808 Kick Deep', folder: 'kick/808', category: '808' },
  { id: 'chop', name: 'Chop 01', folder: 'Vocal Chops', category: 'voice' },
  { id: 'violin', name: 'Violin', group: 'Strings' },
]
// The rules hand over content words (no "a", no "to") and the raw sentence.
const FILLER = new Set(['a', 'an', 'the', 'to', 'please', 'on', 'of'])
const content = s => words(s).filter(w => !FILLER.has(w))
const strict = s => findLibrarySound(content(s), LIB, { strict: true, raw: s })
const loose = s => findLibrarySound(content(s), LIB)

// ── By name, squashed or spaced ─────────────────────────────────────────────
check('"hihat" finds the sound named Hi-Hat', strict('change the drums to a hihat')?.sound.id === 'seed-hat')
check('"hi hat" finds it too', strict('put a hi hat on the drums')?.sound.id === 'seed-hat')
check('"open hat" finds the open one, not the closed', strict('use an open hat on the drums')?.sound.id === 'seed-open')
check('the words that named it come back, so the track can be read from the rest',
  JSON.stringify(strict('put a hi hat on the drums')?.words) === '["hi","hat"]')
check('a plain name still works', strict('make the bass a violin')?.sound.id === 'violin')

// ── By kind, when no sound is NAMED ─────────────────────────────────────────
const noSeeds = LIB.filter(s => !s.id.startsWith('seed'))
const strictNoSeeds = s => findLibrarySound(content(s), noSeeds, { strict: true, raw: s })
check('"a hihat" with only catalog hats picks the plainest closed hat', strictNoSeeds('change the drums to a hihat')?.sound.id === 'c1')
check('"hi-hat" with a hyphen is the same word', strictNoSeeds('change the drums to a hi-hat')?.sound.id === 'c1')
check('"the 808" finds the 808 kick', strict('change the bass to the 808')?.sound.id === 'k808')
check('"a kick sample" says sample, so it is about a sound', strictNoSeeds('load a kick sample')?.by === 'kind')

// ── The guard: ordinary words are not a request for a sound ─────────────────
check('"make the kick louder" is not about a kick sample (strict)', strictNoSeeds('make the kick louder') === null)
check('…but the planner, told it IS an instrument change, resolves "kick"', findLibrarySound(['kick'], noSeeds)?.by === 'kind')
check('"the hats" as an object is about a sound', strict('change the drums to the hats')?.sound.category === 'hihat')
check('the words that named a kind are the tokens, so the track is what is left',
  JSON.stringify(strict('change the drums to a hi-hat')?.words) === '["hi-hat"]')

// ── By folder ───────────────────────────────────────────────────────────────
check('"a vocal chop" finds the Vocal Chops folder', strict('put a vocal chop on the pad')?.sound.id === 'chop')
check('and says it came from the folder', strict('put a vocal chop on the pad')?.by === 'folder')

// ── What there is, when nothing matches ─────────────────────────────────────
check('nothing for a sound that is not there', strict('change the drums to a didgeridoo') === null)
check('the kinds are described with counts', /hihat 3/.test(describeLibraryKinds(LIB)) && /kick 2/.test(describeLibraryKinds(LIB)), describeLibraryKinds(LIB))

console.log(failures ? `\n${failures} failing` : '\na hihat is a hihat')
assert.equal(failures, 0)
