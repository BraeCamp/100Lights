#!/usr/bin/env node
// ── Arrangement flatness report ───────────────────────────────────────────────
// The composer critiquing its own output. Reads a build-spec (public/_songgen/
// *.json) or a .cfproj and reports the DYNAMIC ARC: per-4-bar-block note density
// + active-layer count as ASCII sparklines, a "dynamic diversity" score, and
// flat-spot flags (where the arrangement doesn't breathe). Fast — no render.
//
//   node scripts/analyze-arrangement.mjs public/_songgen/foo.json
//   node scripts/analyze-arrangement.mjs content/Audio/*.cfproj

import { readFileSync } from 'node:fs'

function loadSpec(path) {
  const j = JSON.parse(readFileSync(path, 'utf8'))
  const dp = j._type === '100lights-project' ? j.dawProject : j
  const clipsSrc = dp.arrangementClips ?? dp.clips ?? []
  const trackName = id => (dp.tracks.find(t => t.id === id) || {}).name
  return {
    tempo: dp.tempo,
    clips: clipsSrc.map(c => ({ name: trackName(c.trackId), startBeat: c.startBeat, durationBeats: c.durationBeats, isDrum: !!c.isDrumClip, notes: c.notes || [] })),
  }
}

const SPARK = '▁▂▃▄▅▆▇█'
const spark = arr => { const mx = Math.max(...arr, 1); return arr.map(v => SPARK[Math.min(7, Math.round(v / mx * 7))]).join('') }

export function analyze(path) {
  const { tempo, clips } = loadSpec(path)
  const end = Math.max(0, ...clips.map(c => c.startBeat + c.durationBeats))
  const bars = Math.max(1, Math.ceil(end / 4))
  const density = new Array(bars).fill(0), layers = new Array(bars).fill(0), drumsOn = new Array(bars).fill(0)
  for (const c of clips) {
    for (let b = 0; b < bars; b++) {
      const a = b * 4, z = (b + 1) * 4
      const nIn = c.notes.filter(n => { const t = c.startBeat + n.startBeat; return t >= a && t < z }).length
      if (nIn) { density[b] += nIn; layers[b] += 1; if (c.isDrum) drumsOn[b] = 1 }
    }
  }
  const blocks = []
  for (let b = 0; b < bars; b += 4) {
    const seg = density.slice(b, b + 4), lseg = layers.slice(b, b + 4)
    blocks.push({ dens: seg.reduce((a, c) => a + c, 0), lay: Math.round(lseg.reduce((a, c) => a + c, 0) / Math.max(1, lseg.length)), drums: drumsOn.slice(b, b + 4).some(Boolean) })
  }
  const dens = blocks.map(x => x.dens)
  const mean = dens.reduce((a, c) => a + c, 0) / dens.length
  const cv = Math.sqrt(dens.reduce((a, c) => a + (c - mean) ** 2, 0) / dens.length) / (mean || 1)
  const laymax = Math.max(...blocks.map(x => x.lay)), laymin = Math.min(...blocks.map(x => x.lay))
  let flat = 1, maxflat = 1
  for (let i = 1; i < blocks.length; i++) { if (Math.abs(blocks[i].dens - blocks[i - 1].dens) <= mean * 0.18) flat++; else flat = 1; maxflat = Math.max(maxflat, flat) }
  const hasBreakdown = blocks.some(x => !x.drums)
  const flags = []
  if (cv < 0.35) flags.push('LOW dynamic variation — density barely changes; add a breakdown / bigger drop contrast')
  if (laymax - laymin < 2) flags.push('LAYER count barely changes — strip to fewer layers somewhere, or stack more at peaks')
  if (maxflat * 4 >= 16) flags.push(`FLAT stretch ~${maxflat * 4} bars of near-constant density — break it up (fill / drop-out / muffle)`)
  if (!hasBreakdown) flags.push('No true breakdown block (drums never drop out) — a moment of space makes drops hit harder')
  const score = Math.round(Math.max(0, Math.min(100, cv * 120 + (laymax - laymin) * 8 + (hasBreakdown ? 15 : 0))))
  return { path, tempo, bars, blocks, cv: +cv.toFixed(2), layRange: [laymin, laymax], maxFlatBars: maxflat * 4, score, flags }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const paths = process.argv.slice(2)
  if (!paths.length) { console.log('usage: node scripts/analyze-arrangement.mjs <spec.json | file.cfproj> ...'); process.exit(0) }
  for (const p of paths) {
    const r = analyze(p)
    console.log('\n' + p.split('/').pop())
    console.log(`  ${r.bars} bars @ ${r.tempo}bpm · density-CV ${r.cv} · layers ${r.layRange[0]}-${r.layRange[1]} · longest-flat ${r.maxFlatBars}bars · SCORE ${r.score}/100`)
    console.log('  density ' + spark(r.blocks.map(b => b.dens)))
    console.log('  layers  ' + spark(r.blocks.map(b => b.lay)))
    if (r.flags.length) r.flags.forEach(f => console.log('  ⚠ ' + f)); else console.log('  ✓ dynamic arrangement')
  }
}
