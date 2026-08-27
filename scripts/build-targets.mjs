#!/usr/bin/env node
// Measure a set of reference tracks and write out what "normal" looks like.
//
// Every threshold in verdicts.mjs was a guess until this existed. A guess is
// worse than nothing, because it produces confident advice with no basis — and
// the advice that came out of guessed thresholds was, more than once, to EQ the
// character out of a genre that was supposed to sound that way.
//
// So: measure real music with the SAME code that measures ours, take the range
// the references actually occupy, and make that the target. When our mix falls
// outside it, that is a real difference from real music rather than a difference
// from an opinion.
//
//   node scripts/build-targets.mjs --name=general --from=~/100lights-ml-corpus
//   node scripts/build-targets.mjs --name=house --from=./refs/house --genre=house
//
// Anything ffmpeg can decode works. The reference set should be music you would
// be happy for a song to sit next to; a target built from three tracks is a
// target built from three tracks, and the output says so.

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync } from 'node:fs'
import { join, dirname, resolve, basename, extname } from 'node:path'
import { execFileSync } from 'node:child_process'
import { tmpdir, homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { readWav, analyze } from './lib/audio-features.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const flag = (n, d = null) => {
  const a = argv.find(x => x === `--${n}` || x.startsWith(`--${n}=`))
  return a ? (a.includes('=') ? a.split('=').slice(1).join('=') : true) : d
}
const name = flag('name', 'general')
const genre = flag('genre', null)
const sources = argv.filter(a => !a.startsWith('--'))
if (!sources.length) sources.push(join(homedir(), '100lights-ml-corpus', 'songs'))

const AUDIO = new Set(['.wav', '.mp3', '.m4a', '.flac', '.ogg', '.aac'])
function collect(p) {
  const out = []
  const walk = d => {
    for (const e of readdirSync(d)) {
      const f = join(d, e)
      const s = statSync(f)
      // Only whole mixes. A folder of stems would weight the target toward
      // whatever instrument happened to have the most files.
      if (s.isDirectory()) { if (e !== 'stems') walk(f) }
      else if (AUDIO.has(extname(e).toLowerCase())) out.push(f)
    }
  }
  statSync(p).isDirectory() ? walk(p) : out.push(p)
  return out
}

const files = sources.flatMap(s => collect(resolve(s.replace(/^~/, homedir()))))
if (!files.length) { console.error('no audio found in ' + sources.join(', ')); process.exit(1) }

console.log(`measuring ${files.length} reference track(s)…`)
const rows = []
for (const f of files) {
  let p = f
  try {
    if (extname(f).toLowerCase() !== '.wav') {
      // Hash the FULL path. Hashing the basename meant every corpus entry —
      // all of them called mix.mp3 — decoded to the same temp file, so nine
      // references produced nine copies of one measurement and every percentile
      // collapsed onto the same number.
      p = join(tmpdir(), `ref-${Math.abs([...f].reduce((a, c) => a * 31 + c.charCodeAt(0) | 0, 7))}.wav`)
      if (!existsSync(p)) execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', f, '-ar', '48000', '-ac', '2', p])
    }
    const w = readWav(readFileSync(p))
    if (w.frames < 48000 * 10) { console.log(`  skip ${basename(f)} — under 10s`); continue }
    rows.push({ file: basename(f), ...analyze(w.l, w.r, w.sr, { withTruePeak: false, withBandStereo: false }) })
    console.log(`  ok   ${f.split("/").slice(-2).join("/")}`)
  } catch (e) {
    console.log(`  fail ${basename(f)} — ${e.message.split('\n')[0]}`)
  }
}
if (rows.length < 3) { console.error(`only ${rows.length} usable reference(s) — a target needs at least 3`); process.exit(1) }

// Percentile band rather than min/max: one unusual reference should widen a
// target a little, not blow it open.
const pct = (arr, q) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))] }
const range = (vals, lo = 0.1, hi = 0.9) => [+pct(vals, lo).toFixed(4), +pct(vals, hi).toFixed(4)]
const median = vals => +pct(vals, 0.5).toFixed(4)

const col = k => rows.map(r => r[k])
const bandCol = b => rows.map(r => r.bands[b])

const target = {
  name: genre ? `${name} (${genre})` : name,
  provisional: false,
  builtFrom: { tracks: rows.length, files: rows.map(r => r.file), when: '(stamped by the caller)' },
  // Engineering limits stay absolute — they are not a matter of what the
  // references happened to do.
  truePeakDb: [null, -1.0],
  clippedSamples: [null, 0],
  // Loudness is deliberately wide: a project bounce is not mastered, and
  // matching a released track's level in the bounce only causes clipping.
  lufs: [-32, -8],
  bands: Object.fromEntries(Object.keys(rows[0].bands).map(b => [b, range(bandCol(b))])),
  centroidHz: range(col('centroidHz')),
  crestDb: range(col('crestDb')),
  dynamicRangeDb: [+pct(col('dynamicRangeDb'), 0.1).toFixed(2), null],
  correlation: [null, +pct(col('correlation'), 0.9).toFixed(3)],
  // Feel and arrangement cannot be measured from a rendered reference, so they
  // stay as judgement and are carried over unchanged.
  maxOnGridPct: 85,
  minVelocitySpread: 4,
  maxSectionChurn: 2,
  minSections: 4,
  minSeconds: 90,
  medians: {
    lufs: median(col('lufs')), crestDb: median(col('crestDb')),
    dynamicRangeDb: median(col('dynamicRangeDb')), centroidHz: median(col('centroidHz')),
    correlation: median(col('correlation')),
    bands: Object.fromEntries(Object.keys(rows[0].bands).map(b => [b, median(bandCol(b))])),
  },
}

mkdirSync(join(ROOT, 'targets'), { recursive: true })
const out = join(ROOT, 'targets', `${name}.json`)
writeFileSync(out, JSON.stringify(target, null, 2))

console.log(`\n${target.name} — from ${rows.length} reference tracks`)
console.log('  band        p10 … p90        median')
for (const [b, r] of Object.entries(target.bands))
  console.log(`  ${b.padEnd(11)}${(r[0] * 100).toFixed(1).padStart(6)}% …${(r[1] * 100).toFixed(1).padStart(6)}%   ${(target.medians.bands[b] * 100).toFixed(1).padStart(6)}%`)
console.log(`  centroid    ${target.centroidHz[0]} … ${target.centroidHz[1]} Hz   median ${target.medians.centroidHz}`)
console.log(`  crest       ${target.crestDb[0]} … ${target.crestDb[1]} dB`)
console.log(`  range       at least ${target.dynamicRangeDb[0]} dB   median ${target.medians.dynamicRangeDb}`)
console.log(`\n→ ${out}`)
