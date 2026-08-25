// Is every note in this song the note it should be?
//
//   node scripts/check-notes.mjs <song.cfproj> [--strict]
//
// Two different jobs, and the distinction matters:
//
//   PROBLEMS are wrong regardless of taste — a note with no length, no
//   velocity, a pitch outside what the instrument can play, or two identical
//   pitches stacked at the same instant (which phase against each other and
//   sound like one detuned note). These fail the check.
//
//   OUT OF KEY is reported, never failed. A flattened second or a borrowed
//   chord is a choice, not a mistake, and a checker that cannot tell the
//   difference trains you to ignore it. What it is good for is catching the
//   accident: one note in a run that sits a semitone off everything around it.
//
// Percussion is exempt from key entirely: a kick at MIDI 24 is a trigger, not a
// C. Tracks are treated as percussion by name, which is how the songs are
// written, with a fallback for tracks that only ever play one or two pitches.

import { readFileSync } from 'fs'

const args = process.argv.slice(2)
const file = args.find(a => !a.startsWith('--'))
const strict = args.includes('--strict')
if (!file) { console.error('usage: check-notes.mjs <song.cfproj> [--strict]'); process.exit(2) }

const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  'harmonic-minor': [0, 2, 3, 5, 7, 8, 11],
  'melodic-minor': [0, 2, 3, 5, 7, 9, 11],
  'penta-maj': [0, 2, 4, 7, 9],
  'penta-min': [0, 3, 5, 7, 10],
  blues: [0, 3, 5, 6, 7, 10],
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
}
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const ROOTS = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 }
const name = p => `${NOTE_NAMES[((p % 12) + 12) % 12]}${Math.floor(p / 12) - 1}`
const PERCUSSION = /kick|snare|clap|rim|hat|perc|drum|tom|cymbal|shaker|cowbell|tick/i

const cf = JSON.parse(readFileSync(file, 'utf8'))
const dp = cf.dawProject ?? cf
const root = ROOTS[dp.key] ?? 0
const scale = SCALES[dp.scale] ?? SCALES.minor
const inKey = p => scale.includes((((p - root) % 12) + 12) % 12)

const problems = []
const outOfKey = []
let notes = 0, checked = 0

for (const track of dp.tracks ?? []) {
  const clips = (dp.arrangementClips ?? []).filter(c => c.trackId === track.id && Array.isArray(c.notes))
  const all = clips.flatMap(c => (c.notes ?? []).map(n => ({ ...n, clip: c.name, at: c.startBeat + n.startBeat, clipEnd: c.durationBeats })))
  if (!all.length) continue
  const pitches = new Set(all.map(n => n.pitch))
  const isPerc = PERCUSSION.test(track.name) || pitches.size <= 2
  notes += all.length

  // Stacked duplicates: the same pitch starting at the same moment, twice.
  const seen = new Map()
  for (const n of all) {
    const k = `${n.pitch}@${n.at.toFixed(3)}`
    if (seen.has(k)) problems.push({ track: track.name, at: n.at, what: `two ${name(n.pitch)} notes start together (they phase against each other)` })
    seen.set(k, true)
  }

  for (const n of all) {
    if (!(n.durationBeats > 0)) problems.push({ track: track.name, at: n.at, what: `${name(n.pitch)} has no length (${n.durationBeats})` })
    if (!(n.velocity > 0)) problems.push({ track: track.name, at: n.at, what: `${name(n.pitch)} has no velocity` })
    if (n.pitch < 0 || n.pitch > 127) problems.push({ track: track.name, at: n.at, what: `pitch ${n.pitch} is outside MIDI range` })
    // Humanising moves note starts by a few milliseconds, so a note filling its
    // last bar pokes past the clip edge by a hair. That is not a mistake and
    // flagging it teaches you to ignore the checker. A THIRTY-SECOND note of
    // overhang is the line: below it is jitter, above it the note was written
    // longer than the clip that holds it and will be cut.
    const over = n.startBeat + n.durationBeats - n.clipEnd
    if (over > 1 / 32)
      problems.push({ track: track.name, at: n.at, what: `${name(n.pitch)} runs ${over.toFixed(2)} beats past the end of "${n.clip}"` })
    if (isPerc) continue
    checked++
    if (!inKey(n.pitch)) outOfKey.push({ track: track.name, at: n.at, pitch: n.pitch, clip: n.clip })
  }
}

console.log(`${dp.name ?? file}  —  ${dp.key} ${dp.scale}, ${notes} notes`)
console.log(`scale tones: ${scale.map(i => NOTE_NAMES[(root + i) % 12]).join(' ')}\n`)

if (problems.length) {
  console.log(`PROBLEMS (${problems.length}):`)
  for (const p of problems.slice(0, 30)) console.log(`  ${p.track.padEnd(8)} beat ${String(p.at.toFixed(2)).padStart(7)}  ${p.what}`)
  if (problems.length > 30) console.log(`  … and ${problems.length - 30} more`)
} else {
  console.log('PROBLEMS: none — every note has length, velocity, a real pitch, and fits its clip')
}

console.log()
if (!outOfKey.length) {
  console.log(`OUT OF KEY: none of the ${checked} pitched notes sit outside ${dp.key} ${dp.scale}`)
} else {
  const byTrack = {}
  for (const o of outOfKey) (byTrack[o.track] ??= []).push(o)
  console.log(`OUT OF KEY: ${outOfKey.length} of ${checked} pitched notes (${(outOfKey.length / checked * 100).toFixed(1)}%) — reported, not failed`)
  for (const [t, list] of Object.entries(byTrack)) {
    const names = [...new Set(list.map(o => NOTE_NAMES[o.pitch % 12]))]
    console.log(`  ${t.padEnd(8)} ${String(list.length).padStart(4)} notes   ${names.join(', ')}   first at beat ${list[0].at.toFixed(2)}`)
  }
  // A single stray note in a track that is otherwise diatonic is the accident
  // worth looking at; a track that is 30% chromatic is a decision.
  const suspicious = Object.entries(byTrack).filter(([, l]) => l.length <= 2)
  if (suspicious.length) {
    console.log('\n  Worth a look — one or two strays in an otherwise in-key track:')
    for (const [t, l] of suspicious) for (const o of l)
      console.log(`    ${t} beat ${o.at.toFixed(2)}: ${name(o.pitch)} in "${o.clip}"`)
  }
}

const failed = problems.length > 0 || (strict && outOfKey.length > 0)
console.log(`\n${failed ? 'FAIL' : 'PASS'}`)
process.exit(failed ? 1 : 0)
