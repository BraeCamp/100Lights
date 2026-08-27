#!/usr/bin/env node --experimental-strip-types
// Make every voice in the palette the same loudness, so a track fader means the
// same thing whichever instrument is on it.
//
// THE PROBLEM THIS SOLVES, from a real mix: in "Coriander" the electric piano
// came out at -27 dB, the kick at -36 and the snare at -49. The kick was nine
// decibels underneath the comping and the snare was inaudible — and the track
// volumes were already set to 0.52 for the kick against 0.40 for the keys, so
// the author was compensating in the wrong direction without knowing it.
//
// The cause is that these patches were designed one at a time, listening to each
// alone, and their intrinsic output levels differ by more than 10 dB. Every song
// then hand-tuned eight faders to undo that, blind, and got it wrong in a
// different way each time. Worse, it hid a real arrangement problem: when the
// drums are 9 dB down, a section that adds drums barely gets louder, which is
// why that song measured only 7 dB of movement between its quietest and loudest
// passages while the reference set moves 26.
//
// So: render each voice, measure it the way an ear weights loudness (K-weighted,
// BS.1770) rather than by raw RMS, and write the trim that brings it to a common
// target. Percussion and pads need this measured perceptually — a kick has huge
// peaks and little energy, a pad the reverse, and normalising either by peak or
// by RMS alone gets one of them badly wrong.
//
//   node --experimental-strip-types scripts/voice-calibrate.mjs          # report
//   node --experimental-strip-types scripts/voice-calibrate.mjs --write  # save trims
//
// The result lands in scripts/voice-levels.json and is applied by apollo-voices.

import { writeFileSync, readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { readWav } from './lib/offline-dsp.mjs'
import { loudness, levels } from './lib/audio-features.mjs'
import { VOICES } from './apollo-voices.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const write = argv.includes('--write')

// TWO targets, because one measurement cannot cover both cases.
//
// BS.1770 integrates over 400 ms blocks and gates anything below -70 LUFS. A
// closed hi-hat is forty milliseconds long: there is no complete block to
// measure, so the first version of this read every drum as -70 and prescribed a
// gain of 224x, which would have clipped the whole palette. That is the bug this
// comment exists to stop being reintroduced.
//
// So percussion is normalised by TRUE PEAK and sustained voices by LOUDNESS,
// which is what an engineer does anyway — drums are placed by how hard they hit,
// pads by how much room they take up. The two scales are joined by the
// percussive target below, which is a judgement, checked in a real mix rather
// than argued from first principles: at -9 dBTP a kick sits about where it
// should against a pad at -23 LUFS.
const TARGET_LUFS = -23
const TARGET_PERC_PEAK_DB = -9
const PERC_MAX_SEC = 0.5           // shorter than this and it is a hit, not a note

const tmp = mkdtempSync(join(tmpdir(), 'voice-cal-'))
const rows = []

for (const [name, v] of Object.entries(VOICES)) {
  const pf = join(tmp, `${name}.json`), wf = join(tmp, `${name}.wav`)
  // Measure the patch with any existing trim REMOVED, so calibrating twice does
  // not compound. masterGain 0.8 is what patch() sets before a trim is applied.
  const p = v.build()
  p.global = { ...p.global, masterGain: 0.8 }
  writeFileSync(pf, JSON.stringify(p))
  try {
    execFileSync('node', ['--experimental-strip-types', join(ROOT, 'scripts/apollo-render.mjs'),
      '--patch', pf, '--notes', v.notes, '--seconds', String(v.seconds), '--out', wf, '--json'],
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 })
    const w = readWav(readFileSync(wf))
    const lv = levels(w.l, w.r)
    if (lv.peak < 0.0005) { rows.push({ name, silent: true }); continue }
    // The sounding region only — a one-shot measured across two seconds of
    // trailing silence reads far quieter than it is.
    let last = w.l.length - 1
    while (last > 0 && Math.max(Math.abs(w.l[last]), Math.abs(w.r[last])) < 0.001) last--
    const soundSec = (last + 1) / w.sr
    const l = w.l.subarray(0, last + 1), r = w.r.subarray(0, last + 1)

    const percussive = soundSec < PERC_MAX_SEC
    let measured, trimDb
    if (percussive) {
      measured = 20 * Math.log10(Math.max(1e-9, lv.peak))
      trimDb = TARGET_PERC_PEAK_DB - measured
    } else {
      measured = loudness(l, r, w.sr).lufs
      trimDb = TARGET_LUFS - measured
    }
    // A trim this large means the patch itself is wrong, not its level.
    if (Math.abs(trimDb) > 24) { rows.push({ name, error: `implausible trim ${trimDb.toFixed(1)} dB — check the patch` }); continue }
    rows.push({
      name, percussive, soundSec: +soundSec.toFixed(3), measured: +measured.toFixed(2), peak: lv.peak,
      trimDb: +trimDb.toFixed(2), gain: +Math.pow(10, trimDb / 20).toFixed(4),
    })
  } catch (e) {
    rows.push({ name, error: String(e.message).split('\n')[0].slice(0, 70) })
  }
}
rmSync(tmp, { recursive: true, force: true })

console.log(`\nvoice          kind    measured    trim    gain   peak after`)
console.log('─'.repeat(66))
for (const r of rows) {
  if (r.error) { console.log(`${r.name.padEnd(13)} ERROR ${r.error}`); continue }
  if (r.silent) { console.log(`${r.name.padEnd(13)} ** SILENT **`); continue }
  const after = r.peak * r.gain
  const flag = after > 0.95 ? '  ← will clip; lower the patch instead' : ''
  const kind = r.percussive ? 'hit ' : 'note'
  console.log(`${r.name.padEnd(13)} ${kind}${String(r.measured).padStart(9)} ${String(r.trimDb > 0 ? '+' + r.trimDb : r.trimDb).padStart(7)} ${String(r.gain).padStart(7)}${after.toFixed(3).padStart(10)}${flag}`)
}

const ok = rows.filter(r => r.gain)
const notes = ok.filter(r => !r.percussive)
const spread = Math.max(...notes.map(r => r.measured)) - Math.min(...notes.map(r => r.measured))
console.log(`\nspread before calibration: ${spread.toFixed(1)} dB between the loudest and quietest sustained voice`)
console.log(`targets: ${TARGET_LUFS} LUFS for notes, ${TARGET_PERC_PEAK_DB} dBTP for hits`)

if (write) {
  const out = Object.fromEntries(ok.map(r => [r.name, r.gain]))
  const path = join(ROOT, 'scripts/voice-levels.json')
  writeFileSync(path, JSON.stringify(out, null, 2))
  console.log(`\n→ ${path}`)
  console.log('apollo-voices applies these, so a track volume of 0.5 now means the same')
  console.log('thing on every instrument and a fader is a musical decision again.')
} else {
  console.log('\n(run with --write to save)')
}
