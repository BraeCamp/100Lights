#!/usr/bin/env node
// ---------------------------------------------------------------------------
//  Publish a built plug-in installer to R2 and verify it is actually reachable.
//
//    node scripts/publish-plugin-release.mjs <file> [--bucket plugins] [--key name]
//
//  Uploading is the easy half. The half that matters is checking afterwards
//  that a browser with no credentials can GET the object back — a private
//  bucket accepts the upload perfectly happily and then serves 401 to every
//  customer, which is a bad thing to discover from a support email.
//
//  Prints the sha256 so the download page can publish a checksum.
// ---------------------------------------------------------------------------
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'

const args = process.argv.slice(2)
const file = args.find(a => !a.startsWith('--'))
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}

if (!file) {
  console.error('usage: node scripts/publish-plugin-release.mjs <file> [--bucket plugins] [--key name]')
  process.exit(1)
}

const BUCKET = flag('bucket', process.env.R2_PLUGIN_BUCKET ?? 'plugins')
const KEY = flag('key', basename(file))
const PUBLIC_BASE = (process.env.R2_PLUGIN_PUBLIC_BASE ?? '').replace(/\/$/, '')

for (const v of ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY']) {
  if (!process.env[v]) {
    console.error(`Missing ${v} in the environment.`)
    process.exit(1)
  }
}

const body = await readFile(file)
const sha256 = createHash('sha256').update(body).digest('hex')
const mb = (body.length / 1048576).toFixed(1)

console.log(`\n  file    ${file}`)
console.log(`  size    ${mb} MB`)
console.log(`  sha256  ${sha256}`)
console.log(`  target  ${BUCKET}/${KEY}\n`)

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
})

const contentType = KEY.endsWith('.pkg') ? 'application/octet-stream'
  : KEY.endsWith('.dmg') ? 'application/x-apple-diskimage'
  : KEY.endsWith('.zip') ? 'application/zip'
  : 'application/octet-stream'

console.log('  uploading…')
await s3.send(new PutObjectCommand({
  Bucket: BUCKET,
  Key: KEY,
  Body: body,
  ContentType: contentType,
  // Tells the browser to save rather than try to display it, and fixes the
  // filename regardless of what the URL looks like.
  ContentDisposition: `attachment; filename="${KEY}"`,
  CacheControl: 'public, max-age=31536000, immutable',
}))
console.log('  uploaded\n')

if (!PUBLIC_BASE) {
  console.log('  R2_PLUGIN_PUBLIC_BASE is not set, so the public URL was not verified.')
  console.log('  Set it to the bucket\'s public base and re-run to check reachability.\n')
  process.exit(0)
}

const url = `${PUBLIC_BASE}/${encodeURIComponent(KEY)}`
console.log(`  verifying ${url}`)

// R2 can take a moment to expose a freshly written object.
let status = 0
for (let attempt = 0; attempt < 6; attempt++) {
  const res = await fetch(url, { method: 'HEAD' })
  status = res.status
  if (res.ok) {
    console.log(`\n  PUBLIC AND REACHABLE — HTTP ${status}`)
    console.log(`  ${url}\n`)
    process.exit(0)
  }
  await new Promise(r => setTimeout(r, 2000))
}

console.error(`\n  Uploaded, but the public URL returned HTTP ${status}.`)
console.error('  The object is in the bucket; the bucket is not serving it publicly.')
console.error('  Cloudflare dashboard -> R2 -> bucket -> Settings -> Public Development URL.\n')
process.exit(1)
