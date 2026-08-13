#!/usr/bin/env node
// Calibrate Lightning Bug's DSP genre classifier (classifySonic) against real genre labels.
// Pulls a stratified sample from the embedded corpus (track_embeddings, labelled by tagsToFamily),
// extracts rough DSP features offline (scripts/dsp-features.py / librosa), percentile-normalizes them
// to the browser's ~0-1 ranges, then runs the classifier and prints a confusion matrix + per-family
// feature means. Use the means to place thresholds; re-run to see the accuracy move.
//
//   node scripts/calibrate-classifier.mjs [--per 30]
import { neon } from '@neondatabase/serverless'
import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline'
import { tagsToFamily, FAMILIES } from '../lib/genre-map.ts'
import { classifyFamily } from '../lib/classify-core.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const env = n => (process.env[n] || (readFileSync(join(ROOT, '.env.local'), 'utf8').match(new RegExp(`^\\s*${n}\\s*=\\s*(.+)\\s*$`, 'm'))?.[1] || '')).trim().replace(/^["']|["']$/g, '')
const sql = neon(env('DATABASE_URL'))
const PY = join(ROOT, '.venv-clap', 'bin', 'python')
if (!existsSync(PY)) { console.error('✗ CLAP venv missing — run npm run clap:setup'); process.exit(1) }

const args = process.argv.slice(2)
const per = Number((args.includes('--per') ? args[args.indexOf('--per') + 1] : '') || 30)

// --- stratified sample ---
const rows = await sql`SELECT id, audio, tags FROM track_embeddings WHERE embedding IS NOT NULL`
const byFam = {}
for (const r of rows) { const f = tagsToFamily(r.tags); if (f) (byFam[f] ||= []).push(r) }
const sample = []
for (const f of FAMILIES) (byFam[f] || []).slice(0, per).forEach(r => sample.push({ ...r, family: f }))
console.log(`Sampling ${sample.length} tracks (${per}/family) for feature extraction…\n`)

// --- extract features via python child ---
const py = spawn(PY, [join(ROOT, 'scripts', 'dsp-features.py')], { stdio: ['pipe', 'pipe', 'inherit'] })
const rl = createInterface({ input: py.stdout })
const feats = new Map()
// Feature cache — audio decode + librosa is the slow part; only extract tracks we haven't seen so
// re-running after a threshold tweak is instant. (.calib-cache.json is gitignored.)
const CACHE = join(ROOT, '.calib-cache.json')
const cache = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf8')) : {}
for (const s of sample) if (cache[s.id]) feats.set(s.id, cache[s.id])
const todo = sample.filter(s => !feats.has(s.id))
console.log(`  ${sample.length - todo.length} cached, extracting ${todo.length}…`)
let pending = todo.length
const done = new Promise(res => {
  if (!pending) return res()
  rl.on('line', line => {
    let m; try { m = JSON.parse(line) } catch { return }
    if (m && m.id) { feats.set(m.id, m); cache[m.id] = m }
    if (--pending <= 0) res()
  })
})
for (const s of todo) py.stdin.write(JSON.stringify({ id: s.id, url: s.audio }) + '\n')
py.stdin.end()
await done
writeFileSync(CACHE, JSON.stringify(cache))

// --- percentile-normalize energy/density/beaty/bass/bright to 0-1 (bpm kept absolute) ---
const rowsF = sample.map(s => ({ ...s, f: feats.get(s.id) })).filter(x => x.f && !x.f.err)
const cols = { energy: 'rms', bass: 'bass', bright: 'bright', density: 'flux', beaty: 'pulse' }
const ranks = {}
for (const [key, src] of Object.entries(cols)) {
  const vals = rowsF.map(r => r.f[src]).slice().sort((a, b) => a - b)
  ranks[key] = v => { let lo = 0, hi = vals.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (vals[mid] < v) lo = mid + 1; else hi = mid } return vals.length ? lo / vals.length : 0 }
}
const norm = f => ({ bpm: f.bpm, energy: ranks.energy(f.rms), bass: ranks.bass(f.bass), bright: ranks.bright(f.bright), density: ranks.density(f.flux), beaty: ranks.beaty(f.pulse) })

// --- run classifier + build confusion ---
const confusion = {}, seen = {}
let correct = 0
for (const r of rowsF) {
  const n = norm(r.f)
  const pred = classifyFamily(n).family
  ;(confusion[r.family] ||= {})[pred] = ((confusion[r.family] || {})[pred] || 0) + 1
  seen[r.family] = (seen[r.family] || 0) + 1
  if (pred === r.family) correct++
}

// --- report ---
console.log('\nPer-family normalized feature means (energy / bass / bright / density / beaty / bpm):')
for (const f of FAMILIES) {
  const rs = rowsF.filter(r => r.family === f); if (!rs.length) continue
  const avg = k => (rs.reduce((s, r) => s + norm(r.f)[k], 0) / rs.length)
  console.log(`  ${f.padEnd(14)} e=${avg('energy').toFixed(2)} ba=${avg('bass').toFixed(2)} br=${avg('bright').toFixed(2)} d=${avg('density').toFixed(2)} be=${avg('beaty').toFixed(2)} bpm=${(rs.reduce((s, r) => s + r.f.bpm, 0) / rs.length).toFixed(0)}`)
}
console.log('\nConfusion (row = true genre, cell = predicted count):')
const head = FAMILIES.map(f => f.slice(0, 4).padStart(5)).join('')
console.log(''.padEnd(14) + head)
for (const f of FAMILIES) {
  if (!seen[f]) continue
  console.log(f.padEnd(14) + FAMILIES.map(p => String((confusion[f] || {})[p] || 0).padStart(5)).join('') + `   (${((confusion[f]?.[f] || 0) / seen[f] * 100).toFixed(0)}%)`)
}
console.log(`\nOverall DSP accuracy vs genre tags: ${(100 * correct / rowsF.length).toFixed(1)}% (${correct}/${rowsF.length}), chance ≈ ${(100 / FAMILIES.length).toFixed(0)}%`)
process.exit(0)
