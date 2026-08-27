#!/usr/bin/env node
// What pitch does each AI-instrument root ACTUALLY sound?
//
// The roots in public/ai-instruments/*.js are keyed by note name, and several of
// those names are wrong — not slightly, but by an octave or more:
//
//   grand-piano     C2 sounds at 48 (+12)   G2 at 64 (+21)   A2 at 64 (+19)
//   electric-guitar G2 sounds at 54 (+11)   A2 at 56 (+11)
//   synth-bass      D3 sounds at 62 (+12)
//   fretless-bass   E2 sounds at 41 (+1)
//
// A multisample built on the names maps those zones to the wrong root, so every
// note drawn from them comes out at the wrong pitch. It is not subtly wrong and
// it is not detectable by looking — the file says C2.
//
// So the zone map is built from what the audio DOES, not what it is called. This
// measures once and writes the table; sampled-voices.mjs reads it.
//
//   node --experimental-strip-types scripts/build-ai-tuning.mjs

import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readWav } from './lib/offline-dsp.mjs'
import { pitchAt } from './lib/audio-features.mjs'
import { AI_INSTRUMENTS, aiRootsRaw, resolveSample, noteToMidi } from './lib/samples.mjs'

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), 'ai-instrument-tuning.json')

/** Sounding span, so a short root is measured where it actually plays. */
function span(mono, sr) {
  let peak = 0
  for (const v of mono) peak = Math.max(peak, Math.abs(v))
  if (peak < 1e-4) return null
  let a = 0, b = mono.length - 1
  while (a < mono.length && Math.abs(mono[a]) < peak * 0.05) a++
  while (b > a && Math.abs(mono[b]) < peak * 0.05) b--
  return { a, b, dur: (b - a) / sr, peak }
}

const table = {}
let flagged = 0
for (const inst of AI_INSTRUMENTS) {
  table[inst] = []
  for (const r of aiRootsRaw(inst)) {
    const w = readWav(readFileSync(resolveSample(r.id)))
    const mono = Float32Array.from(w.l, (v, i) => (v + (w.r?.[i] ?? v)) * 0.5)
    const s = span(mono, w.sr)
    if (!s) { console.log(`  ${inst} ${r.note}: SILENT — dropped`); continue }
    // Probe the SUSTAIN, not the attack. A plucked or struck attack is
    // inharmonic noise: on the guitar's D3 root a probe 15% in reads 43.08 at
    // confidence 0.02, while the same file 50% in reads 50.04 at 0.41. Three
    // points through the body, median taken; a root whose reads disagree is one
    // that should not anchor a zone.
    const reads = [0.4, 0.55, 0.7]
      .map(f => pitchAt(mono, w.sr, (s.a + (s.b - s.a) * f) / w.sr, 0.18, { loMidi: 20, hiMidi: 100 }))
      .filter(Boolean)
    if (!reads.length) { console.log(`  ${inst} ${r.note}: unmeasurable — dropped`); continue }
    const midis = reads.map(x => x.midi).sort((a, b) => a - b)
    const median = midis[Math.floor(midis.length / 2)]
    const spread = midis[midis.length - 1] - midis[0]
    const declared = noteToMidi(r.note)
    const offset = median - declared
    if (Math.abs(offset) > 0.6) flagged++
    table[inst].push({
      note: r.note,
      declared,
      sounds: +median.toFixed(2),
      rootKey: Math.round(median),
      offsetSemis: +offset.toFixed(2),
      spread: +spread.toFixed(2),
      durSec: +s.dur.toFixed(2),
      confidence: +Math.max(...reads.map(x => x.confidence)).toFixed(2),
    })
    const mark = Math.abs(offset) > 0.6 ? '  MISLABELLED' : spread > 0.5 ? '  unstable' : ''
    console.log(`  ${inst.padEnd(16)} ${r.note.padEnd(4)} says ${String(declared).padStart(3)}` +
      `  sounds ${median.toFixed(2).padStart(6)}  (${offset >= 0 ? '+' : ''}${offset.toFixed(2)} st)` +
      `  ${s.dur.toFixed(2)}s${mark}`)
  }
}

writeFileSync(OUT, JSON.stringify(table, null, 2) + '\n')
console.log(`\n${flagged} root(s) sound at a different pitch than their name.`)
console.log(`→ ${OUT}`)
