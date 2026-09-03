#!/usr/bin/env node
// Two layers of tags: everybody's, and yours.
//
//   node --experimental-strip-types scripts/apollo-tests/user-tags.test.mjs
//
// Brae: "Saved items should copy the url into the individual user library and
// allow editing tags. These user specific tag edits are only for the user.
// Universal tags remain only changeable in the admin page."
//
// ⚠️ THE TWO MUST NOT SHARE A FIELD, and the reason is a refresh. A catalog
// sound's `tags` belong to everybody and are re-read from the catalog whenever
// an admin edits them — so anything a user wrote there would be overwritten,
// silently and much later, which is the worst way for an edit to disappear.

import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { importTs } from '../lib/ts-import.mjs'

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

const { tagsOf } = await importTs('lib/sound-tags.ts')

// ── both layers are read, wherever tags are read ───────────────────────────
{
  const both = tagsOf({ name: 'Hall Pad', category: 'instrument', tags: ['Dark'], userTags: ['verse 2'] })
  check('a shared tag is read', both.includes('Dark'), both.join(', '))
  check('and so is a personal one', both.includes('verse 2'), both.join(', '))
  // Yours first: they are the words you chose for your own library, and they
  // are what you will look for.
  check('with yours in front', both.indexOf('verse 2') < both.indexOf('Dark'), both.join(', '))

  check('a sound with only personal tags still has them',
    tagsOf({ name: 'x', userTags: ['mine'] }).includes('mine'))
  check('and one with neither is not broken',
    Array.isArray(tagsOf({ name: 'x' })))

  // The same word twice is one tag, not two chips saying the same thing.
  const dup = tagsOf({ name: 'x', tags: ['Dark'], userTags: ['dark'] })
  check('the same word in both layers appears once',
    dup.filter(t => t.toLowerCase() === 'dark').length === 1, dup.join(', '))
}

// ── ⚠️ the refresh that made two fields necessary ──────────────────────────
{
  const lib = readFileSync('lib/sound-library.ts', 'utf8')
  const sync = lib.slice(lib.indexOf('export async function syncCatalog'))

  // This used to `continue` on an entry it already had, which meant an admin
  // editing a catalog sound's tags changed them for nobody who already had it —
  // that is to say, for nobody at all.
  check('a catalog sound already held gets its shared tags refreshed',
    /libraryUpdate\(lid, \{ tags: it\.tags \?\? \[\] \}\)/.test(sync))
  check('and the refresh writes ONLY tags, never userTags',
    !/libraryUpdate\(lid, \{[^}]*userTags/.test(sync))
  check('the entry type carries a personal layer', /userTags\?:\s*string\[\]/.test(lib))
}

// ── the editor writes the right one ────────────────────────────────────────
{
  const ui = readFileSync('components/editor/SoundLibrary.tsx', 'utf8')
  check('the library edits userTags', /libraryUpdate\(id, \{ userTags \}\)/.test(ui))
  check('and never writes the shared field from there',
    !/libraryUpdate\(id, \{ tags[^U]/.test(ui))
  check('it says whose tags they are',
    /only you see these/i.test(ui))
  // A person editing a catalog sound should be told why the other tags are not
  // theirs to change, rather than wondering where the edit went.
  check('and explains the shared ones it will not touch',
    /not yours to change here/i.test(ui))
}

// ── browsing sees both ─────────────────────────────────────────────────────
{
  const aud = readFileSync('lib/voice/audition.ts', 'utf8')
  check('the audition filters on the shared derivation, not the raw field',
    /tagsOf\(e\)\.some/.test(aud) && !/\(e\.tags \?\? \[\]\)\.some/.test(aud))
}

console.log(failures ? `\n${failures} failing` : "\neverybody's tags, and yours")
assert.equal(failures, 0)
