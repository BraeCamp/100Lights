// The palette is only useful if the obvious thing is the first result. These are
// the searches people actually type, with the answer they expect.
//
//   npm run test:palette

import assert from 'node:assert'
import { createRequire } from 'node:module'
const { rankCommands, scoreCommand } = createRequire(import.meta.url)('../.test-build/command-palette.js')

const cmd = (label, group, keywords) => ({ id: label, label, group, keywords, run: () => {} })
const COMMANDS = [
  cmd('Play', 'Transport', 'start begin'),
  cmd('Stop', 'Transport', 'pause halt'),
  cmd('Toggle loop', 'Transport', 'repeat cycle'),
  cmd('Open Mixer', 'Go', 'levels faders volume'),
  cmd('Open Arrangement', 'Go', 'timeline arrange'),
  cmd('Open Session', 'Go', 'clips launch grid'),
  cmd('Add track', 'Track', 'new create'),
  cmd('Add return track', 'Track', 'send bus aux'),
  cmd('Delete track', 'Track', 'remove'),
  cmd('Mute Bass', 'Track', 'silence'),
  cmd('Solo Bass', 'Track', 'isolate'),
  cmd('Open Apollo rack', 'Sound', 'synth patch edit instrument'),
  cmd('Open sound panel', 'Sound', 'fx roll effects'),
  cmd('Instrument: Wavetable', 'Instrument', 'synth osc'),
  cmd('Instrument: FM', 'Instrument', 'operator dx'),
  cmd('Instrument: Drum kit', 'Instrument', 'percussion beats'),
]

let failures = 0
const expect = (query, wantLabel) => {
  const top = rankCommands(COMMANDS, query)[0]
  const ok = top?.label === wantLabel
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'} "${query}" → ${top?.label ?? '(nothing)'}${ok ? '' : `   expected ${wantLabel}`}`)
}

// Exact and prefix.
expect('play', 'Play')
expect('stop', 'Stop')
expect('mix', 'Open Mixer')
expect('arr', 'Open Arrangement')

// Word-boundary inside a label — the word people think of is rarely first.
expect('mixer', 'Open Mixer')
expect('session', 'Open Session')
expect('apollo', 'Open Apollo rack')

// Keywords: what it does, not what it is called.
expect('faders', 'Open Mixer')
expect('percussion', 'Instrument: Drum kit')
expect('aux', 'Add return track')

// Contextual labels built from the current selection.
expect('mute bass', 'Mute Bass')
expect('solo', 'Solo Bass')

// Loose subsequence still finds it.
expect('wvtb', 'Instrument: Wavetable')

// An empty query returns everything, unfiltered and in registry order.
const all = rankCommands(COMMANDS, '')
console.log(`${all.length === COMMANDS.length ? 'PASS' : 'FAIL'} empty query returns all ${all.length}`)
if (all.length !== COMMANDS.length) failures++

// Nonsense matches nothing rather than returning a bad guess.
const none = rankCommands(COMMANDS, 'zzzqqq')
console.log(`${none.length === 0 ? 'PASS' : 'FAIL'} nonsense returns nothing (${none.length})`)
if (none.length !== 0) failures++

// A shorter label wins when both match equally — "Play" over "Playback speed".
const tie = rankCommands([cmd('Playback speed', 'X'), cmd('Play', 'X')], 'play')
console.log(`${tie[0].label === 'Play' ? 'PASS' : 'FAIL'} shorter label wins a tie (${tie[0].label})`)
if (tie[0].label !== 'Play') failures++

console.log(`${scoreCommand(cmd('Play', 'X'), '') === 0 ? 'PASS' : 'FAIL'} empty query scores neutral`)

assert.equal(failures, 0, `${failures} palette case(s) failed`)
console.log('\nall command-palette cases pass')
