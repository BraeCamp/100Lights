// Sound-design kit for building Apollo patches in Node and auditioning them
// through the real engine.
//
// Brae asked for two songs whose sounds are made ONLY in Apollo — no sampled
// presets, no drum packs. That means every voice, drums included, is a Helios
// patch authored as data. This module is the workbench: it loads the patch
// schema, gives small builders for the fiddly bits (mod routes, FX units,
// wavetables), and renders a patch through scripts/apollo-render.mjs so a voice
// can be measured instead of guessed at.
//
// Two facts shape everything here:
//   • Apollo's noise slot needs a SAMPLE (engine.js only reads it when
//     noise.sampleId is set), and a sample is not a sound made in Apollo. So
//     noise is synthesised as a user WAVETABLE, which travels inside the patch.
//   • A mod route's contribution is `value * amount * span`, where span is the
//     destination's full range. osc0.semi spans -36..36, so amount 0.25 is
//     ~18 semitones — that is how a kick gets its pitch drop.

import { readFileSync, writeFileSync, mkdtempSync } from 'fs'
import { join, dirname } from 'path'
import { tmpdir } from 'os'
import { execFileSync } from 'child_process'
import { fileURLToPath } from 'url'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// ── Loading the schema ──────────────────────────────────────────────────────
// patch.ts uses the app's '@/' alias, which Node cannot resolve; rewrite it to
// an absolute file URL in a temp copy (the same trick apollo-render.mjs uses).
let _mod = null
export async function loadApollo() {
  if (_mod) return _mod
  const dir = mkdtempSync(join(tmpdir(), 'apollo-kit-'))
  // A package.json marking the temp dir as ESM: without it Node prints a
  // MODULE_TYPELESS_PACKAGE_JSON warning for every .ts it reparses, which buried
  // the actual output of every single render.
  writeFileSync(join(dir, 'package.json'), '{"type":"module"}')
  // Copy the aliased dependency in alongside, so it is covered by that same
  // package.json rather than being imported from the repo by absolute path.
  const deps = new Map()
  let src = readFileSync(join(ROOT, 'lib/apollo/patch.ts'), 'utf8')
    .replace(/from '@\/([^']+)'/g, (_m, p) => {
      const base = p.split('/').pop()
      deps.set(base, join(ROOT, p + '.ts'))
      return `from './${base}.ts'`
    })
  for (const [base, from] of deps) writeFileSync(join(dir, base + '.ts'), readFileSync(from, 'utf8'))
  const file = join(dir, 'patch.ts')
  writeFileSync(file, src)
  const patch = await import('file://' + file)
  writeFileSync(join(dir, 'tables.ts'), readFileSync(join(ROOT, 'lib/apollo/tables.ts'), 'utf8'))
  const tables = await import('file://' + join(dir, 'tables.ts'))
  _mod = { ...patch, tableToBase64: tables.tableToBase64 }
  return _mod
}

/**
 * Worst-case oscillator voices this patch spends on ONE note. Unison multiplies,
 * so a chord costs this times the number of notes held.
 *
 * Worth checking before committing to an arrangement: a pad on unison 7 + 5 is
 * 48 voices for a four-note chord, and eight tracks of that overloads the audio
 * thread badly enough that a real-time bounce stops finishing at all.
 */
export function voiceCost(patch) {
  let n = 0
  for (const o of patch.oscs ?? []) if (o.enabled) n += Math.max(1, o.unison || 1)
  if (patch.sub?.enabled) n += 1
  if (patch.noise?.enabled) n += 1
  return n
}

/** Per-note cost of a whole palette, loudest offenders first. */
export function voiceReport(named) {
  return Object.entries(named)
    .map(([name, p]) => ({ name, cost: voiceCost(p) }))
    .sort((a, b) => b.cost - a.cost)
}

// ── Builders ────────────────────────────────────────────────────────────────
let _id = 0
export const uid = () => `k${(_id++).toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`

