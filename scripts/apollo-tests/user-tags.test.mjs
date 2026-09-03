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

// ── and they follow the account ────────────────────────────────────────────
//
// Brae: "Let's make own samples, saves, and tags live on the account."
//
// ⚠️ THE TWO THINGS THAT DID NOT SYNC HAVE NO AUDIO OF THEIR OWN, which is why
// they needed a table of their own: user_sounds requires an r2_key, because it
// is the register of audio this account uploaded. A personal tag on a catalog
// sound and a community sound kept by reference both have nothing to upload.
{
  const route = readFileSync('app/api/library/prefs/route.ts', 'utf8')
  check('there is a place for what a person did to a sound',
    /CREATE TABLE IF NOT EXISTS user_sound_prefs/.test(route))
  check('keyed per user and sound, so it upserts rather than duplicates',
    /PRIMARY KEY \(user_id, sound_id\)/.test(route))

  // ⚠️ A TAG EDIT MUST NOT ERASE THE ONLY RECORD OF A KEPT SOUND. Tagging sends
  // no `saved`, so a plain overwrite would drop the reference that says the
  // sound exists at all — and it would only show up on the next machine.
  check('a tag edit cannot erase a kept sound\'s reference',
    /COALESCE\(EXCLUDED\.saved, user_sound_prefs\.saved\)/.test(route))

  check('reading is never an error, only an empty answer',
    /return Response\.json\(\{ prefs: \[\] \}\)/.test(route))

  const lib = readFileSync('lib/sound-library.ts', 'utf8')
  check('the device pulls them alongside the library sync',
    /await syncSoundPrefs\(\)/.test(lib))
  check('and pushes what was tagged or kept before signing in',
    /pushSoundPref\(e\.id/.test(lib))

  // ⚠️ A local tag written offline must survive the first sync after signing
  // in — otherwise the account "arriving" reads as the account taking things.
  check('an empty remote tag list does not clobber a local one',
    /if \(!same && p\.userTags\.length\)/.test(lib))

  // A kept sound is rebuilt as a REFERENCE, with no audio, exactly as it was
  // kept — so it streams on first use like it did on the other machine.
  check('a kept sound is rebuilt from its reference, not downloaded',
    /if \(!p\.saved\?\.communityRef\) continue/.test(lib))

  const community = readFileSync('lib/community.ts', 'utf8')
  check('keeping a community sound records it on the account',
    (community.match(/pushSoundPref\(/g) ?? []).length === 2)
}

console.log(failures ? `\n${failures} failing` : "\neverybody's tags, and yours")
assert.equal(failures, 0)
