// Can a person FIND each thing this studio can do?
//
//   npm run check:discoverable
//
// A capability nobody can find is indistinguishable from one that doesn't
// exist. That is not a figure of speech here — I audited this DAW by grepping
// for identifier names I had invented, reported seven missing features, and was
// wrong about six. Splitting a clip is called "Splice at Playhead". Reverse is a
// checkbox in the Inspector. Freeze had worked for months and surfaced only
// because Brae asked for it by name. Every one of those was implemented, tested,
// and unfindable, and no check in this repo could tell.
//
// So the list below is the DAW's expected vocabulary — what a person arriving
// from Ableton, Logic or FL reasonably expects to be able to type — and the
// check asserts each entry is reachable from the command palette. It fails in
// two directions, which is the point:
//
//   MISSING     the capability isn't built. Build it.
//   UNFINDABLE  it's built but ⌘K can't reach it. Register it.
//
// Add a row here BEFORE building a feature, not after.

import { readFileSync, readdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// Every capability, and the phrasings a person would actually type looking for
// it. Each string is one ALTERNATIVE phrasing whose words must all appear:
// 'quantise' and 'quantize' are the same request spelled two ways, while
// 'fade out' is two words that have to travel together.
//
// `optional: true` marks something deliberately not built — it reports but does
// not fail, so the list stays honest about scope instead of being quietly
// trimmed down to whatever currently passes.
const EXPECTED = [
  // Transport
  ['play/stop',            ['play', 'stop']],
  ['go to start',          ['start', 'beginning']],
  ['go to end',            ['end']],
  ['record',               ['record']],
  ['count-in',             ['count']],
  ['loop toggle',          ['loop', 'cycle']],
  ['loop a region',        ['loop clip', 'loop the whole', 'loop over']],
  ['metronome',            ['metronome', 'click']],

  // Editing
  ['undo',                 ['undo']],
  ['redo',                 ['redo']],
  ['select all',           ['select every', 'select all']],
  ['deselect',             ['deselect']],
  ['delete clip',          ['delete clip', 'delete ']],
  ['duplicate clip',       ['duplicate clip', 'duplicate ']],
  ['deactivate clip',      ['deactivate', 'activate']],
  ['lfo modulation',       ['lfo', 'wobble']],
  ['clip pane',            ['clip pane']],
  ['device pane',          ['device pane']],
  ['detail area full size', ['full size']],
  ['delay compensation',   ['latency', 'compensation']],
  ['clip editor place',    ['clip editor']],
  ['mixer in arrangement', ['mixer under']],
  ['follow playhead',      ['follow']],
  ['info view',            ['info view']],
  ['ui scale',             ['ui scale', 'bigger interface']],
  ['second window',        ['own window']],
  ['draw mode',            ['draw mode', 'pencil']],
  ['note chance',          ['chance']],
  ['fold piano roll',      ['fold']],
  ['highlight scale',      ['highlight']],
  ['step entry',           ['step entry']],
  ['pitch & time',         ['pitch & time']],
  ['invert notes',         ['invert']],
  ['reverse notes',        ['backwards']],
  ['add interval',         ['add interval']],
  ['stretch notes',        ['stretch']],
  ['set note length',      ['set length']],
  ['scale degrees',        ['scale degree']],
  ['split notes',          ['split']],
  ['chop notes',           ['chop']],
  ['join notes',           ['join']],
  ['fit notes to range',   ['fit to']],
  ['deactivate notes',     ['deactivate']],
  ['find & select notes',  ['find']],
  ['quantize settings',    ['quantize settings', 'quantise settings']],
  ['loop the clip',        ['loop the clip', 'clip loop']],
  ['duplicate loop',       ['duplicate loop', 'duplicate the loop']],
  ['set loop end',         ['loop end']],
  ['crop clip',            ['crop']],
  ['select notes in loop', ['in the loop', 'inside the loop']],
  ['insert time',          ['insert time']],
  ['delete time',          ['delete time']],
  ['duplicate time',       ['duplicate time']],
  ['clip time signature',  ['clip time signature', 'clip signature']],
  ['time selection',       ['time selection']],
  ['insert marker',        ['insert marker']],
  ['warp the clip',        ['warp']],
  ['warp mode',            ['warp mode', 're-pitch']],
  ['seg bpm',              ['seg bpm', 'sample tempo']],
  ['clip pitch',           ['clip pitch', 'pitch the clip']],
  ['clip fade',            ['clip fade', 'edge fade']],
  ['save default clip',    ['default clip']],
  ['sample details',       ['sample details']],
  ['warp markers',         ['warp marker']],
  ['set 1.1.1 here',       ['1.1.1']],
  ['warp as loop',         ['warp as']],
  ['quantize transients',  ['transients']],
  ['beats warp mode',      ['beats']],
  ['tones warp mode',      ['tones']],
  ['texture warp mode',    ['texture']],
  ['clip as tempo leader', ['leader']],
  ['short samples land as one-shot', ['one-shot']],
  ['auto-warp long samples', ['auto-warp']],
  ['insert silence across the song', ['insert silence']],
  ['delete time across the song', ['delete time']],
  ['duplicate time across the song', ['duplicate time']],
  ['record quantization sixteenths', ['record quantization: 1/16']],
  ['record quantization off', ['record quantization: none']],
  ['punch in at the loop brace', ['punch in']],
  ['punch out at the end of the brace', ['punch out']],
  ['crossfader curve hard cut', ['hard cut']],
  ['crossfader curve slow fade', ['slow fade']],
  ['follow action next',    ['follow action: play the next']],
  ['follow action any other', ['any other clip']],
  ['launch mode gate',      ['gate']],
  ['launch mode repeat',    ['repeat']],
  ['legato launch',         ['legato']],
  ['slip the audio under the clip', ['slip']],
  ['crop the sample to what the clip plays', ['crop the sample']],
  ['slice clip to a new midi track', ['slice']],
  ['convert harmony to midi', ['harmony']],
  ['convert melody to midi', ['melody']],
  ['convert drums to midi', ['convert drums']],
  ['triplet grid',         ['triplet']],
  ['overview strip',       ['overview']],
  ['waveform db scale',    ['waveforms']],
  ['split / splice clip',  ['splice', 'split']],
  ['rename clip',          ['rename clip', 'rename ']],

  // Clip shaping
  ['reverse audio',        ['reverse']],
  ['fade in',              ['fade in']],
  ['fade out',             ['fade out']],
  ['clip gain',            ['gain']],
  ['consolidate / flatten',['consolidate', 'flatten']],
  ['normalise',            ['normalise', 'normalize']],

  // Notes
  ['quantise',             ['quantise', 'quantize']],
  ['humanise',             ['humanise', 'humanize']],
  ['legato',               ['legato']],
  ['transpose',            ['transpose']],
  ['velocity',             ['velocity']],
  ['note length',          ['length', 'duration']],
  ['fit to key',           ['into key', 'fit to scale']],

  // Tracks
  ['add track',            ['add track', 'new track']],
  ['duplicate track',      ['duplicate track', 'clone track']],
  ['delete track',         ['delete track', 'remove track']],
  ['rename track',         ['rename track']],
  ['mute track',           ['mute']],
  ['solo track',           ['solo']],
  ['arm track',            ['arm']],
  ['clear all solos',      ['clear all solos', 'unsolo']],

  // Project
  ['tempo',                ['tempo', 'bpm']],
  ['time signature',       ['time signature', 'meter']],
  ['swing / groove',       ['swing', 'groove']],
  ['key and scale',        ['key', 'scale']],
  ['markers',              ['marker', 'cue']],
  ['sections',             ['section']],
  ['rename project',       ['rename this project', 'rename project']],

  // Sound
  ['freeze to audio',      ['freeze', 'bake']],
  ['unfreeze',             ['unfreeze', 'thaw']],
  ['edit the synth',       ['apollo', 'synth']],
  ['sound library',        ['library']],

  // Views
  ['arrangement view',     ['arrangement']],
  ['session view',         ['session']],
  ['mixer view',           ['mixer']],
  ['piano roll',           ['piano roll']],

  // Mixing and routing
  ['add an effect',        ['add effect', 'add device', 'add an effect']],
  ['automation',           ['automation']],
  ['return / send track',  ['return track', 'send track']],
  ['master volume',        ['master volume', 'master level']],

  // Session view
  ['add a scene',          ['scene']],
  ['stop all clips',       ['stop all']],

  // Getting things in and out
  ['import audio',         ['import']],
  ['export / bounce',      ['export', 'bounce']],
  ['save',                 ['save']],
  ['screen recording',     ['screen']],
]

// Pull every registered command out of the source. Registration is spread
// across the components that own the actions — deliberately, so a command and
// its implementation stay in one place — so scan them all.
function sourceFiles() {
  const out = []
  for (const dir of [join(ROOT, 'components/editor'), join(ROOT, 'components/editor/daw')]) {
    for (const f of readdirSync(dir)) if (f.endsWith('.tsx')) out.push(join(dir, f))
  }
  return out
}

const commands = []
for (const f of sourceFiles()) {
  const src = readFileSync(f, 'utf8')
  if (!src.includes('useRegisterCommands')) continue
  // Each command is an object literal starting with an id. Take the window of
  // source that follows it and read the label and keywords out of that — the
  // fields sit within a few lines of the id, and a window is far more robust
  // than trying to match a balanced object literal that may contain template
  // strings, ternaries and arrow functions.
  for (const m of src.matchAll(/\bid:\s*[`'"]([\w.${}\][]+)[`'"]/g)) {
    const window = src.slice(m.index, m.index + 500)
    // Labels are often a ternary — `recording ? 'Stop recording' : 'Record a
    // take'` — so take every quoted run on the label line, not just the first.
    const labelLine = window.match(/label:.*/)?.[0] ?? ''
    const label = [...labelLine.matchAll(/[`'"]([^`'"]{2,})[`'"]/g)].map(x => x[1]).join(' ')
    const kw = window.match(/keywords:\s*[`'"]([^`'"]*)/)?.[1] ?? ''
    if (!label && !kw) continue
    commands.push({ id: m[1], text: `${label} ${kw}`.toLowerCase() })
  }
}

const missing = []
const found = []
for (const [name, terms, opts = {}] of EXPECTED) {
  // Each entry lists ALTERNATIVE phrasings; a capability is reachable when one
  // command matches any single phrasing in full. Both halves matter: "quantise"
  // and "quantize" are the same request spelled two ways, while "fade out" is
  // two words that must appear together — "fade" alone would be satisfied by
  // the fade-IN command.
  const hit = commands.find(c => terms.some(phrase => phrase.split(' ').every(w => c.text.includes(w))))
  if (hit) found.push([name, hit.id])
  else missing.push([name, opts.optional])
}

console.log(`DISCOVERABILITY\n`)
console.log(`${commands.length} commands registered across the studio`)
console.log(`${found.length}/${EXPECTED.length} expected capabilities reachable from ⌘K\n`)

const hard = missing.filter(([, optional]) => !optional)
const soft = missing.filter(([, optional]) => optional)

if (soft.length) {
  console.log('NOT BUILT (known, not failing):')
  for (const [name] of soft) console.log(`  ~ ${name}`)
  console.log('')
}

if (hard.length) {
  console.log('UNREACHABLE — built but unfindable, or not built at all:')
  for (const [name] of hard) console.log(`  ✗ ${name}`)
  console.log(`\nEach of these is a thing a person will look for and fail to find.`)
  process.exitCode = 1
} else {
  console.log('Every expected capability has a name you can type. ✓')
}
