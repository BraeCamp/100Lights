#!/usr/bin/env node --experimental-strip-types
// What can Apollo actually DO, headlessly, right now?
//
// The palette we had used three wavetables, two filter types and four effects.
// Apollo has eighteen warp modes, seven spectral warps, thirty-odd filters,
// twenty-three effects, five unison modes, ten LFOs with chaos, and an arp —
// and there was no way to know which of them survive a Node render short of
// trying each one and listening, which is the thing I cannot do.
//
// So: render one fixed note through each feature, measure it, and compare with
// an unmodified baseline. Three outcomes matter and they look identical from the
// outside without this:
//
//   WORKS      the sound changed
//   NO EFFECT  it rendered, but measured identical to baseline — the parameter
//              is either inert headless or needs something else switched on
//   SILENT     it killed the sound (the failure mode this project keeps hitting)
//
// Run it after touching the engine, and before reaching for a feature in a song.
//
//   node --experimental-strip-types scripts/apollo-probe.mjs [--only=filter] [--json]

import { writeFileSync, readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { tmpdir, cpus } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { readWav } from './lib/offline-dsp.mjs'
import { spectralProfile, levels } from './lib/audio-features.mjs'
import { loadApollo, fxUnit, mod } from './apollo-kit.mjs'

const run = promisify(execFile)
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const only = argv.find(a => a.startsWith('--only='))?.split('=')[1]
const asJson = argv.includes('--json')

const A = await loadApollo()
const { initPatch, FX_DEFS, FILTER_TYPES, WARP_MODES } = A

/** A deliberately plain patch: a saw, an open filter, a flat envelope. Anything
 *  that changes the measurement is the feature under test and nothing else. */
function base() {
  const p = initPatch()
  p.global.masterGain = 0.8
  Object.assign(p.oscs[0], { enabled: true, level: 0.9, unison: 1 })
  p.oscs[0].wt.tableId = 'analog-saws'
  p.oscs[0].wt.pos = 0.4
  Object.assign(p.envs[0], { attack: 0.005, decay: 0.4, sustain: 0.85, release: 0.2 })
  Object.assign(p.filters[0], { enabled: true, type: 'lp24', cutoff: 0.75, res: 0.1 })
  return p
}

const NOTE = '52:0:1.6'      // E3 — low enough to have harmonics, high enough to hear them
const SECONDS = 2.2

const tmp = mkdtempSync(join(tmpdir(), 'apollo-probe-'))
let n = 0

async function measure(patch, label) {
  const id = n++
  const pf = join(tmp, `p${id}.json`), wf = join(tmp, `o${id}.wav`)
  writeFileSync(pf, JSON.stringify(patch))
  try {
    await run('node', ['--experimental-strip-types', join(ROOT, 'scripts/apollo-render.mjs'),
      '--patch', pf, '--notes', NOTE, '--seconds', String(SECONDS), '--out', wf, '--json'],
      { cwd: ROOT, maxBuffer: 1 << 26 })
  } catch (e) {
    return { label, error: String(e.stderr || e.message).split('\n').filter(Boolean).pop()?.slice(0, 60) }
  }
  const w = readWav(readFileSync(wf))
  const lv = levels(w.l, w.r)
  const mono = Float32Array.from(w.l, (v, i) => (v + w.r[i]) * 0.5)
  const sp = spectralProfile(mono, w.sr)
  return { label, peak: lv.peak, rmsDb: lv.rmsDb, centroidHz: sp.centroidHz, corr: null, bands: sp.bands }
}

// ── The feature list ────────────────────────────────────────────────────────
const cases = []
const add = (group, label, fn) => cases.push({ group, label, fn })

for (const w of WARP_MODES.map(x => x.id).filter(x => x !== 'off')) {
  add('warp', w, () => { const p = base(); p.oscs[0].wt.warp1 = { mode: w, amount: 0.75 }; return p })
}
for (const sw of ['stretch', 'shift', 'smear', 'lowpass', 'evenodd', 'inharm']) {
  // `wt.specWarp`, singular and optional. Written as specWarp1 the first time,
  // which the engine simply never reads — all seven read "no effect", which
  // looks exactly like an unimplemented feature.
  add('specwarp', sw, () => { const p = base(); p.oscs[0].wt.specWarp = { mode: sw, amount: 0.8 }; return p })
}
for (const ft of FILTER_TYPES.map(x => x.id)) {
  add('filter', ft, () => { const p = base(); Object.assign(p.filters[0], { type: ft, cutoff: 0.5, res: 0.45, fat: 0.6, drive: 0.2 }); return p })
}
// Effects have to be pushed off their NEUTRAL defaults or the probe is only
// asking "does a bypassed effect do nothing", which it correctly does. An EQ
// ships flat, a gate ships open, a transient shaper ships at 0 dB; testing those
// as-is reported six working effects as dead.
const FX_PUSH = {
  eq: { g1: 12, g2: -12 },
  utility: { gain: -6, width: 1.8 },
  bitcrush: { bits: 3, downsample: 16 },
  noisegate: { threshold: -6, reduction: 60 },
  deesser: { threshold: -45, reduction: 24 },
  transientshaper: { attack: 10, sustain: -8 },
  compressor: { threshold: -30, ratio: 8 },
  octaver: { sub: 0.8 },
}
for (const fx of Object.keys(FX_DEFS)) {
  add('fx', fx, () => {
    const p = base()
    const push = {}
    const valid = new Set((FX_DEFS[fx]?.params ?? []).map(x => x.key))
    for (const [k, v] of Object.entries(FX_PUSH[fx] ?? {})) if (valid.has(k)) push[k] = v
    const unit = fxUnit(FX_DEFS, fx, push, { mix: 1 })
    // A splitter is a passthrough until its child chains hold something.
    if (fx.startsWith('split')) unit.chains = [[fxUnit(FX_DEFS, 'distortion', { drive: 0.9 }, { mix: 1 })], []]
    p.fxMain.push(unit)
    return p
  })
}
for (const um of ['classic', 'harmonic', 'ratio', 'semitone', 'step']) {
  add('unison', um, () => { const p = base(); Object.assign(p.oscs[0], { unison: 4, detune: 0.4, unisonMode: um }); return p })
}
for (const ct of ['lorenz', 'rossler', 'sh']) {
  add('lfo-chaos', ct, () => {
    const p = base()
    p.lfos[0] = { ...p.lfos[0], mode: 'chaos', chaosType: ct, rate: 6, sync: false }
    p.matrix.push(mod('lfo1', 'f1.cutoff', 0.5, { bipolar: true }))
    return p
  })
}
for (const src of ['vel', 'note', 'rand', 'gate', 'follower', 'env2', 'macro1']) {
  add('modsource', src, () => {
    const p = base()
    // patch.macros, top level — not global.macros, which the engine never reads.
    if (src === 'macro1') p.macros = [0.9, 0, 0, 0, 0, 0, 0, 0]
    p.matrix.push(mod(src, 'f1.cutoff', 0.6, { bipolar: false }))
    return p
  })
}
for (const m of ['up', 'down', 'updown', 'random', 'pattern']) {
  add('arp', m, () => {
    const p = base()
    p.arp = { ...p.arp, on: true, mode: m, octaves: 2, syncRate: 7, gate: 0.7 }
    return p
  })
}
add('sub', 'sub-osc', () => { const p = base(); p.sub = { ...p.sub, enabled: true, level: 0.7, octave: -1, shape: 'sine' }; return p })
add('routing', 'parallel-filters', () => {
  const p = base()
  p.filterRouting = 'parallel'
  Object.assign(p.filters[1], { enabled: true, type: 'hp12', cutoff: 0.4, res: 0.3 })
  p.oscs[0].dest = 'both'; p.oscs[0].filterBal = 0.5
  return p
})
add('routing', 'bus1-fx', () => {
  const p = base()
  // In SERIAL routing the last enabled FILTER decides the bus, not the osc —
  // setting only osc.bus sends nothing and the bus chain runs on silence.
  p.oscs[0].bus = 'bus1'
  p.filters[0].bus = 'bus1'
  p.bus1Return = 1
  p.fxBus1.push(fxUnit(FX_DEFS, 'distortion', { drive: 0.9 }, { mix: 1 }))
  return p
})
add('routing', 'fm-warp-with-modulator', () => {
  // The fm/am/rm warps modulate using ANOTHER oscillator (wt.fmSource). With
  // only osc A enabled there is no modulator, which is why 'fm' read as dead.
  const p = base()
  Object.assign(p.oscs[1], { enabled: true, level: 0.6, octave: 1 })
  p.oscs[1].wt.tableId = 'basic-shapes'
  p.oscs[0].wt.fmSource = 1
  p.oscs[0].wt.warp1 = { mode: 'fm', amount: 0.8 }
  return p
})

// ── Run ─────────────────────────────────────────────────────────────────────
const baseline = await measure(base(), 'BASELINE')
const list = cases.filter(c => !only || c.group.includes(only) || c.label.includes(only))
const results = []
{
  let next = 0
  const jobs = Math.max(1, Math.min(cpus().length - 1, 8))
  await Promise.all(Array.from({ length: jobs }, async () => {
    for (;;) {
      const i = next++
      if (i >= list.length) return
      const c = list[i]
      let patch
      try { patch = c.fn() } catch (e) { results[i] = { ...c, error: e.message.slice(0, 60) }; continue }
      results[i] = { ...c, ...(await measure(patch, c.label)) }
    }
  }))
}

// A feature "works" if it moved the sound. Comparing centroid AND level catches
// both timbral and dynamic changes; a few percent is noise, not an effect.
function verdict(r) {
  if (r.error) return ['ERROR', r.error]
  if (!r.peak || r.peak < 0.0005) return ['SILENT', 'killed the sound']
  const dCent = Math.abs(r.centroidHz - baseline.centroidHz) / Math.max(1, baseline.centroidHz)
  const dRms = Math.abs(r.rmsDb - baseline.rmsDb)
  if (dCent < 0.02 && dRms < 0.3) return ['no effect', '']
  const bits = []
  if (dCent >= 0.02) bits.push(`centroid ${baseline.centroidHz}→${r.centroidHz}Hz`)
  if (dRms >= 0.3) bits.push(`${r.rmsDb > baseline.rmsDb ? '+' : ''}${(r.rmsDb - baseline.rmsDb).toFixed(1)}dB`)
  return ['works', bits.join(', ')]
}

rmSync(tmp, { recursive: true, force: true })

if (asJson) {
  console.log(JSON.stringify({ baseline, results: results.map(r => ({ ...r, fn: undefined, verdict: verdict(r)[0] })) }, null, 2))
  process.exit(0)
}

console.log(`\nbaseline: peak ${baseline.peak}  rms ${baseline.rmsDb}dB  centroid ${baseline.centroidHz}Hz\n`)
let group = null
const broken = []
for (const r of results) {
  if (r.group !== group) { group = r.group; console.log(`── ${group} ${'─'.repeat(Math.max(0, 60 - group.length))}`) }
  const [v, detail] = verdict(r)
  if (v === 'SILENT' || v === 'ERROR') broken.push(`${r.group}/${r.label}: ${v}`)
  const mark = v === 'works' ? '  ' : v === 'no effect' ? '· ' : '**'
  console.log(`${mark}${r.label.padEnd(18)}${v.padEnd(10)}${detail}`)
}
console.log(`\n${results.filter(r => verdict(r)[0] === 'works').length}/${results.length} features change the sound headlessly`)
if (broken.length) { console.log(`\nDO NOT USE in an offline-rendered song:`); for (const b of broken) console.log(`  ${b}`) }
console.log('')
