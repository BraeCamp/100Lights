// Round-trip test for slimPatch/fatPatch.
//
// This decides how a track sounds: a value that silently reverts to its default
// on load is a wrong note, not a cosmetic bug. So every voice in the palette
// must come back byte-identical after being slimmed and re-expanded.
//
//   node --experimental-strip-types scripts/qa-patch-diff.mjs

import { readFileSync, writeFileSync, mkdtempSync } from 'fs'
import { join, dirname } from 'path'
import { tmpdir } from 'os'
import { fileURLToPath } from 'url'
import { VOICES } from './apollo-voices.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// patch-diff.ts uses the '@/' alias; load it from a temp dir with its deps.
const dir = mkdtempSync(join(tmpdir(), 'patchdiff-'))
writeFileSync(join(dir, 'package.json'), '{"type":"module"}')
const copy = (rel, name, subs = []) => {
  let src = readFileSync(join(ROOT, rel), 'utf8')
  for (const [a, b] of subs) src = src.replace(a, b)
  src = src.replace(/from '@\/([^']+)'/g, (_m, p) => `from './${p.split('/').pop()}.ts'`)
  writeFileSync(join(dir, name + '.ts'), src)
}
copy('lib/scale-constants.ts', 'scale-constants')
copy('lib/apollo/patch.ts', 'patch')
copy('lib/apollo/patch-diff.ts', 'patch-diff')
const { slimPatch, fatPatch } = await import('file://' + join(dir, 'patch-diff.ts'))

const stable = (o) => JSON.stringify(o, (_k, v) =>
  (v && typeof v === 'object' && !Array.isArray(v))
    ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]]))
    : v)

let fail = 0, fullTotal = 0, slimTotal = 0
console.log('voice           full      slim     saved   round-trip')
console.log('─'.repeat(58))
for (const [name, v] of Object.entries(VOICES)) {
  const patch = v.build()
  const slim = slimPatch(patch)
  const back = fatPatch(slim)
  const exact = stable(back) === stable(patch)
  if (!exact) fail++
  const full = JSON.stringify(patch).length, small = JSON.stringify(slim).length
  fullTotal += full; slimTotal += small
  console.log(`${name.padEnd(14)} ${(full / 1024).toFixed(1).padStart(6)}KB ${(small / 1024).toFixed(1).padStart(7)}KB ` +
    `${String(Math.round((1 - small / full) * 100)).padStart(6)}%   ${exact ? 'exact' : '*** DIFFERS ***'}`)
}
console.log('─'.repeat(58))
console.log(`total          ${(fullTotal / 1024).toFixed(1)}KB -> ${(slimTotal / 1024).toFixed(1)}KB ` +
  `(${Math.round((1 - slimTotal / fullTotal) * 100)}% smaller)`)

// A full patch must survive fatPatch untouched, so old projects still load.
const one = Object.values(VOICES)[0].build()
console.log(stable(fatPatch(one)) === stable(one)
  ? 'PASS a full (already-expanded) patch passes through unchanged'
  : 'FAIL a full patch was altered by fatPatch')

console.log(fail === 0 ? '\nPASS every voice round-trips exactly' : `\nFAIL ${fail} voice(s) did not round-trip`)
process.exit(fail === 0 ? 0 : 1)
