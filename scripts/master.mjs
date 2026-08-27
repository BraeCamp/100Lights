#!/usr/bin/env node
// Master a bounce to a delivery MP3, and PROVE the result before handing it over.
//
// This existed as a copied ffmpeg line — `loudnorm=I=-14:TP=-1.2:LRA=11` — and
// it was quietly not doing what it said. Both delivered masters came out over
// -1 dBTP (-0.75 and -0.52) despite asking for -1.2, for two reasons that are
// easy to miss:
//
//   · One-pass loudnorm is a DYNAMIC normaliser. It makes no true-peak promise;
//     the TP figure is a target it aims at while also compressing. Two-pass with
//     `linear=true` applies a single measured gain instead, which is what a
//     master wants — and pass two reports `normalization_type`, which says
//     whether it actually managed linear or silently fell back to dynamic.
//   · Encoding to MP3 adds inter-sample overshoot AFTER any limiting, so a file
//     that measured fine as a WAV can come back over the line as an MP3.
//
// So it asks for headroom, then measures the FINISHED MP3 with the same true-peak
// code the analyser uses, and lowers the ceiling and re-runs if it is still over.
//
//   node scripts/master.mjs <bounce.wav> [--out=file.mp3] [--lufs=-14] [--tp=-1.0]

import { readFileSync, existsSync, unlinkSync } from 'node:fs'
import { join, dirname, basename, resolve } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { readWav, truePeak, loudness, db } from './lib/audio-features.mjs'

const argv = process.argv.slice(2)
const input = argv.find(a => !a.startsWith('--'))
const flag = (n, d = null) => {
  const a = argv.find(x => x.startsWith(`--${n}=`))
  return a ? a.split('=').slice(1).join('=') : d
}
if (!input) { console.error('usage: master.mjs <bounce.wav> [--out=file.mp3] [--lufs=-14] [--tp=-1.0]'); process.exit(2) }

const targetLufs = Number(flag('lufs', -14))
// LRA is a CEILING on loudness range, and asking for a narrower one than the
// music has forces loudnorm to compress — which would flatten the very
// arrangement dynamics the song was written for. "Cold Signal" has 17.7 dB of
// range; at the copied LRA=11 the master came back "dynamic", meaning squashed.
// Default wide, and let the summary say if it still could not go linear.
const targetLra = Number(flag('lra', 20))
const ceilingDb = Number(flag('tp', -1.0))
const out = flag('out') ?? join(dirname(resolve(input)), basename(input).replace(/\.[^.]+$/, '') + ' (master).mp3')

const ff = (args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...args], { encoding: 'utf8', maxBuffer: 1 << 26 })

function measurePass1(file, tp) {
  // loudnorm prints its measurement to STDERR, and execFileSync only hands back
  // stdout — which is how this first returned null and blew up on .match.
  const res = spawnSync('ffmpeg', ['-hide_banner', '-i', file,
    '-af', `loudnorm=I=${targetLufs}:TP=${tp}:LRA=${targetLra}:print_format=json`, '-f', 'null', '-'],
    { encoding: 'utf8', maxBuffer: 1 << 26 })
  const raw = `${res.stderr ?? ''}${res.stdout ?? ''}`
  const m = raw.match(/\{[\s\S]*?\}/)
  if (!m) throw new Error('loudnorm pass 1 produced no measurement:\n' + raw.slice(-400))
  return JSON.parse(m[0])
}

let tp = Number(flag('tp', -1.0)) - 0.4        // ask for a little more headroom than the ceiling
let attempt = 0, result = null

while (attempt < 4) {
  attempt++
  const s = measurePass1(input, tp)
  ff(['-y', '-i', input, '-af',
    `loudnorm=I=${targetLufs}:TP=${tp}:LRA=${targetLra}:measured_I=${s.input_i}:measured_TP=${s.input_tp}:` +
    `measured_LRA=${s.input_lra}:measured_thresh=${s.input_thresh}:offset=${s.target_offset}:linear=true:print_format=summary`,
    '-c:a', 'libmp3lame', '-q:a', '2', out])

  // Measure the FINISHED file, decoded back, with the same code the analyser uses.
  const t = join(tmpdir(), `master-check-${process.pid}.wav`)
  ff(['-y', '-i', out, '-ar', '48000', t])
  const w = readWav(readFileSync(t))
  const peakDb = db(truePeak(w.l, w.r, w.sr))
  const lufs = loudness(w.l, w.r, w.sr).lufs
  try { unlinkSync(t) } catch { /* fine */ }
  result = { attempt, tp, peakDb: +peakDb.toFixed(2), lufs, normalization: s.normalization_type ?? '?' }
  console.log(`  attempt ${attempt}: asked TP ${tp.toFixed(1)} → ${lufs} LUFS, ${peakDb.toFixed(2)} dBTP (${s.normalization_type ?? '?'})`)
  if (peakDb <= ceilingDb) break
  // Still over: the encoder added overshoot. Lower the ceiling by the miss plus
  // a little, and go again.
  tp -= (peakDb - ceilingDb) + 0.3
}

console.log(`\n${basename(out)}`)
console.log(`  ${result.lufs} LUFS   ${result.peakDb} dBTP   ` +
  (result.peakDb <= ceilingDb ? `within ${ceilingDb} dBTP` : `** STILL OVER ${ceilingDb} dBTP **`))
if (result.normalization !== 'linear') {
  // Not a fault, but worth knowing. Linear normalisation applies one gain to the
  // whole file; it is only possible when that gain does not push the peak past
  // the ceiling. Lifting a quiet bounce with a lot of crest up to streaming
  // level cannot be done that way, so the master limits — which is what
  // mastering is. The lever, if you want less of it, is a mix with a lower crest
  // (tame the loudest transients) rather than anything in this script.
  console.log(`  limiting applied ("${result.normalization}"): the gain needed to reach ${targetLufs} LUFS`)
  console.log(`  would have pushed the peak past the ceiling, so the peaks were held down.`)
}
console.log(`→ ${out}`)
process.exit(result.peakDb <= ceilingDb ? 0 : 1)