/** A modulation route. `amount` is a fraction of the destination's FULL span. */
export const mod = (source, dest, amount, opts = {}) => ({
  id: uid(), source, dest, amount, bipolar: opts.bipolar ?? false,
  aux: opts.aux ?? 'none', auxAmount: opts.auxAmount ?? 0,
  curve: opts.curve ?? null, bypass: false,
})

/** An FX unit with its defaults filled in, overridden by `params`. */
export function fxUnit(FX_DEFS, type, params = {}, opts = {}) {
  const def = FX_DEFS[type]
  if (!def) throw new Error(`unknown fx type: ${type}`)
  const base = Object.fromEntries(def.params.map(p => [p.key, p.default]))
  for (const k of Object.keys(params)) {
    if (!(k in base)) throw new Error(`fx ${type}: no param "${k}" (have: ${Object.keys(base).join(', ')})`)
  }
  return {
    id: uid(), type, enabled: true,
    mix: opts.mix ?? (type === 'reverb' || type === 'convolve' || type === 'delay' || type === 'echobode' ? 0.3 : 1),
    params: { ...base, ...params },
  }
}

/** Deterministic RNG so a patch renders identically every time. */
export function rng(seed = 1) {
  let s = seed >>> 0
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
}

const WT_LEN = 2048

/**
 * A user wavetable built frame by frame. `fn(phase, frameIndex, frameCount)`
 * returns a sample in -1..1. Frames are normalised per frame by the engine's
 * loader, so relative level across frames is not preserved — shape is.
 */
export function userTable(tableToBase64, name, frames, fn) {
  const data = new Float32Array(frames * WT_LEN)
  for (let f = 0; f < frames; f++) {
    for (let i = 0; i < WT_LEN; i++) data[f * WT_LEN + i] = Math.max(-1, Math.min(1, fn(i / WT_LEN, f, frames)))
  }
  return { name, frames, data: tableToBase64(data) }
}

/** Noise as a wavetable: every frame is a different block of white noise, so
 *  sweeping wt.pos across frames keeps successive cycles from repeating — a
 *  single frame read at pitch would be a periodic buzz, not noise. */
export function noiseTable(tableToBase64, seed = 7, frames = 64) {
  const rand = rng(seed)
  return userTable(tableToBase64, 'Noise', frames, () => rand() * 2 - 1)
}

// ── Rendering / measuring ───────────────────────────────────────────────────
/**
 * Render a patch through the real engine and return its stats.
 * notes: "note:start:dur[:vel]" comma-separated, seconds.
 */
export function render(patch, { notes = '60:0:1', seconds = 2, out = null, bpm = 120 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'apollo-render-'))
  const pf = join(dir, 'patch.json')
  writeFileSync(pf, JSON.stringify(patch))
  // apollo-render takes space-separated flag values, not --flag=value.
  const args = ['--experimental-strip-types', 'scripts/apollo-render.mjs',
    '--patch', pf, '--notes', notes, '--seconds', String(seconds), '--bpm', String(bpm), '--json']
  if (out) args.push('--out', out)
  const raw = execFileSync('node', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 })
  const line = raw.trim().split('\n').filter(l => l.trim().startsWith('{')).pop()
  if (!line) throw new Error('no JSON stats from apollo-render:\n' + raw.slice(0, 500))
  return JSON.parse(line)
}

/** One-line summary of a rendered voice, for eyeballing a palette at a glance. */
export const describe = (name, s) =>
  `${name.padEnd(14)} peak ${String(s.peak ?? 0).padStart(6)}  rms ${String(s.rmsDb ?? 0).padStart(7)}dB  ` +
  `centroid ${String(Math.round(s.centroidHz ?? 0)).padStart(5)}Hz  ` +
  `dur ${((s.soundEnd ?? 0) - (s.soundStart ?? 0)).toFixed(3)}s${s.silent ? '  ** SILENT **' : ''}`
