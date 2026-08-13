#!/usr/bin/env node
// Build a mean CLAP embedding (centroid) per genre family from the embedded corpus (track_embeddings).
// Nearest-centroid on these is a far better genre classifier than hand-tuned thresholds — used for
// broadcast per-track looks and to sanity-check the DSP classifier. Writes lib/genre-centroids.json
// ({ family: [512 floats] }, unit-normalized). Also prints how cleanly the families separate.
//
//   node scripts/build-genre-centroids.mjs
import { neon } from '@neondatabase/serverless'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tagsToFamily, FAMILIES } from '../lib/genre-map.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const env = n => (process.env[n] || (readFileSync(join(ROOT, '.env.local'), 'utf8').match(new RegExp(`^\\s*${n}\\s*=\\s*(.+)\\s*$`, 'm'))?.[1] || '')).trim().replace(/^["']|["']$/g, '')
const sql = neon(env('DATABASE_URL'))

const rows = await sql`SELECT id, tags, embedding::text e FROM track_embeddings WHERE embedding IS NOT NULL`
const parse = s => s.replace(/[[\]]/g, '').split(',').map(Number)
const norm = v => { const n = Math.hypot(...v) || 1; return v.map(x => x / n) }
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0)

// group vectors by family
const groups = {}
let labeled = 0
for (const r of rows) {
  const fam = tagsToFamily(r.tags)
  if (!fam) continue
  labeled++
  ;(groups[fam] ||= []).push(parse(r.e))
}

const centroids = {}
for (const fam of FAMILIES) {
  const vs = groups[fam]
  if (!vs?.length) { console.log(`  ${fam.padEnd(14)} — 0 tracks (skipped)`); continue }
  const dim = vs[0].length
  const mean = new Array(dim).fill(0)
  for (const v of vs) for (let i = 0; i < dim; i++) mean[i] += v[i]
  centroids[fam] = norm(mean.map(x => x / vs.length))
  console.log(`  ${fam.padEnd(14)} — ${vs.length} tracks`)
}

// separation report: nearest-centroid accuracy on the labeled tracks (how distinct the families are)
let correct = 0, total = 0
const confusion = {}
for (const r of rows) {
  const truth = tagsToFamily(r.tags); if (!truth || !centroids[truth]) continue
  const v = norm(parse(r.e))
  let best = null, bs = -2
  for (const f of FAMILIES) if (centroids[f]) { const s = dot(v, centroids[f]); if (s > bs) { bs = s; best = f } }
  total++; if (best === truth) correct++
  ;(confusion[truth] ||= {})[best] = ((confusion[truth] || {})[best] || 0) + 1
}

writeFileSync(join(ROOT, 'lib', 'genre-centroids.json'), JSON.stringify(centroids))
console.log(`\nLabeled ${labeled}/${rows.length} tracks. Nearest-centroid self-accuracy: ${(100 * correct / total).toFixed(1)}% (${correct}/${total}).`)
console.log('Wrote lib/genre-centroids.json')
process.exit(0)
