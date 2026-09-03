#!/usr/bin/env node
// One vocabulary for samples and presets, mostly derived rather than written.
//
//   node --experimental-strip-types scripts/apollo-tests/sound-tags.test.mjs
//
// Brae: "We should have tags on all presets and samples that the voice control,
// Light, can refer to."
//
// Samples had tags and a filter bar; presets had nothing. The obvious move is a
// tags field on all hundred-odd presets, and it is the wrong one — a hundred
// opinions to maintain, and NOTHING for the preset somebody makes tomorrow.
//
// So the words are derived from what an item already carries: its category says
// what it IS, its shaping says what it SOUNDS like, and a tag a person wrote
// beats both. The same function answers for a sample and for a preset, because
// "Dark" meaning one thing in the filter bar and another to Light would be
// worse than having no tags at all.

import assert from 'node:assert'
import { importTs } from '../lib/ts-import.mjs'

const { PRESET_VARIANTS } = await importTs('lib/preset-variants.ts')
const { tagsOf, hasTags, ALL_TAGS, TYPE_TAGS, CHARACTER_TAGS } = await importTs('lib/sound-tags.ts')
const { presetTags, matchPresetByCharacter, characterWordsIn } = await importTs('lib/voice/preset-character.ts')

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

const library = PRESET_VARIANTS.map((v, i) => ({
  id: `builtin-${i}`, name: v.name, group: v.group, category: v.category,
  loNote: v.loNote, hiNote: v.hiNote, fx: v.sound?.fx ?? null, tags: null,
}))

// ── every preset answers to something ──────────────────────────────────────
{
  const bare = library.filter(p => presetTags(p).length === 0)
  check(`all ${library.length} built-in presets have tags, with none written by hand`,
    bare.length === 0, bare.slice(0, 5).map(p => p.name).join(', '))
  // ⚠️ And a preset made tomorrow, by somebody who tags nothing, still does —
  // which is the whole reason these are derived.
  const homemade = { id: 'x', name: 'My Thing', group: 'Synth', category: 'synth-pad', fx: null }
  check('and so does a brand-new one nobody has tagged',
    presetTags(homemade).length > 0, presetTags(homemade).join(', '))
}

// ── a sample and a preset answer to the same words ─────────────────────────
{
  const sampleTags = tagsOf({ name: 'Airy', category: 'synth-pad' })
  const presetOfSameKind = presetTags({ id: 'p', name: 'Some Pad', group: 'Synth', category: 'synth-pad', fx: null })
  check('a pad sample and a pad preset are both a Pad',
    sampleTags.includes('Pad') && presetOfSameKind.includes('Pad'),
    `${sampleTags.join(',')} | ${presetOfSameKind.join(',')}`)
  check('every derived tag is from the ONE vocabulary',
    sampleTags.every(t => ALL_TAGS.includes(t)), sampleTags.join(','))
}

// ── what a person wrote is kept, whatever anything else says ───────────────
{
  const t = tagsOf({ name: 'My 808', category: '808', tags: ['Trap', 'Vintage'] })
  check('hand-written tags survive, including words outside the vocabulary',
    t.includes('Trap') && t.includes('Vintage'), t.join(', '))
  check('and the derived ones come too', t.includes('Drums'), t.join(', '))
  // ⚠️ A person's word is not corrected by a measurement. Calling a filtered
  // preset "Bright" is a statement about their music, not a mistake.
  const insists = tagsOf({ name: 'Mine', category: 'piano-grand', tags: ['Bright'], measured: { dark: 0.9 } })
  check('a person may call a dark sound bright, and it stays',
    insists.includes('Bright'), insists.join(', '))
}

// ── a measurement beats its category's assumption ──────────────────────────
//
// ⚠️ "Dark Upright" is built on the grand piano samples, whose category implies
// Bright — so it came out tagged Bright AND Dark, and "a bright piano" would
// have found the darkest preset in the library. The category describes the
// FOLDER; the shaping describes THIS preset.
{
  const dark = library.find(p => p.name === 'Dark Upright')
  const tags = presetTags(dark)
  check('the darkest piano is not also tagged Bright',
    tags.includes('Dark') && !tags.includes('Bright'), tags.join(', '))

  const bright = library.find(p => p.name === 'Bright Concert')
  check('and the bright one is', presetTags(bright).includes('Bright'), presetTags(bright).join(', '))

  // ⚠️ The same collision in the type words: a preset's group is "Synth" for
  // everything from a pad to a lead, and its category knows which. Both were
  // being added, so a pad answered to Lead.
  const pad = library.find(p => p.name.includes('Pad') && p.category === 'synth-pad')
  check('a pad is not also a lead',
    presetTags(pad).includes('Pad') && !presetTags(pad).includes('Lead'), presetTags(pad).join(', '))
}

// ── and Light can ask for them ─────────────────────────────────────────────
{
  const asks = [
    ['a dark pad', ['Dark', 'Pad']],
    ['a warm bass', ['Warm', 'Bass']],
    ['a soft strings preset', ['Soft', 'Strings']],
    ['a bright keys sound', ['Bright', 'Keys']],
  ]
  const wrong = []
  for (const [text, want] of asks) {
    const words = characterWordsIn(text)
    const m = matchPresetByCharacter(library, { words })
    if (!m) { wrong.push(`"${text}" → nothing`); continue }
    if (!hasTags({ ...m.preset, measured: undefined, tags: presetTags(m.preset) }, want)) {
      wrong.push(`"${text}" → ${m.preset.name} [${presetTags(m.preset).join(',')}]`)
    }
  }
  check('asking by tag finds something with those tags', wrong.length === 0, wrong.join(' | '))

  // The filter bar's own words are words Light knows — they are the ones people
  // can already see in the app, so they are the ones they will say.
  const known = characterWordsIn('ambient crunchy glitchy hard pad arp')
  check('Light knows the filter bar vocabulary',
    known.includes('ambient') && known.includes('crunchy') && known.includes('pad'),
    known.join(','))
}

// ── the tables are still the library's own ─────────────────────────────────
{
  check('type and character words are disjoint sets',
    !TYPE_TAGS.some(t => CHARACTER_TAGS.includes(t)))
  check('and both are reachable from the library module',
    ALL_TAGS.length === TYPE_TAGS.length + CHARACTER_TAGS.length, String(ALL_TAGS.length))
}

console.log(failures ? `\n${failures} failing` : '\none vocabulary, and nobody had to write it out')
assert.equal(failures, 0)
