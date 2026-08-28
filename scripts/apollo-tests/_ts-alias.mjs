// Teach Node the app's '@/' path alias.
//
// Loaded with --import, before anything else, by the test:apollo scripts that
// import the app's TypeScript directly:
//
//   node --experimental-strip-types --import ./scripts/apollo-tests/_ts-alias.mjs …
//
// ── Why ────────────────────────────────────────────────────────────────────
//
// fx-audit and completion-audit do `await import('../../lib/apollo/patch.ts')`.
// Node can strip the types, but the alias in that file —
//
//   import { SCALE_INTERVALS } from '@/lib/scale-constants'
//
// — is meaningless to it, and the whole suite dies with "Cannot find package
// '@/lib'". That import arrived in patch.ts on 2026-08-23 and CI has been red
// on every commit since; scripts/apollo-render.mjs was taught to cope at the
// time (it rewrites the source into a temp copy) and these two were missed.
//
// A resolver hook is used rather than that temp-copy trick because it is the
// same fix for every alias in every file, and because a temp copy of a module
// is a SECOND instance of it — apollo-render.mjs carries a long comment about
// keeping exactly one copy of patch.ts so presets.ts shares its uid().
//
// The alternative — relativising the import in patch.ts — was not taken: Node
// needs a file extension on a relative specifier, and `from './x.ts'` is a
// TypeScript error unless allowImportingTsExtensions is on, which is a
// tsconfig change affecting the whole app to satisfy two test scripts.

import { registerHooks } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

// '@/lib/scale-constants' could be any of these on disk. Try them in the order
// the bundler would, and hand back the first that exists.
const SUFFIXES = ['.ts', '.tsx', '.mjs', '.js', '/index.ts', '/index.tsx', '']

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!specifier.startsWith('@/')) return nextResolve(specifier, context)
    const base = join(ROOT, specifier.slice(2))
    for (const suffix of SUFFIXES) {
      const candidate = base + suffix
      if (existsSync(candidate)) {
        return { url: pathToFileURL(candidate).href, shortCircuit: true }
      }
    }
    // Fall through rather than inventing a path: an unresolvable alias should
    // report the real specifier, not a file that was never there.
    return nextResolve(specifier, context)
  },
})
