#!/usr/bin/env node
/**
 * Buy the studio's fixed phrases once, for everybody, forever.
 *
 *   node --experimental-strip-types scripts/voice-prerender.mjs [--dry] [--limit 20]
 *
 * Brae: "Can't we record the response and just play it off of our system so
 * that we aren't paying at all after one person uses something once?"
 *
 * The endpoint already does this lazily — the first person to say a sentence
 * pays for it and everybody after that gets the recording free. This runs that
 * ahead of time for the phrases that carry no track name and are therefore
 * identical for every user in the product's lifetime, so even the FIRST person
 * pays nothing and never hears the browser voice while a recording is fetched.
 *
 * Safe to re-run. Anything already in storage is skipped without being
 * re-rendered — the same check the endpoint makes, and the reason none of this
 * is ever paid for twice.
 *
 * Deliberately not wired into the build. It spends money, so it is run
 * knowingly, and --dry shows exactly what it would spend first.
 */

import { readFileSync } from 'node:fs'
import path, { join } from 'node:path'
import { voiceKey, normaliseSpoken, looksSpeakable } from '../lib/voice/voice-cache.ts'

const ROOT = path.resolve(import.meta.dirname, '..')
const DRY = process.argv.includes('--dry')
const LIMIT = (() => {
  const i = process.argv.indexOf('--limit')
  return i > 0 ? Number(process.argv[i + 1]) : Infinity
})()

// Secrets from .env.local rather than the environment, so this works the way the
// rest of the scripts here do and nothing lands in shell history.
const env = Object.fromEntries(
  readFileSync(path.join(ROOT, '.env.local'), 'utf8')
    .split('\n').filter(l => /^[A-Z0-9_]+=/.test(l))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] }),
)
for (const k of ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET']) {
  if (!env[k]) { console.error(`missing ${k} in .env.local`); process.exit(1) }
}
const VOICE_ID = env.ELEVENLABS_VOICE_ID || 'EXAVITQu4vr4xnSDxMaL'
const MODEL = 'eleven_turbo_v2_5'

// ── What the studio says that never varies ─────────────────────────────────
//
// From lib/voice/phrases.json, which the build generates by reading the source.
// This script used to re-extract them itself, with its own copy of the same
// regexes — two extractors for one question, free to disagree, and one of them
// silently truncating any response that contained a nested template literal.
// One source, generated, checked in.

const { fixed } = JSON.parse(readFileSync(join(ROOT, 'lib/voice/phrases.json'), 'utf8'))

const phrases = fixed.map(p => p.text).filter(looksSpeakable).sort().slice(0, LIMIT)
const chars = phrases.reduce((n, p) => n + normaliseSpoken(p).length, 0)
console.log(`${phrases.length} fixed phrases, ${chars.toLocaleString()} characters`)
console.log(`voice ${VOICE_ID}, model ${MODEL}\n`)

// ── Storage ────────────────────────────────────────────────────────────────
const { S3Client, HeadObjectCommand, PutObjectCommand } = await import('@aws-sdk/client-s3')
const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
})
const exists = async Key => {
  try { await s3.send(new HeadObjectCommand({ Bucket: env.R2_BUCKET, Key })); return true }
  catch { return false }
}

let had = 0, made = 0, failed = 0, spentChars = 0
for (const phrase of phrases) {
  const key = voiceKey(phrase, VOICE_ID)
  if (await exists(key)) { had++; console.log(`  have  ${phrase}`); continue }
  if (DRY) { made++; spentChars += normaliseSpoken(phrase).length; console.log(`  would ${phrase}`); continue }
  if (!env.ELEVENLABS_API_KEY) { console.error('no ELEVENLABS_API_KEY in .env.local'); process.exit(1) }

  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}?output_format=mp3_44100_64`,
    {
      method: 'POST',
      headers: { 'xi-api-key': env.ELEVENLABS_API_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({
        text: phrase,
        model_id: MODEL,
        // The same settings the endpoint uses. If these drift, a phrase
        // rendered here sounds different from one rendered live, and the seam
        // is audible mid-conversation.
        voice_settings: { stability: 0.55, similarity_boost: 0.75, style: 0, use_speaker_boost: false },
      }),
    },
  ).catch(() => null)
  if (!res || !res.ok) {
    failed++
    console.log(`  FAIL  ${phrase}  (${res ? res.status + ' ' + (await res.text()).slice(0, 120) : 'unreachable'})`)
    continue
  }
  const body = new Uint8Array(await res.arrayBuffer())
  await s3.send(new PutObjectCommand({
    Bucket: env.R2_BUCKET, Key: key, Body: body, ContentType: 'audio/mpeg',
    // These never change — the key IS the text — so they may be held as long as
    // anything is willing to hold them.
    CacheControl: 'public, max-age=31536000, immutable',
    // The same metadata the endpoint writes. If only one writer recorded the
    // text, the admin panel would list the lazily-bought phrases and show the
    // pre-rendered ones as anonymous hashes — the wrong half.
    Metadata: { phrase: encodeURIComponent(phrase), voice: encodeURIComponent(VOICE_ID) },
  }))
  made++
  spentChars += normaliseSpoken(phrase).length
  console.log(`  made  ${phrase}`)
}

console.log(`\n${had} already bought, ${made} ${DRY ? 'would be rendered' : 'rendered'}, ${failed} failed`)
if (spentChars) {
  console.log(`${spentChars.toLocaleString()} characters${DRY ? ' would be' : ''} spent` +
    ` — about $${((spentChars / 1000) * 0.22).toFixed(2)} at $0.22/1k, once, for every user there will ever be.`)
}
