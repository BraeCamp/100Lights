// Does the palette ever answer confidently and wrongly?
//
//   npm run check:palette-noise
//
// The unit test for ranking uses sixteen invented commands. The studio now
// registers ninety-six, each with a long keyword list, and that changes the
// problem: given enough text, a loose fuzzy matcher can spell almost any word
// out of almost any command. Live, "humanise" returned "Change the studio's
// colours" and "sidechain" returned "Open the clip in the piano roll" — both
// perfectly confident, both nonsense.
//
// So this runs the real ranking over the REAL registered commands and asserts
// that words we do not implement return nothing at all. An empty result teaches
// someone the word isn't the right one; a wrong result teaches them the palette
// doesn't understand them, and they stop typing.

import { readFileSync, readdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const { rankCommands } = createRequire(import.meta.url)('../.test-build/command-palette.js')

// Scrape the real commands the studio registers.
const commands = []
for (const dir of [join(ROOT, 'components/editor'), join(ROOT, 'components/editor/daw')]) {
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.tsx')) continue
    const src = readFileSync(join(dir, f), 'utf8')
    if (!src.includes('useRegisterCommands')) continue
    for (const m of src.matchAll(/\bid:\s*[`'"]([\w.${}\][]+)[`'"]/g)) {
      const w = src.slice(m.index, m.index + 500)
      const labelLine = w.match(/label:.*/)?.[0] ?? ''
      const label = [...labelLine.matchAll(/[`'"]([^`'"]{2,})[`'"]/g)].map(x => x[1]).join(' ')
        .replace(/\$\{[^}]*\}/g, '')
      const keywords = w.match(/keywords:\s*[`'"]([^`'"]*)/)?.[1] ?? ''
      const group = w.match(/group:\s*[`'"]([^`'"]*)/)?.[1] ?? ''
      if (!label && !keywords) continue
      commands.push({ id: m[1], label: label.trim(), keywords, group })
    }
  }
}

// Commands built in a loop have their identity inside a `${}` — the scraper
// above strips those, so "Add ${opt.label} to ${track}" arrives as "Add  to"
// and the effect name vanishes. Expanding the real catalogue here keeps the
// check honest about what the palette actually offers; without it, "reverb"
// appears unfindable when in truth it is one of seventeen effect commands.
const { ADD_OPTIONS } = createRequire(import.meta.url)('../.test-build/daw-effect-catalog.js')
for (const opt of ADD_OPTIONS) {
  commands.push({
    id: `audio.fx.${opt.type}`, group: 'Effects',
    label: `Add ${opt.label} to Kick`,
    keywords: `effect device fx insert add ${opt.type} ${opt.label}`,
  })
}

// Words for real audio concepts this studio does NOT have. Each must return
// nothing. If one of these ever becomes a feature, move it to the discoverable
// check — that is the whole point of keeping the two lists next to each other.
const NOT_FEATURES = [
  'sidechain', 'vocoder', 'autotune', 'timestretch', 'spectral',
  'crossfade', 'takelane', 'groupthem', 'bounceinplace', 'midilearn',
  'harmoniser', 'tuner', 'notation',
]

// Words that ARE features — these must return something, and the top result
// must mention the word. Guards the opposite failure: a matcher tightened so
// far that nothing matches at all.
const FEATURES = [
  ['normalise', 'normalis'], ['humanise', 'humanis'], ['legato', 'legato'],
  ['transpose', 'octave'], ['reverb', 'reverb'], ['freeze', 'freeze'],
  ['quantise', 'quantis'], ['tempo', 'tempo'], ['marker', 'marker'],
  ['import', 'import'], ['undo', 'undo'], ['mixer', 'mixer'],
  // Not a typo for something missing — the studio really does ship a
  // Chorus/Flanger, so typing "flanger" should find it.
  ['flanger', 'flanger'],
  // Several words typed together mean "all of these", and they will not sit
  // next to each other in the label: "rename clip" has to find "Rename the clip
  // under the playhead". Tightening the fuzzy matcher to a single word broke
  // exactly this, and it broke silently — the commands were registered, the
  // check said 62/62, and the palette returned nothing for the phrase people
  // actually type.
  ['rename clip', 'rename'], ['duplicate clip', 'duplicate'],
  ['add reverb', 'reverb'], ['fade out', 'fade out'],
  ['delete track', 'delete'], ['stop all', 'stop all'],
]

let failures = 0
console.log(`ranking ${commands.length} real commands\n`)

for (const word of NOT_FEATURES) {
  const hits = rankCommands(commands, word)
  const pass = hits.length === 0
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} "${word}" → nothing${pass ? '' : `, got "${hits[0].label}"`}`)
}

console.log('')
for (const [word, must] of FEATURES) {
  const hits = rankCommands(commands, word)
  const top = hits[0]?.label?.toLowerCase() ?? ''
  const pass = top.includes(must)
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} "${word}" → ${hits[0]?.label ?? '(nothing)'}`)
}

console.log(failures ? `\n${failures} failing` : '\nthe palette answers or stays quiet — never guesses')
process.exitCode = failures ? 1 : 0
