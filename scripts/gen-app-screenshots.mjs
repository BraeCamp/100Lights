#!/usr/bin/env node
// Capture real App Store screenshots from each mini-app's own home screen.
//
// Because every app now has a distinct, from-scratch home, screenshots taken
// straight from them are genuinely different app-to-app — the clearest evidence
// against App Review 4.3 (duplicate apps). Writes 6.7" iPhone portrait PNGs to
// fastlane/metadata/<slug>/en-US/screenshots/APP_IPHONE_67/.
//
//   node scripts/gen-app-screenshots.mjs [--url=http://localhost:3001]
//
// Needs the dev server (or any deployment) running.

import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const URL = (process.argv.find(a => a.startsWith('--url=')) || '').split('=')[1] || 'http://localhost:3001'

// slug → the shots to take. Each is [filename, prep] where prep runs after load.
const APPS = ['beatmaker', 'captions', 'musicvideo', 'voicemidi', 'transcribe', 'sheetmusic', 'autotune']

// 6.7" iPhone: 1290×2796 physical = 430×932 CSS @ dpr 3 (App Store Connect's largest required size).
const W = 430, H = 932, DPR = 3

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DPR, colorScheme: 'dark', isMobile: true, hasTouch: true })
// Skip the intro splash so the home is captured clean.
await ctx.addInitScript(() => { try { for (const s of ['beatmaker','captions','musicvideo','voicemidi','transcribe','sheetmusic','autotune']) sessionStorage.setItem(`100lights-intro-${s}`, '1') } catch {} })

let n = 0
for (const slug of APPS) {
  const page = await ctx.newPage()
  try {
    await page.goto(`${URL}/apps/${slug}`, { waitUntil: 'networkidle', timeout: 30000 })
    await page.addStyleTag({ content: 'nextjs-portal,[data-next-badge-root],#__next-build-watcher,[data-nextjs-toast]{display:none!important}' })
    await page.waitForTimeout(900)                 // let motifs settle
    const dir = join(ROOT, 'fastlane', 'metadata', slug, 'en-US', 'screenshots', 'APP_IPHONE_67')
    mkdirSync(dir, { recursive: true })
    await page.screenshot({ path: join(dir, '01_home.png') })
    n++
    console.log(`  ✓ ${slug}`)
  } catch (e) {
    console.log(`  ✗ ${slug}: ${e instanceof Error ? e.message : e}`)
  } finally {
    await page.close()
  }
}
await browser.close()
console.log(`\n✓ ${n}/${APPS.length} app screenshots → fastlane/metadata/<slug>/en-US/screenshots/APP_IPHONE_67/01_home.png`)
