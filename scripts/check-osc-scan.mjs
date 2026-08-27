#!/usr/bin/env node
// Does an oscillator's start/end/loop actually travel through the table?
//
//   npm run check:osc-scan
//
// Brae: "I should be able to change the start and end to oscillator sounds and
// set loop to it too."
//
// `wt.pos` picks one frame of a wavetable and sits there, so an oscillator had
// no answer to the things a sample takes for granted. A scan gives it those: a
// region of the table, and a way of moving through it.
//
// The claim is not "it sounds different" — moving a knob does that. The claim is
// that the timbre MOVES while one note is held. So this renders a single
// sustained note and compares the brightness of its first half against its
// second: with the scan off those should match, and with it on they must not.
// A scan that quietly did nothing would pass any test that only compared two
// renders to each other.

import { readFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import assert from 'node:assert'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const tmp = mkdtempSync(join(tmpdir(), 'scan-'))

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

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

/**
 * Brightness: the share of energy above 2kHz.
 *
 * NOT zero crossings, which was the first attempt and is blind here — a
 * sawtooth crosses zero once per cycle whatever its harmonic content, so both
 * renders measured 524/s (middle C, twice) and the check cheerfully reported
 * that a working feature did nothing. The metric has to look at the harmonics,
 * because harmonics are the thing the scan changes.
 */
function brightness(data, rate, fromSec, toSec) {
  const a = Math.floor(fromSec * rate)
  const n = Math.min(data.length - a, Math.floor((toSec - fromSec) * rate))
  let total = 0, high = 0
  // Goertzel over a spread of frequencies, split at 2kHz.
  for (const hz of [200, 400, 800, 1600, 2400, 3600, 5200, 7600]) {
    let re = 0, im = 0
    for (let i = 0; i < n; i++) {
      const t = i / rate
      re += data[a + i] * Math.cos(2 * Math.PI * hz * t)
      im += data[a + i] * Math.sin(2 * Math.PI * hz * t)
    }
    const mag = Math.hypot(re, im) / n
    total += mag
    if (hz >= 2000) high += mag
  }
  return total > 0 ? high / total : 0
}

function render(name, sets) {
  const out = join(tmp, `${name}.wav`)
  execFileSync('node', [
    '--experimental-strip-types', join(ROOT, 'scripts/apollo-render.mjs'),
    '--preset', 'Init',
    '--set', 'osc0.engine=wavetable',
    '--set', 'osc0.wt.tableId=analog-saws',
    ...sets.flatMap(s => ['--set', s]),
    '--notes', '60:0:3:0.9', '--seconds', '3.2', '--out', out,
  ], { stdio: 'pipe', cwd: ROOT })
  return readWavMono(out)
}

// A held note with the scan OFF: the table position never moves, so the first
// half and the second half should be the same sound.
const off = render('off', ['osc0.wt.pos=0.2'])
const offEarly = brightness(off.data, off.rate, 0.3, 1.0)
const offLate = brightness(off.data, off.rate, 1.8, 2.5)
const offDrift = Math.abs(offLate - offEarly) / Math.max(1e-4, offEarly)
console.log(`scan off:  ${offEarly.toFixed(3)} -> ${offLate.toFixed(3)} high-freq share  (${(offDrift * 100).toFixed(1)}% drift)`)
// NOT "no drift at all". The Init patch has an amplitude envelope, so a held
// note darkens a little on its own — measured at ~24%. That is the baseline the
// scan has to beat, and asserting an absolute "holds still" here would have been
// asserting something untrue about the patch rather than about the scan.
check('the baseline drifts only as much as its envelope explains', offDrift < 0.35, `${(offDrift * 100).toFixed(1)}%`)

// The same note with the scan travelling the whole table once, slowly. Now the
// two halves are different points in the table and must not match.
const on = render('on', ['osc0.wt.scan.mode=once', 'osc0.wt.scan.start=0', 'osc0.wt.scan.end=1', 'osc0.wt.scan.rate=0.35'])
const onEarly = brightness(on.data, on.rate, 0.3, 1.0)
const onLate = brightness(on.data, on.rate, 1.8, 2.5)
const onDrift = Math.abs(onLate - onEarly) / Math.max(1e-4, onEarly)
console.log(`scan on:   ${onEarly.toFixed(3)} -> ${onLate.toFixed(3)} high-freq share  (${(onDrift * 100).toFixed(1)}% drift)`)
check('with the scan on the timbre travels further', onDrift > offDrift * 1.8,
  `${(onDrift * 100).toFixed(1)}% against a ${(offDrift * 100).toFixed(1)}% baseline`)

// start === end is a region of no width: the scan has nowhere to go, so it must
// behave like a fixed position rather than doing something surprising.
// Same table position as the baseline render, so the two are comparable — the
// first version pinned at 0.5 and compared it against a baseline at 0.2, which
// measured the difference between two frames rather than the effect of the scan.
const pinned = render('pinned', ['osc0.wt.pos=0.2', 'osc0.wt.scan.mode=loop', 'osc0.wt.scan.start=0.2', 'osc0.wt.scan.end=0.2', 'osc0.wt.scan.rate=4'])
const pinDrift = Math.abs(
  brightness(pinned.data, pinned.rate, 1.8, 2.5) - brightness(pinned.data, pinned.rate, 0.3, 1.0),
) / Math.max(1e-4, brightness(pinned.data, pinned.rate, 0.3, 1.0))
check('a zero-width region behaves like no scan at all',
  Math.abs(pinDrift - offDrift) < 0.15, `${(pinDrift * 100).toFixed(1)}% against ${(offDrift * 100).toFixed(1)}%`)

console.log(failures ? `\n${failures} failing` : '\nan oscillator can be given a start, an end and a loop')
assert.equal(failures, 0)
