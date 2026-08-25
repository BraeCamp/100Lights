// Where does a picked set of files open? Audio belongs in Beacon; anything with
// picture in it belongs in the video editor. This is the decision that used to
// send every import — songs included — to the video editor.
//
//   npm run test:handoff

import assert from 'node:assert'
import { createRequire } from 'node:module'

// Compiled to CommonJS (see test:handoff) so its relative imports resolve
// without extensions the way the bundler resolves them in the app.
const { destinationFor } = createRequire(import.meta.url)('../.test-build/media-handoff.js')

// Minimal stand-in for File: destinationFor only reads `name` and `type`.
const f = (name, type = '') => ({ name, type })

const isBeacon = (u) => u.startsWith('/create?modules=audio')
const isVideo = (u) => u.startsWith('/create?modules=video')

let failures = 0
const check = (label, actual, want) => {
  const pass = want(actual)
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}  → ${actual}`)
}

// The case Brae hit: a song picked from the dashboard.
check('one mp3 opens Beacon', destinationFor([f('Iced.mp3', 'audio/mpeg')]), isBeacon)
check('a wav opens Beacon', destinationFor([f('stem.wav', 'audio/wav')]), isBeacon)
check('several songs open Beacon', destinationFor([f('a.mp3', 'audio/mpeg'), f('b.flac')]), isBeacon)

// Extension-only detection: many sources hand over an empty MIME type.
check('an mp3 with NO mime still opens Beacon', destinationFor([f('untitled.mp3')]), isBeacon)
check('aiff opens Beacon', destinationFor([f('take.aiff')]), isBeacon)

// Picture still belongs to the video editor.
check('an mp4 opens the video editor', destinationFor([f('clip.mp4', 'video/mp4')]), isVideo)
check('a .mov with no mime opens the video editor', destinationFor([f('clip.mov')]), isVideo)
check('audio + video together open the video editor', destinationFor([f('a.mp3', 'audio/mpeg'), f('b.mp4', 'video/mp4')]), isVideo)
check('an image opens the video editor', destinationFor([f('cover.png', 'image/png')]), isVideo)

// Nothing picked must not claim to be an all-audio selection ([].every === true).
check('an empty pick does not route to Beacon', destinationFor([]), isVideo)

// Beacon's URL has to actually land on the music studio and ask for the drain.
const beacon = destinationFor([f('x.mp3', 'audio/mpeg')])
check('Beacon URL selects music mode', beacon, (u) => u.includes('audioMode=music'))
check('Beacon URL asks for the import', beacon, (u) => u.includes('importMedia=1'))

assert.equal(failures, 0, `${failures} routing case(s) wrong`)
console.log('\nall media-handoff routing cases pass')
