#!/usr/bin/env node
// Reading a sample library's filenames and folder layout.
//
//   node scripts/apollo-tests/sample-fetch.test.mjs
//
// Every case here is one that actually appeared across VCSL, VSCO 2 CE and
// Karoryfer's libraries, and every one of them is silent when it goes wrong:
// a folder that merges two articulations builds an instrument that is bowed on
// some notes and plucked on others, and it looks completely normal doing it.

import assert from 'node:assert'
import { parseSampleName, isNonNote, variantSuffix, folderFor, wavSeconds } from '../lib/sample-fetch.mjs'

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}
const eq = (label, got, want) => check(label, got === want, `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`)

// ── Filenames, in every dialect these libraries speak ───────────────────────
const vcsl = parseSampleName('AltRecorder_Stac_A#3_rr1_Main.wav')
eq('VCSL note', vcsl.note, 'A#3')
eq('VCSL round robin', vcsl.rr, 'rr1')
eq('VCSL articulation', vcsl.artic, 'staccato')
eq('VCSL mic', vcsl.mic, 'main')

const vsco = parseSampleName('Strings/Cello Section/pizzT/pizzT_A2_v1_RR1.wav')
eq('VSCO note', vsco.note, 'A2')
eq('VSCO velocity layer', vsco.vel, '1')
eq('VSCO round robin (uppercase RR)', vsco.rr, 'rr1')

const karoryfer = parseSampleName('Samples/black/ord/btb_a3_rr1.wav')
eq('lowercase note is read', karoryfer.note, 'A3')

const flat = parseSampleName('Samples/acoustic/eb3_sustain_rr2.wav')
eq('flats are read', flat.note, 'EB3')

// Dynamic markings ARE velocity layers, just spelled differently. Miss this and
// the double bass plays pianissimo on one note and fortissimo on the next.
eq('mf is a velocity layer', parseSampleName('arco/arco_a2_mf_down.wav').vel, '3')
eq('pp is quieter than mf',
  Number(parseSampleName('arco/arco_a2_pp_up.wav').vel) < Number(parseSampleName('arco/arco_a2_mf_up.wav').vel), true)
// Bow direction is a second axis, not the articulation — keeping only one of
// them threw the other away on every double-bass sample.
eq('the articulation is arco', parseSampleName('arco/arco_a2_f_down.wav').artic, 'arco')
eq('and the bow direction survives alongside it', parseSampleName('arco/arco_a2_f_down.wav').bow, 'down')
eq('up-bow too', parseSampleName('arco/arco_a2_pp_up.wav').bow, 'up')

// A piano is not an A-flat.
eq('a name with no pitch yields none', parseSampleName('noises/fingering1_rr1.wav').note, '')

// ── Which sounds are not notes ──────────────────────────────────────────────
for (const p of ['Samples/black/rel/x_a3.wav', 'keys/Rel/JHPiano_NoSusRel_A#0.wav',
                 'noises/fingering1.wav', 'arco/noises/x.wav', 'Samples/acoustic/a2_release_rr1.wav']) {
  check(`not a note: ${p.split('/').slice(-2).join('/')}`, isNonNote(p) === true)
}
for (const p of ['Samples/black/ord/btb_a3_rr1.wav', 'Strings/Solo Violin/Arco Vib/x_A3.wav']) {
  check(`is a note: ${p.split('/').slice(-2).join('/')}`, isNonNote(p) === false)
}

// ── Folders: one instrument, one articulation ───────────────────────────────
eq('a bare instrument gets no suffix', folderFor('Folk Harp', ''), 'Folk Harp')
eq('an articulation is spelled out', folderFor('Black Electric Guitar', 'ord'),
  'Black Electric Guitar (Ordinary)')
eq('cryptic codes are translated', folderFor('Cello Section', 'pizzT'), 'Cello Section (Pizzicato)')
eq('and so is susNV', variantSuffix('susNV'), 'Sustain Non-Vibrato')
eq('wrapper folders are dropped', variantSuffix('Sustains/Normal'), 'Normal')
eq('releases are labelled', variantSuffix('Releases/Lute'), 'Releases Lute')
// Non-note buckets keep their own name: collapsing "noises" and "extra" both
// to "Releases" merged two different sets of sounds into one folder.
eq('a noises folder says Noises', variantSuffix('arco/noises'), 'Noises Arco')
eq('and an extra folder says Extra', variantSuffix('arco/extra'), 'Extra Arco')
check('so the two do not share a folder',
  folderFor('Double Bass', 'arco/noises') !== folderFor('Double Bass', 'arco/extra'))
eq('a repeated word is not said twice', variantSuffix('Sustains/Sus'), 'Sustain')
eq('unknown codes survive, title-cased', variantSuffix('fake_det'), 'Fake Det')
eq('organ stops are left alone', variantSuffix("4'"), "4'")

// The whole point: two articulations of one instrument must not share a folder.
const sax = ['Vibrato', 'Non-Vibrato', 'Staccato'].map(v => folderFor('Tenor Saxophone', v))
check('a saxophone\'s three articulations get three folders',
  new Set(sax).size === 3, sax.join(' | '))
const piano = ['Sus', 'NoSus'].map(v => folderFor('Grand Piano', v))
check('and sustain-pedal variants are separated too',
  new Set(piano).size === 2, piano.join(' | '))
// …while releases never land in the note folder.
check('releases never share a folder with notes',
  folderFor('Grand Piano', 'Releases/Sus') !== folderFor('Grand Piano', 'Sus'))

// ── Durations ───────────────────────────────────────────────────────────────
eq('a missing file is 0 seconds, not a crash', wavSeconds('/nonexistent/nope.wav'), 0)
eq('a non-WAV is 0 seconds', wavSeconds(new URL(import.meta.url).pathname), 0)

console.log(failures ? `\n${failures} failing` : '\nfilenames and folders read correctly')
assert.equal(failures, 0)
