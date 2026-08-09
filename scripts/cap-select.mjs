#!/usr/bin/env node
// Select which native app this repo currently targets: write capacitor.config.json for the
// given slug from mobile/apps.mjs (BASE + the app's fields). Run before `cap sync`/`cap add`
// or a Fastlane/CI build. Idempotent — re-running for the same slug reproduces the same file.
//
//   node scripts/cap-select.mjs studio
//   npm run app:select -- beatmaker
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { BASE, MOBILE_APPS, bySlug } from '../mobile/apps.mjs'

const slug = process.argv[2]
const list = MOBILE_APPS.map((a) => a.slug).join(', ')
if (!slug) {
  console.error(`usage: node scripts/cap-select.mjs <slug>\navailable: ${list}`)
  process.exit(1)
}
const app = bySlug(slug)
if (!app) {
  console.error(`unknown app "${slug}"\navailable: ${list}`)
  process.exit(1)
}

const config = {
  appId: app.appId,
  appName: app.appName,
  webDir: BASE.webDir,
  backgroundColor: BASE.backgroundColor,
  server: { url: app.serverUrl, androidScheme: 'https' },
  ios: BASE.ios,
  android: BASE.android,
  plugins: BASE.plugins,
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = process.env.CAP_CONFIG_OUT || join(root, 'capacitor.config.json')
writeFileSync(out, JSON.stringify(config, null, 2) + '\n')
console.log(`✓ ${out.split('/').pop()} → ${app.appName} (${app.appId}) @ ${app.serverUrl}`)
