#!/usr/bin/env node
// ── cfproj → one clean "watch me build this" timelapse mp4 ────────────────────
// Move 3 of the content engine: takes an existing project, replays its
// build-history as a fast/clean reveal (tracks + clips appear one by one) in a
// headless studio while Playwright screen-records, bounces the finished song's
// audio, then muxes ONE self-contained mp4 — the reveal runs silent, the song
// drops when the arrangement is complete and the playhead scrolls it in sync.
//
//   node scripts/timelapse.mjs --project=<file.cfproj> [--out=<dir>]
//        [--url=http://localhost:3001] [--reveal=10] [--play=<sec>] [--step=380]
//
// Needs a running DEV server (dev-only window.__daw* hooks). Emits nothing
// public — just <out>/<name> (timelapse).mp4. Non-AI-rendered by construction.

import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync, mkdirSync, mkdtempSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir, homedir } from 'node:os'
import { buildHistoryFor, foldRevealSnapshots } from '../lib/build-history.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const flag = (n, d) => { const a = argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d }
const PROJECT = flag('project', argv.find(a => !a.startsWith('--')))
const URL = flag('url', 'http://localhost:3001')
const OUT = flag('out', join(homedir(), 'Desktop', '100lights-ai-renders'))
const STEP = Math.max(120, Number(flag('step', '380')))   // ms each reveal snapshot holds
const REVEAL_CAP = Math.max(4, Number(flag('reveal', '11'))) // reveal never runs longer than this
if (!PROJECT || !existsSync(PROJECT)) { console.error('usage: timelapse.mjs --project=<file.cfproj>'); process.exit(1) }

const log = (...a) => console.log(...a)
const TMP = mkdtempSync(join(tmpdir(), 'timelapse-'))
const raw = JSON.parse(readFileSync(PROJECT, 'utf8'))
const dawProject = raw.dawProject || raw
const NAME = dawProject.name || basename(PROJECT).replace(/\.cfproj$/, '')
const bpm = dawProject.tempo || 120
const endBeat = Math.max(...dawProject.arrangementClips.map(c => c.startBeat + c.durationBeats), 4)
const PLAY = Math.max(4, Math.min(90, Number(flag('play', String(Math.ceil((endBeat * 60) / bpm))))))

// Build-history reveal snapshots — first is empty-ish, last is the finished song.
const history = dawProject.history?.length ? dawProject.history : buildHistoryFor(dawProject)
const snaps = foldRevealSnapshots(dawProject, history)
// Pace the reveal: STEP per snapshot, but never exceed the reveal cap.
const stepMs = Math.max(120, Math.min(STEP, Math.floor((REVEAL_CAP * 1000) / Math.max(1, snaps.length - 1))))
const revealMs = stepMs * (snaps.length - 1) + 700 /* settle */
log(`▸ ${NAME} · ${snaps.length} reveal steps @ ${stepMs}ms (${(revealMs / 1000).toFixed(1)}s) → play ${PLAY}s`)

async function openStudio(context, initial) {
  await context.addInitScript(() => { try { localStorage.setItem('100lights-ui-tier', 'full') } catch {} })
  const page = await context.newPage()
  await page.goto(`${URL}/new?modules=audio`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => typeof window.__dawDispatch === 'function', null, { timeout: 30000 })
  await page.waitForTimeout(600)
  await page.evaluate(p => window.__dawDispatch({ type: 'LOAD_PROJECT', project: p }), initial)
  await page.waitForTimeout(800)
  await page.keyboard.press('Escape').catch(() => {})
  return page
}

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
const VW = 1440, VH = 900

// 1 · bounce the finished song's audio (own context, realtime, no video).
log(`▸ bouncing ${PLAY}s of audio (realtime)…`)
const ctxA = await browser.newContext({ viewport: { width: VW, height: VH } })
const pageA = await openStudio(ctxA, dawProject)
const wav = await pageA.evaluate(async (endB) => {
  const r = await window.__dawRenderWav({ startBeat: 0, endBeat: endB, tailSec: 0.4 })
  return r ? { master: r.master, sampleRate: r.sampleRate, durationSec: r.durationSec } : null
}, (PLAY * bpm) / 60)
await ctxA.close()
if (!wav) { console.error('audio bounce failed'); await browser.close(); process.exit(1) }
const wavPath = join(TMP, 'song.wav')
writeFileSync(wavPath, Buffer.from(wav.master, 'base64'))

// 2 · record the build reveal + a synced playthrough of the finished song.
log('▸ recording build reveal + playthrough…')
const ctxV = await browser.newContext({ viewport: { width: VW, height: VH }, recordVideo: { dir: join(TMP, 'video'), size: { width: VW, height: VH } } })
const pageV = await openStudio(ctxV, snaps[0])
const arr = await pageV.evaluate(() => {
  const el = document.querySelector('[data-help-id="add-track"]')?.closest('section, main, .daw-arrangement') || document.body
  const r = el.getBoundingClientRect()
  return { x: Math.max(0, Math.floor(r.x)), y: Math.max(0, Math.floor(r.y)), w: Math.floor(r.width), h: Math.floor(r.height) }
})
for (let i = 1; i < snaps.length; i++) {
  await pageV.evaluate(p => window.__dawDispatch({ type: 'LOAD_PROJECT', project: p }), snaps[i])
  await pageV.waitForTimeout(stepMs)
}
await pageV.waitForTimeout(700)               // settle on the finished arrangement
await pageV.evaluate(() => window.__daw?.play(0))
await pageV.waitForTimeout(PLAY * 1000)
await pageV.evaluate(() => window.__daw?.stop())
const video = pageV.video()
await ctxV.close()
await browser.close()
const videoPath = video ? await video.path() : null
if (!videoPath || !existsSync(videoPath)) { console.error('video capture failed'); process.exit(1) }

// 3 · mux: crop to the arrangement, drop the song in at reveal-end, master to -14 LUFS.
mkdirSync(OUT, { recursive: true })
const outPath = join(OUT, `${NAME} (timelapse).mp4`)
// crop to an even-dimensioned arrangement ROI (h264 needs even w/h)
const cw = arr.w - (arr.w % 2), ch = arr.h - (arr.h % 2)
const offset = (revealMs / 1000).toFixed(2)
log(`▸ muxing → ${outPath}  (crop ${cw}x${ch} @ ${arr.x},${arr.y}, audio @ +${offset}s)`)
execFileSync('ffmpeg', [
  '-hide_banner', '-loglevel', 'error', '-y',
  '-i', videoPath,
  '-itsoffset', offset, '-i', wavPath,
  '-filter_complex', `[0:v]crop=${cw}:${ch}:${arr.x}:${arr.y},fps=30,format=yuv420p[v]`,
  '-map', '[v]', '-map', '1:a',
  '-af', 'loudnorm=I=-14:TP=-1.2:LRA=11',
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
  '-c:a', 'aac', '-b:a', '192k',
  outPath,
], { cwd: ROOT, stdio: 'inherit' })

log(`\n✓ ${NAME} timelapse`)
log(`  → ${outPath}`)
log(`  reveal ${(revealMs / 1000).toFixed(1)}s (silent build) → song drops → ${PLAY}s playthrough`)
log(`  hook-first edit (finished loop up front) is a trivial ffmpeg post-cut if wanted.`)
