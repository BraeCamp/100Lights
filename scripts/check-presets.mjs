#!/usr/bin/env node
// ── Preset validator ─────────────────────────────────────────────────────────
// Double-checks that every instrument preset the app + composer rely on actually
// resolves to real, seeded samples — so a track can never come out silent because
// a preset points at a folder nothing seeds, or the composer emits an id that
// isn't a real preset. Pure static cross-reference (no browser/render needed):
//
//   BUILT_IN (lib/midi-presets.ts, ids builtin-0..N)  ── each has a `folder`
//        │                                                     │
//        │  every folder must be seeded …                      ▼
//        └──────────────────────────────►  default-samples.ts `folder:` sources
//   compose.mjs `builtin-N` references  ──► must be a valid BUILT_IN index
//
//   node scripts/check-presets.mjs         (exit 1 if anything is broken)

import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8')

// ── BUILT_IN presets (ordered → builtin-N) from midi-presets.ts ───────────────
const mp = read('lib/midi-presets.ts')
const biRegion = mp.slice(mp.indexOf('const BUILT_IN'), mp.indexOf('// ── Helpers'))
const BUILT_IN = [...biRegion.matchAll(/\{\s*name:\s*['"]([^'"]+)['"][^}]*?folder:\s*['"]([^'"]+)['"]/g)]
  .map((m, i) => ({ id: `builtin-${i}`, i, name: m[1], folder: m[2] }))

// ── Real generation SOURCES in default-samples.ts ─────────────────────────────
// Synth/model folders (KEYBOARD_PRESETS: rendered from a `type`) and soundfont
// folders (SOUNDFONT_PACKS: loaded from a `url`). A folder that isn't in either
// has nothing generating its samples → any preset on it is silent.
const ds = read('lib/default-samples.ts')
const slice = (from, to) => ds.slice(ds.indexOf(from), to ? ds.indexOf(to) : undefined)
const kbRegion = slice('const KEYBOARD_PRESETS', 'const SOUNDFONT_PACKS')
const sfRegion = slice('const SOUNDFONT_PACKS', 'const REAL_SF_FOLDERS')
const synthFolders = new Set([...kbRegion.matchAll(/folder:\s*['"]([^'"]+)['"]/g)].map(m => m[1]))
const sfEntries = [...sfRegion.matchAll(/\{\s*name:\s*['"]([^'"]+)['"][^}]*?url:\s*([A-Za-z0-9_]+)[^}]*?folder:\s*['"]([^'"]+)['"]/gs)]
  .map(m => ({ name: m[1], urlVar: m[2], folder: m[3] }))
const sfFolders = new Set(sfEntries.map(e => e.folder))
// url consts must be defined and non-empty (a broken/empty URL = silent soundfont).
const urlDefined = (v) => new RegExp(`const ${v}\\s*=\\s*[\`'"]?\\S`).test(ds)
const seededFolders = new Set([...synthFolders, ...sfFolders])

// ── Preset ids the composer references (STYLE_PRESETS / LEAD_ALTS / hardcoded) ─
const comp = read('scripts/compose.mjs')
const composerIds = new Set([...comp.matchAll(/['"]builtin-(\d+)['"]/g)].map(m => Number(m[1])))

const problems = []
let nSynth = 0, nSf = 0

// 1 · every BUILT_IN preset's folder must have a real generation source
for (const p of BUILT_IN) {
  if (synthFolders.has(p.folder)) { nSynth++; continue }
  if (sfFolders.has(p.folder)) {
    nSf++
    const e = sfEntries.find(x => x.folder === p.folder)
    if (e && !urlDefined(e.urlVar)) problems.push(`preset ${p.id} "${p.name}" → soundfont url const ${e.urlVar} is missing/empty (silent)`)
    continue
  }
  problems.push(`preset ${p.id} "${p.name}" → folder "${p.folder}" has NO generation source (not in KEYBOARD_PRESETS or SOUNDFONT_PACKS) → silent`)
}
// 2 · every composer preset id must be a real BUILT_IN index
for (const n of [...composerIds].sort((a, b) => a - b)) {
  if (n < 0 || n >= BUILT_IN.length) problems.push(`compose.mjs references builtin-${n}, but only builtin-0..${BUILT_IN.length - 1} exist (track would fall back / be silent)`)
}

console.log(`Presets: ${BUILT_IN.length} built-in (${nSynth} synth-rendered · ${nSf} soundfont) · composer uses ${composerIds.size} distinct ids (max builtin-${Math.max(...composerIds)})`)
if (problems.length) {
  console.log(`\n✗ ${problems.length} problem(s):`)
  for (const p of problems) console.log('  · ' + p)
  process.exit(1)
} else {
  console.log('✓ every preset folder is seeded and every composer preset id is valid')
}
