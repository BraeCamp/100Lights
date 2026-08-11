#!/usr/bin/env node
// Generate Fastlane `deliver` metadata from mobile/store-metadata.mjs.
//
// Writes fastlane/metadata/<slug>/en-US/*.txt for every app, so each store listing
// is version-controlled and genuinely distinct (the App Review 4.3 defense). Point
// deliver at a per-app dir, e.g. in the Fastfile:
//     deliver(metadata_path: "fastlane/metadata/#{slug}", skip_binary_upload: true, ...)
//
//   node scripts/gen-store-metadata.mjs           # write all
//   node scripts/gen-store-metadata.mjs --check    # validate only (CI), write nothing
//
// Validates Apple's hard limits (subtitle/keywords/promotional_text) and flags any
// two apps that share a subtitle or description — i.e. would read as duplicates.

import { mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { STORE_META, LIMITS } from '../mobile/store-metadata.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CHECK = process.argv.includes('--check')
const LOCALE = 'en-US'
const FIELDS = ['name', 'subtitle', 'description', 'keywords', 'promotional_text', 'marketing_url', 'support_url']

const errors = []
const seenSubtitle = new Map()
const seenDescription = new Map()

for (const [slug, m] of Object.entries(STORE_META)) {
  for (const f of ['name', 'subtitle', 'description', 'keywords']) {
    if (!m[f] || !String(m[f]).trim()) errors.push(`${slug}: missing "${f}"`)
  }
  for (const [f, max] of Object.entries(LIMITS)) {
    if (m[f] && m[f].length > max) errors.push(`${slug}: ${f} is ${m[f].length} chars (max ${max})`)
  }
  // Distinctness — reused subtitle/description reads as a duplicate app.
  if (m.subtitle) { const p = seenSubtitle.get(m.subtitle); if (p) errors.push(`${slug} & ${p}: identical subtitle "${m.subtitle}"`); else seenSubtitle.set(m.subtitle, slug) }
  if (m.description) { const key = m.description.slice(0, 80); const p = seenDescription.get(key); if (p) errors.push(`${slug} & ${p}: descriptions start identically`); else seenDescription.set(key, slug) }
}

if (errors.length) {
  console.error('✗ store metadata problems:\n' + errors.map(e => '  - ' + e).join('\n'))
  process.exit(1)
}

if (CHECK) {
  console.log(`✓ ${Object.keys(STORE_META).length} listings valid & distinct (subtitle ≤${LIMITS.subtitle}, keywords ≤${LIMITS.keywords}, promo ≤${LIMITS.promotional_text}).`)
  process.exit(0)
}

let files = 0
for (const [slug, m] of Object.entries(STORE_META)) {
  const dir = join(ROOT, 'fastlane', 'metadata', slug, LOCALE)
  mkdirSync(dir, { recursive: true })
  for (const f of FIELDS) {
    if (m[f] == null) continue
    writeFileSync(join(dir, `${f}.txt`), String(m[f]).trimEnd() + '\n')
    files++
  }
}
console.log(`✓ wrote ${files} metadata files for ${Object.keys(STORE_META).length} apps → fastlane/metadata/<slug>/en-US/`)
console.log('  Point `deliver(metadata_path: "fastlane/metadata/#{slug}")` at these when wiring App Store metadata upload.')
