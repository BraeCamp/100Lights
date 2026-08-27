// Import an app TypeScript module from a plain Node script.
//
// Node can strip types (--experimental-strip-types) but it cannot resolve the
// app's import style: `from './roll-fx'` with no extension, and `from '@/lib/x'`
// with the bundler alias. Both are invisible to Node's ESM resolver.
//
// apollo-render.mjs and apollo-kit.mjs each solved this privately, and drifted:
// one of them special-cased a single file and broke the day that file grew a new
// alias import. This is the shared version — copy the module and everything it
// reaches into one temp ESM directory, rewriting both import forms, then import
// it once and cache it.
//
// The point of importing rather than transcribing is that the FX field table
// (neutral values, log/linear mapping, ranges) stays a SINGLE source of truth.
// A renderer that hardcodes its own copy of "low-pass is log from 40 to 18000"
// will quietly disagree with the app the first time someone edits that table.

import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs'
import { join, dirname, basename, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

let dir = null
const copied = new Set()
const cache = new Map()

function ensureDir() {
  if (dir) return dir
  dir = mkdtempSync(join(tmpdir(), 'l100-ts-'))
  // Without this every re-parsed .ts prints a MODULE_TYPELESS_PACKAGE_JSON
  // warning, which is several lines of noise in front of real output.
  writeFileSync(join(dir, 'package.json'), '{"type":"module"}')
  return dir
}

/** Copy `absPath` into the temp dir, rewriting its imports, recursively. */
function copyModule(absPath) {
  const name = basename(absPath)
  if (copied.has(name)) return name
  copied.add(name)
  let src = readFileSync(absPath, 'utf8')
  const here = dirname(absPath)
  const deps = []
  // `from '@/lib/foo'` → './foo.ts';  `from './bar'` → './bar.ts'
  src = src.replace(/(\bfrom\s+|import\s*\(\s*)'(@\/[^']+|\.\.?\/[^']+)'/g, (m, lead, spec) => {
    const target = spec.startsWith('@/') ? join(REPO, spec.slice(2)) : resolve(here, spec)
    const withExt = ['.ts', '.tsx', '.mjs', '.js'].map(e => target + e).find(existsSync)
      || (existsSync(target) ? target : null)
    if (!withExt) return m                       // a package import — leave it alone
    deps.push(withExt)
    return `${lead}'./${basename(withExt)}'`
  })
  for (const d of deps) copyModule(d)
  writeFileSync(join(ensureDir(), name), src)
  return name
}

/**
 * `await importTs('lib/roll-fx.ts')` → the module's exports.
 * Paths are relative to the repo root.
 */
export async function importTs(relPath) {
  if (cache.has(relPath)) return cache.get(relPath)
  const name = copyModule(join(REPO, relPath))
  const mod = await import(pathToFileURL(join(ensureDir(), name)).href)
  cache.set(relPath, mod)
  return mod
}
