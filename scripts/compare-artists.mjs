#!/usr/bin/env node
// Put artist profiles side by side, and let the differences name themselves.
//
// This is how a genre gets decided here rather than assumed. A label like
// "electronic pop" or "alt-R&B" is a claim about a body of work, and the useful
// version of that claim is the one you can point at: this artist masters 5 dB
// louder, that one's harmony layer is 12 dB further down, this one is four on
// the floor and that one is half-time.
//
//   node scripts/compare-artists.mjs                      # every profile
//   node scripts/compare-artists.mjs artemas twofeet      # named ones
//
// The markers below are the ones that actually separate idioms in practice.
// None of them decides alone — a genre is the pattern across all of them, which
// is why this prints a table rather than a verdict.

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIR = join(ROOT, 'styles')
if (!existsSync(DIR)) { console.error('no styles/ yet — run scripts/build-style.mjs first'); process.exit(2) }

const want = process.argv.slice(2).filter(a => !a.startsWith('--'))
const files = readdirSync(DIR).filter(f => f.endsWith('.json'))
  .filter(f => !want.length || want.includes(f.replace(/\.json$/, '')))
if (!files.length) { console.error('no matching profiles'); process.exit(2) }
const P = files.map(f => JSON.parse(readFileSync(join(DIR, f), 'utf8')))

const s = v => (v == null ? '—' : String(v))
const med = x => (x && x.median != null ? x.median : null)
const rng = x => (x ? `${x.lo}–${x.hi}` : '—')
const pctMed = b => (b ? (b.median * 100).toFixed(1) + '%' : '—')

const W = 20
const row = (label, vals) => console.log(`  ${label.padEnd(24)}` + vals.map(v => s(v).padStart(W)).join(''))
const head = () => console.log(`  ${''.padEnd(24)}` + P.map(p => (p.artist ?? p.name).slice(0, W - 1).padStart(W)).join(''))

console.log('\nARTIST PROFILES — the markers that separate idioms\n')
head()
console.log('  ' + '─'.repeat(24 + W * P.length))
row('records', P.map(p => p.tracks))
row('tempo (range)', P.map(p => rng(p.tempo)))
row('tempo (median)', P.map(p => med(p.tempo)))
row('keys', P.map(p => {
  const minor = p.keys.filter(k => /minor/.test(k)).length
  return `${minor}/${p.keys.length} minor`
}))

console.log('')
row('drum onsets /sec', P.map(p => med(p.groove?.onsetsPerSec)))
row('groove spread ms', P.map(p => med(p.groove?.spreadMs)))
row('swing %', P.map(p => med(p.groove?.swingPct)))

console.log('')
row('master LUFS', P.map(p => med(p.fullMix?.lufs)))
row('crest dB', P.map(p => med(p.fullMix?.crestDb)))
row('correlation', P.map(p => med(p.fullMix?.correlation)))
row('centroid Hz (full)', P.map(p => med(p.fullMix?.centroidHz)))
row('centroid Hz (instr)', P.map(p => med(p.instrumental?.centroidHz)))

console.log('')
row('sections', P.map(p => med(p.arrangement?.sections)))
row('travels dB', P.map(p => med(p.arrangement?.travelsDb)))
row('length s', P.map(p => med(p.arrangement?.seconds)))

console.log('\n  instrumental bands (median share of audible energy)')
for (const b of ['sub', 'bass', 'lowMid', 'mid', 'highMid', 'presence', 'brilliance', 'air']) {
  row('  ' + b, P.map(p => pctMed(p.instrumental?.bands?.[b])))
}

console.log('\n  element balance (median dB under the summed stems)')
for (const k of ['bass', 'drums', 'vocals', 'other']) {
  row('  ' + k, P.map(p => med(p.balance?.[k])))
}

// A few derived readings that are more legible than the raw numbers.
console.log('\n  reading')
row('  low end share', P.map(p => {
  const b = p.instrumental?.bands
  if (!b) return '—'
  return ((b.sub.median + b.bass.median) * 100).toFixed(0) + '%'
}))
row('  harmony vs bass', P.map(p => {
  const o = med(p.balance?.other), b = med(p.balance?.bass)
  return (o == null || b == null) ? '—' : `${(o - b).toFixed(1)} dB`
}))
row('  vocal vs bass', P.map(p => {
  const v = med(p.balance?.vocals), b = med(p.balance?.bass)
  return (v == null || b == null) ? '—' : `${(v - b).toFixed(1)} dB`
}))
row('  stated genre', P.map(p => (p.genre ?? '—').split('—')[0].trim().slice(0, W - 1)))
console.log('')
