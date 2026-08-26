#!/usr/bin/env node
// Turn a set of studied records into a STYLE profile.
//
// A style profile is not a recipe and must not read like one. Five Artemas
// records span 95 to 152 BPM, 11% to 56% sub, and 1.4 to 15.6 dB of travel —
// so what a profile can honestly say is "here is the space these records
// occupy", and choosing a point inside it is a decision the song makes, not
// something the profile makes for it. Everything here is therefore a RANGE with
// the individual values kept alongside, never an average pretending to be a
// target.
//
//   node scripts/study.mjs <track> --stems=<dir> --json > study/track.json   (per track)
//   node scripts/build-style.mjs --name=dark-pop --from=study/
//
// The `instrumental` numbers are the ones that matter for us and they are kept
// separate on purpose: these references have vocals and our music does not, so
// comparing our instrumental against their full mix would blame the arrangement
// for a missing singer.

import { readFileSync, writeFileSync, readdirSync, mkdirSync, statSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const flag = (n, d = null) => { const a = argv.find(x => x.startsWith(`--${n}=`)); return a ? a.split('=').slice(1).join('=') : d }
const name = flag('name')
const from = flag('from')
if (!name || !from) { console.error('usage: build-style.mjs --name=dark-pop --from=<dir of study json>'); process.exit(2) }

const dir = resolve(from)
const rows = readdirSync(dir).filter(f => f.endsWith('.json'))
  .map(f => JSON.parse(readFileSync(join(dir, f), 'utf8')))
if (rows.length < 3) { console.error(`only ${rows.length} studied tracks — a style needs at least 3`); process.exit(1) }

const num = a => a.filter(v => typeof v === 'number' && Number.isFinite(v))
const span = a => { const v = num(a); if (!v.length) return null; const s = [...v].sort((x, y) => x - y); return { lo: +s[0].toFixed(3), hi: +s[s.length - 1].toFixed(3), median: +s[Math.floor(s.length / 2)].toFixed(3) } }
const pick = (f) => span(rows.map(f))

const bandsOf = key => {
  const have = rows.filter(r => r[key]?.bands)
  if (!have.length) return null
  const out = {}
  for (const b of Object.keys(have[0][key].bands)) out[b] = span(have.map(r => r[key].bands[b]))
  return { from: have.length, bands: out }
}

const style = {
  name,
  kind: 'style profile — ranges, not a recipe',
  measuredFrom: rows.map(r => r.file),
  tracks: rows.length,

  tempo: pick(r => r.tempo),
  keys: rows.map(r => r.key),

  // What a listener hears. Includes the voice.
  fullMix: {
    lufs: pick(r => r.mix.lufs),
    crestDb: pick(r => r.mix.crestDb),
    dynamicRangeDb: pick(r => r.mix.dynamicRangeDb),
    correlation: pick(r => r.mix.correlation),
    centroidHz: pick(r => r.mix.centroidHz),
    ...(bandsOf('mix') ?? {}),
  },

  // What we actually make. The comparable thing.
  instrumental: rows.some(r => r.instrumental) ? {
    centroidHz: span(rows.filter(r => r.instrumental).map(r => r.instrumental.centroidHz)),
    ...(bandsOf('instrumental') ?? {}),
  } : null,

  groove: {
    onsetsPerSec: pick(r => r.groove?.perSec),
    spreadMs: pick(r => r.groove?.spreadMs),
    swingPct: pick(r => r.groove?.swingPct),
    meanDeviationMs: pick(r => r.groove?.meanDeviationMs),
  },

  arrangement: {
    sections: pick(r => r.arrangement?.sections),
    travelsDb: pick(r => r.arrangement ? r.arrangement.loudDb - r.arrangement.quietDb : null),
    seconds: pick(r => r.seconds),
  },

  // How loud each element sits relative to the others. This is the one that
  // reorders an arrangement rather than just EQing it.
  balance: (() => {
    const have = rows.filter(r => r.balance && Object.keys(r.balance).length)
    if (!have.length) return null
    const out = { from: have.length }
    for (const k of ['bass', 'drums', 'vocals', 'other']) {
      const s = span(have.map(r => r.balance[k]))
      if (s) out[k] = s
    }
    return out
  })(),
}

mkdirSync(join(ROOT, 'styles'), { recursive: true })
const out = join(ROOT, 'styles', `${name}.json`)
writeFileSync(out, JSON.stringify(style, null, 2))

const fmtSpan = s => s ? `${s.lo} … ${s.hi}  (median ${s.median})` : '—'
console.log(`\n${name} — from ${rows.length} records\n`)
console.log(`  tempo          ${fmtSpan(style.tempo)}`)
console.log(`  keys           ${style.keys.join(', ')}`)
console.log(`  travels        ${fmtSpan(style.arrangement.travelsDb)} dB`)
console.log(`  sections       ${fmtSpan(style.arrangement.sections)}`)
console.log(`  groove spread  ${fmtSpan(style.groove.spreadMs)} ms`)
console.log(`  swing          ${fmtSpan(style.groove.swingPct)} %`)
console.log(`  master LUFS    ${fmtSpan(style.fullMix.lufs)}   crest ${fmtSpan(style.fullMix.crestDb)}`)
if (style.instrumental) {
  console.log(`\n  INSTRUMENTAL bands (${style.instrumental.from} tracks) — the comparable ones:`)
  for (const [b, s] of Object.entries(style.instrumental.bands)) {
    console.log(`    ${b.padEnd(11)}${(s.lo * 100).toFixed(1).padStart(6)}% … ${(s.hi * 100).toFixed(1).padStart(5)}%   median ${(s.median * 100).toFixed(1)}%`)
  }
}
if (style.balance) {
  console.log(`\n  balance, dB under the summed stems:`)
  for (const [k, s] of Object.entries(style.balance)) {
    if (k === 'from') continue
    console.log(`    ${k.padEnd(8)}${fmtSpan(s)}`)
  }
}
console.log(`\n→ ${out}`)
