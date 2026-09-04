#!/usr/bin/env node
// Tags for patterns and recipes, and the filter that reads them; the library's
// recipe list out of its folders; one row per sound in the Samples tab; and a
// catalog drum that no longer says "no audio".
//
//   node --experimental-strip-types scripts/apollo-tests/library-tags.test.mjs

import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { importTs } from '../lib/ts-import.mjs'

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

const { patternTags, recipeTags, tagCounts, matchesTags, matchesQuery } = await importTs('lib/library-tags.ts')
const { DRUM_PATTERNS } = await importTs('lib/drum-presets.ts')
const { collapseNoteVariants } = await importTs('lib/sample-preset.ts')

// ── Patterns ────────────────────────────────────────────────────────────────
{
  const boom = DRUM_PATTERNS.find(p => p.id === 'boombap')
  const t = patternTags(boom)
  check('Boom Bap is hip-hop with swing', t.includes('Hip-Hop') && t.includes('Swing'), t.join(', '))
  const disco = patternTags(DRUM_PATTERNS.find(p => p.id === 'disco'))
  check('Disco uses open hats', disco.includes('Disco') && disco.includes('Open Hats'), disco.join(', '))
  const half = patternTags(DRUM_PATTERNS.find(p => p.id === 'halftime'))
  check('Half-Time is heavy and sparse-ish', half.includes('Half-Time') && half.includes('Heavy'), half.join(', '))
  const every = DRUM_PATTERNS.map(p => patternTags(p))
  check('every built-in pattern gets at least one genre or feel tag', every.every(ts => ts.length >= 3), `${every.filter(ts => ts.length < 3).length} thin`)
  const genres = new Set(every.flatMap(ts => ts))
  check('the extra patterns are recognised too', ['Amapiano', 'Dancehall', 'Drum & Bass', 'Latin', 'Jazz'].every(g => genres.has(g)), [...genres].slice(0, 20).join(', '))
  const mine = patternTags({ name: 'My groove', desc: '', bars: 2, hits: { kick: [0, 8] }, builtIn: false, tags: ['Weird'] })
  check('a written tag comes first and stays; a user pattern is Mine; two bars are two bars', mine[0] === 'Weird' && mine.includes('Mine') && mine.includes('2 bars'), mine.join(', '))
}

// ── Recipes ─────────────────────────────────────────────────────────────────
{
  const chords = { notes: [[60, 64, 67], [65, 69, 72], [67, 71, 74], [60, 64, 67]].flatMap((c, i) => c.map(p => ({ pitch: p, startBeat: i * 4, durationBeats: 4 }))), durationBeats: 16 }
  const t = recipeTags({ id: 'pop-progression', title: 'The pop progression (I–V–vi–IV)', tagline: 'C → G → Am → F: the four chords under a thousand hits.', genre: 'Pop' }, chords)
  check('a progression is Pop, Chords, four bars, mid, sustained', ['Pop', 'Chords', '4 bars', 'Mid', 'Sustained'].every(x => t.includes(x)), t.join(', '))
  const bass = { notes: [40, 43, 45, 47].map((p, i) => ({ pitch: p, startBeat: i, durationBeats: 1 })), durationBeats: 4 }
  const b = recipeTags({ id: 'walking', title: 'Walking bass line', tagline: 'Quarter notes that stroll from chord to chord.', genre: 'Jazz' }, bass)
  check('a bass line is Bass, Single Line, low', ['Jazz', 'Bass', 'Single Line', 'Low'].every(x => b.includes(x)), b.join(', '))
  const u = recipeTags({ id: 'user-1', title: 'Sad pad', tagline: 'melancholy minor pad', tags: ['Ambient'] }, null)
  check('written tags first; the mood words read; a user recipe is Mine', u[0] === 'Ambient' && u.includes('Sad') && u.includes('Minor') && u.includes('Pad') && u.includes('Mine'), u.join(', '))
}

// ── The filter ──────────────────────────────────────────────────────────────
{
  const counts = tagCounts(DRUM_PATTERNS, patternTags)
  check('counts are most common first', counts.length > 10 && counts[0].count >= counts[1].count)
  check('every active tag must match', matchesTags(['Hip-Hop', 'Swing'], ['hip-hop']) && !matchesTags(['Hip-Hop'], ['Hip-Hop', 'Swing']))
  check('the search reads names and tags', matchesQuery('Boom Bap', ['Hip-Hop'], 'hip') && !matchesQuery('Boom Bap', ['Hip-Hop'], 'house'))
}

// ── One row per sound ───────────────────────────────────────────────────────
{
  const rows = collapseNoteVariants([
    { id: 'a1', name: 'Arp A3', folder: 'Arp', renderSpec: { kind: 'melodic', midiNote: 57 } },
    { id: 'a2', name: 'Arp C4', folder: 'Arp', renderSpec: { kind: 'melodic', midiNote: 60 } },
    { id: 'a3', name: 'Arp E4', folder: 'Arp', renderSpec: { kind: 'melodic', midiNote: 64 } },
    { id: 'k1', name: 'Kick', folder: 'Drums' },
    { id: 'p1', name: 'Pluck C4', folder: 'Other' },
  ])
  check('three notes of one arp are one row, named for the sound', rows.length === 3 && rows.some(r => r.name === 'Arp' && r.notes === 3), JSON.stringify(rows.map(r => [r.name, r.notes])))
  check('the row uses the note nearest middle C', rows.find(r => r.name === 'Arp')?.entry.id === 'a2')
  check('a lone sound keeps its full name', rows.some(r => r.name === 'Pluck C4' && r.notes === 1))
}

// ── Wired in ────────────────────────────────────────────────────────────────
{
  const lib = readFileSync('components/editor/SoundLibrary.tsx', 'utf8')
  check('a catalog sound is fulfilled, not called "no audio"', /!entry\.renderSpec && !entry\.communityRef && !entry\.catalogUrl\) \{ setLoadErr\('no audio'\)/.test(lib))
  check('recipes are one flat list with a filter, not genre folders', !/openGenres/.test(lib) && /data-lib-body="recipes"[\s\S]*?<TagFilterBar/.test(lib))
  check('patterns have the same filter and show user patterns', /data-lib-body="patterns"[\s\S]*?<TagFilterBar/.test(lib) && /const allPatterns = useMemo\(\(\) => getPatterns\(\)/.test(lib))
  check('switching tabs fades the body in', /data-lib-tab-body="presets"/.test(lib) && /data-lib-tab-body="samples"/.test(lib) && /key=\{presetSub\} className="appear-fade"/.test(lib))
  const roll = readFileSync('components/editor/daw/PianoRoll.tsx', 'utf8')
  check('the Samples tab collapses note variants', /collapseNoteVariants\(all\.filter\(isPickableSample\)\)/.test(roll))
}

console.log(failures ? `\n${failures} failing` : '\ntagged, filtered, out of the folders')
assert.equal(failures, 0)
