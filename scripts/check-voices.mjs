#!/usr/bin/env node
// Is every shared Apollo voice actually in tune?
//
//   npm run check:voices
//
// check-tuning inspects a finished song. This inspects the INSTRUMENTS every
// song is built from, which is where the problem actually lived: nine of the
// shared voices carried `unison: 2` with detune between 0.1 and 0.46, and at
// unison 2 there is no middle voice — both copies sit at the extremes of the
// spread and the lower one dominates, so the whole instrument plays flat by
// roughly detune x 100 cents. Undertow's pad was 46 cents under the note it was
// given, beneath an organ sitting at exactly zero. Every song written from these
// voices inherited it.
//
// Checking the voices rather than the songs catches it once, before a note is
// written, instead of once per song after it sounds wrong.

import { writeFileSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { execFileSync } from 'child_process'
import { readFileSync } from 'fs'
import * as VOICES from './apollo-voices.mjs'
import { tuningNear, beatOf } from './check-tuning.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const tmp = mkdtempSync(join(tmpdir(), 'voices-'))
const midiHz = m => 440 * Math.pow(2, (m - 69) / 12)

/** Read a 16-bit WAV to mono. */
function readWavMono(path) {
  const buf = readFileSync(path)
  let pos = 12, off = -1, len = 0, ch = 2, rate = 48000
  while (pos < buf.length - 8) {
    const id = buf.toString('ascii', pos, pos + 4), sz = buf.readUInt32LE(pos + 4)
    if (id === 'fmt ') { ch = buf.readUInt16LE(pos + 10); rate = buf.readUInt32LE(pos + 12) }
    if (id === 'data') { off = pos + 8; len = sz; break }
    pos += 8 + sz + (sz & 1)
  }
  const frames = Math.floor(len / (2 * ch))
  const out = new Float32Array(frames)
  for (let i = 0; i < frames; i++) {
    let s = 0
    for (let c = 0; c < ch; c++) s += buf.readInt16LE(off + (i * ch + c) * 2) / 32768
    out[i] = s / ch
  }
  return { data: out, rate }
}

// Pitched voices only, each at a note in the register it is actually used in.
// Percussion is excluded: a kick has no pitch to be wrong about.
const CASES = [
  ['subBass', 36], ['bass', 45], ['funkBass', 45],
  ['pad', 60], ['keys', 67], ['choirish', 67], ['organ', 62],
  ['harpsi', 64], ['strings', 62], ['warmEp', 60],
]

let failures = 0
console.log('SHARED VOICES — does each play the note it is given?\n')
console.log('voice          note   centre pitch   beating   verdict')

for (const [name, note] of CASES) {
  const make = VOICES[name]
  if (typeof make !== 'function') { console.log(`  ${name.padEnd(12)} (not found)`); failures++; continue }
  const patchPath = join(tmp, `${name}.json`)
  writeFileSync(patchPath, JSON.stringify(make()))
  const wav = join(tmp, `${name}.wav`)
  try {
    execFileSync('node', ['--experimental-strip-types', join(ROOT, 'scripts/apollo-render.mjs'),
      '--patch', patchPath, '--notes', `${note}:0:2.5:0.9`, '--seconds', '3', '--out', wav],
      { stdio: 'pipe', cwd: ROOT })
  } catch {
    console.log(`  ${name.padEnd(12)} ${String(note).padStart(5)}   (render failed)`)
    failures++; continue
  }
  const { data, rate } = readWavMono(wav)
  const t = tuningNear(data, rate, midiHz(note))
  const b = beatOf(data, rate)
  const err = t ? t.centreErr : null
  const beat = b && b.depth > 0.15 ? b.rate : null
  // 12 cents is where two instruments start to sound like they disagree;
  // beating above 5Hz is heard as roughness rather than warmth.
  const bad = err == null || Math.abs(err) > 12 || (beat != null && beat > 5)
  if (bad) failures++
  console.log(`  ${name.padEnd(12)} ${String(note).padStart(5)} ${
    (err == null ? '—' : `${err >= 0 ? '+' : ''}${err.toFixed(1)}¢`).padStart(14)} ${
    (beat == null ? '—' : `${beat.toFixed(1)}Hz`).padStart(9)}   ${bad ? 'OFF' : 'ok'}`)
}

console.log(failures
  ? `\n${failures} voice${failures === 1 ? '' : 's'} out of tune — songs built from these will sound wrong`
  : '\nevery shared voice plays the note it is given')
process.exitCode = failures ? 1 : 0
