#!/usr/bin/env node
/**
 * Is the shared voice cache actually working?
 *
 *   node --experimental-strip-types scripts/check-voice-cache.mjs
 *
 * Written because the pre-render's dry run said "0 already bought" and that
 * sentence has two meanings: nothing has been rendered yet, or the bucket
 * cannot be reached at all. `exists()` swallows its error — deliberately, since
 * a storage fault should degrade the economics and not the feature — which
 * makes the two indistinguishable from the outside. So this asks the question
 * the other way round, with a LIST, which fails loudly.
 *
 * Everything here is free: it reads storage and does arithmetic. Nothing is
 * rendered, so this may be run as often as you like.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { voiceKey, hashText, normaliseSpoken, looksSpeakable } from '../lib/voice/voice-cache.ts'

const ROOT = path.resolve(import.meta.dirname, '..')
const env = Object.fromEntries(
  readFileSync(path.join(ROOT, '.env.local'), 'utf8')
    .split('\n').filter(l => /^[A-Z0-9_]+=/.test(l))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] }),
)
const VOICE_ID = env.ELEVENLABS_VOICE_ID || 'EXAVITQu4vr4xnSDxMaL'
let failures = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${detail ? `  — ${detail}` : ''}`)
  if (!ok) failures++
}

console.log('THE KEY')
// The whole economy rests on two people saying the same sentence landing on the
// same object. If the hash is not stable across trivial differences, everybody
// pays for their own copy of "Drums: muted." and the cache quietly does nothing.
check('identical text, identical key', voiceKey('Drums: muted.', VOICE_ID) === voiceKey('Drums: muted.', VOICE_ID))
check('case and spacing do not split the cache',
  voiceKey('Drums: muted.', VOICE_ID) === voiceKey('  drums:   MUTED. ', VOICE_ID))
check('different text, different key', voiceKey('Drums: muted.', VOICE_ID) !== voiceKey('Drums: soloed.', VOICE_ID))
check('a different voice does not reuse the recording',
  voiceKey('Drums: muted.', VOICE_ID) !== voiceKey('Drums: muted.', 'other-voice'))
// Punctuation survives normalising, because it changes how a line is read.
check('punctuation is part of the phrase', hashText('Stopped.') !== hashText('Stopped'))

// A collision serves the wrong audio, which is worse than paying twice. Sweep
// the phrases this product actually says, plus a large synthetic spread.
const seen = new Map()
let collisions = 0
const feed = s => {
  const h = hashText(s)
  const had = seen.get(h)
  if (had !== undefined && normaliseSpoken(had) !== normaliseSpoken(s)) collisions++
  else seen.set(h, s)
}
for (let i = 0; i < 40_000; i++) feed(`Track ${i}: volume ${i % 101} percent.`)
for (const name of ['Bass', 'Drums', 'Pad A', 'Lead', 'Keys', 'Vox', 'Perc', 'Sub']) {
  for (const verb of ['muted', 'unmuted', 'soloed', 'armed', 'renamed', 'deleted', 'duplicated']) feed(`${name}: ${verb}.`)
}
check('no collisions across 40,000+ phrases', collisions === 0, `${seen.size} distinct keys`)

console.log('\nWHAT IT WILL AND WILL NOT SAY')
check('a normal read-back is speakable', looksSpeakable('Bass 2: volume 60 percent.'))
check('a question is speakable', looksSpeakable('Do you mean the bass track, or the bass clip at bar 15?'))
check('an essay is refused', !looksSpeakable('word '.repeat(60)))
check('markup is refused', !looksSpeakable('<script>alert(1)</script> read this aloud'))
check('a link is refused', !looksSpeakable('go to https://example.com now please'))
check('a wall of digits is refused', !looksSpeakable('1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18'))
check('an empty string is refused', !looksSpeakable('   '))

console.log('\nSTORAGE')
for (const k of ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'R2_PUBLIC_BASE']) {
  check(`${k} is set`, !!env[k])
}
if (env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_BUCKET) {
  const { S3Client, ListObjectsV2Command } = await import('@aws-sdk/client-s3')
  const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
  })
  try {
    // A LIST rather than a HEAD: this one is allowed to throw, which is the
    // entire point of the check.
    await s3.send(new ListObjectsV2Command({ Bucket: env.R2_BUCKET, MaxKeys: 1 }))
    check(`bucket ${env.R2_BUCKET} is reachable`, true)
    let bought = 0
    let token
    do {
      const page = await s3.send(new ListObjectsV2Command({
        Bucket: env.R2_BUCKET, Prefix: `voice/${VOICE_ID}/`, ContinuationToken: token,
      }))
      bought += page.KeyCount ?? 0
      token = page.IsTruncated ? page.NextContinuationToken : undefined
    } while (token)
    console.log(`\n  ${bought} phrase${bought === 1 ? '' : 's'} bought so far for voice ${VOICE_ID}.`)
    console.log(`  Every one of them is free for every user, from now on.`)
  } catch (e) {
    check(`bucket ${env.R2_BUCKET} is reachable`, false, String(e.message ?? e).slice(0, 120))
  }
}

console.log(failures ? `\n${failures} failed` : '\nall good')
process.exit(failures ? 1 : 0)
