#!/usr/bin/env node
// The fidelity ladder: which layers a song gets, and what each one sounds like.
//
//   node --experimental-strip-types scripts/apollo-tests/render-layers.test.mjs
//
// Two things here are load-bearing and silent when wrong. A layer that removes
// nothing renders the same audio twice and doubles the work for no gain. And
// the TOP layer must be the caller's own patch — if the ladder alters it even
// slightly, every song in the app quietly renders at less than its real sound
// and nobody sees an error, only a mix that is a bit wrong.

import assert from 'node:assert'
import { importTs } from '../lib/ts-import.mjs'

const { layersFor, patchForLayer, layerLabel } = await importTs('lib/apollo/render-layers.ts')
const { initPatch } = await importTs('lib/apollo/patch.ts')

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

const fx = t => ({ id: `fx-${t}`, type: t, enabled: true, mix: 0.3, params: {} })

const plain = initPatch()
const withFilter = (() => { const p = initPatch(); p.filters[0] = { ...p.filters[0], enabled: true }; return p })()
const withFx = (() => { const p = initPatch(); p.fxMain = [fx('reverb')]; return p })()
const withSends = (() => { const p = initPatch(); p.fxBus1 = [fx('delay')]; return p })()
const everything = (() => {
  const p = initPatch()
  p.filters[0] = { ...p.filters[0], enabled: true }
  p.fxMain = [fx('reverb'), fx('eq')]
  p.fxBus1 = [fx('delay')]
  return p
})()

// ── Which layers a song earns ───────────────────────────────────────────────
// A song with nothing to strip must render ONCE. Anything else is the same
// audio computed twice.
const plainLayers = layersFor([plain])
check('a song with no filters or FX gets a single layer', plainLayers.length === 1, `${plainLayers.length}`)
check('and that layer is the full patch', plainLayers[0].full === true)

// The DEFAULT is two rungs, and that is a deliberate reversal. Every rung
// re-renders the whole song, so four rungs is four times the work for the same
// final audio — the biggest redundancy in the loader, and mine. "With filters
// but no effects" is also not a state anyone asked to hear; what was asked for
// is hearing the song at all, then hearing it properly.
check('a filtered song gets dry then the real thing',
  layersFor([withFilter]).map(l => l.id).join(' → ') === 'dry → sends',
  layersFor([withFilter]).map(l => l.id).join(' → '))

check('an FX song too',
  layersFor([withFx]).map(l => l.id).join(' → ') === 'dry → sends',
  layersFor([withFx]).map(l => l.id).join(' → '))

check('and a song with everything is still only two passes',
  layersFor([everything]).length === 2,
  layersFor([everything]).map(l => l.id).join(' → '))

// The full climb is still available for watching the effects arrive one by one.
const all = layersFor([everything], { detailed: true })
check('detailed mode climbs the whole ladder',
  all.map(l => l.id).join(' → ') === 'dry → filters → effects → sends',
  all.map(l => l.id).join(' → '))
check('exactly one layer is the full patch', all.filter(l => l.full).length === 1)
check('and it is the LAST one', all.at(-1).full === true)

// A project is many patches: one track with reverb earns the whole project a
// dry layer, because the layers are rendered across the song together.
const mixed = layersFor([plain, withFx])
check('one effected track gives the project a dry layer', mixed.length > 1,
  mixed.map(l => l.id).join(' → '))

// ── What each layer sounds like ─────────────────────────────────────────────
const [dry, filters, effects, sends] = all

const dryPatch = patchForLayer(everything, dry)
check('dry has no filters enabled', (dryPatch.filters ?? []).every(f => !f.enabled))
check('dry has no main FX', (dryPatch.fxMain ?? []).length === 0)
check('dry has no sends', (dryPatch.fxBus1 ?? []).length === 0 && (dryPatch.fxBus2 ?? []).length === 0)
// The filter ARRAY must keep its shape — routing indexes into it.
check('dry keeps the filter slots, just switched off',
  (dryPatch.filters ?? []).length === (everything.filters ?? []).length)

const filtersPatch = patchForLayer(everything, filters)
check('the filters layer turns filters back on',
  (filtersPatch.filters ?? []).some(f => f.enabled))
check('but still has no FX', (filtersPatch.fxMain ?? []).length === 0)

const effectsPatch = patchForLayer(everything, effects)
check('the effects layer has the main FX', (effectsPatch.fxMain ?? []).length === 2)
check('but not the sends yet', (effectsPatch.fxBus1 ?? []).length === 0)

// THE important one: the top of the ladder is the real patch, untouched.
const finalPatch = patchForLayer(everything, sends)
check('the final layer is the caller\'s own patch object', finalPatch === everything)
check('so its FX and sends are exactly as authored',
  finalPatch.fxMain.length === 2 && finalPatch.fxBus1.length === 1)

// And the ladder must never mutate what it was handed.
check('reducing a patch does not mutate the original',
  everything.fxMain.length === 2 && everything.filters[0].enabled === true)

// ── What the bar says ───────────────────────────────────────────────────────
check('the label counts the layers', layerLabel(all, 0) === 'The song, no effects (1 of 4)',
  layerLabel(all, 0))
check('and counts two when there are two',
  layerLabel(layersFor([everything]), 0) === 'The song, no effects (1 of 2)',
  layerLabel(layersFor([everything]), 0))
check('a single-layer song gets no count', layerLabel(plainLayers, 0) === 'Loading the song',
  layerLabel(plainLayers, 0))
check('an out-of-range index still says something', typeof layerLabel(all, 99) === 'string')

console.log(failures ? `\n${failures} failing` : '\nthe ladder strips what it should and ends at the real patch')
assert.equal(failures, 0)
