#!/usr/bin/env node
// ── Generate → record → capture (the AI backend content driver) ──────────────
// Turns a headless AI generation into a FULL video session the marketing
// pipeline can clip: it composes a song, loads it into the studio in a headless
// browser, screen-records a playthrough (Playwright video), bounces the audio,
// and assembles a self-contained session dir via the session-capture producer.
//
//   node scripts/generate-and-capture.mjs <genre> [key] [--seed=N] [--style=X]
//        [--seconds=20] [--url=http://localhost:3123] [--root=./sessions]
//
// Needs a running DEV server (dev-only window.__daw* hooks). Nothing publishes;
// this only emits sessions/<ts>/ for marketing-pipeline to consume.

import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, readdirSync, existsSync, rmSync, mkdirSync, mkdtempSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { ingestSession } from '../lib/session-capture/index.mjs'
import { buildHistoryFor, foldRevealSnapshots } from '../lib/build-history.mjs'
import { songVideoData, defaultMeta } from '../lib/song-video/from-project.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const flag = (name, def) => { const a = argv.find(x => x.startsWith(`--${name}=`)); return a ? a.split('=')[1] : def }
const pos = argv.filter(a => !a.startsWith('--'))
const GENRE = pos[0]
const KEY = pos[1] || ''
const SEED = flag('seed', '12345')
const STYLE = flag('style', '')
const SECONDS = Math.max(3, Math.min(120, Number(flag('seconds', '20'))))
const URL = flag('url', 'http://localhost:3123')
const OUT_ROOT = flag('root', join(ROOT, 'sessions'))
// Two content types: a playthrough (playhead scrolls the finished song) or a
// build TIMELAPSE (tracks appear one by one, then clips fill the arrangement).
const TIMELAPSE = argv.includes('--timelapse')
// --format=<id> renders the song-video format engine (synced to the real audio,
// natively 9:16) instead of screen-recording the studio. This is the good look.
const FORMAT = flag('format', null)
const MODE = FORMAT ? `format-${FORMAT}` : TIMELAPSE ? 'timelapse' : 'playthrough'
if (!GENRE && !STYLE) { console.error('usage: generate-and-capture.mjs <genre> [key] [--style=X] [--seed=N] [--seconds=20] [--url=…]'); process.exit(1) }

const TMP = mkdtempSync(join(tmpdir(), 'gencap-'))
const log = (...a) => console.log(...a)

// ── 1 · Generate (reuse compose.mjs: spec + a headless session w/ the reasons) ─
log('▸ composing…')
const specPath = join(TMP, 'spec.json')
const csessRoot = join(TMP, 'csess')
const composeArgs = ['scripts/compose.mjs']
if (GENRE) composeArgs.push(GENRE)
if (KEY) composeArgs.push(KEY)
if (STYLE) composeArgs.push(`--style=${STYLE}`)
composeArgs.push(`--seed=${SEED}`, '--best=3', `--out=${specPath}`, `--capture=${csessRoot}`)
execFileSync('node', composeArgs, { cwd: ROOT, stdio: 'inherit' })
const spec = JSON.parse(readFileSync(specPath, 'utf8'))

// the composer's decision log (take_started/rejected/retry/completed w/ reasons)
const csessDir = join(csessRoot, readdirSync(csessRoot).find(d => !d.endsWith('.partial') && !d.endsWith('.failed')))
const composerEvents = existsSync(join(csessDir, 'events.jsonl'))
  ? readFileSync(join(csessDir, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
  : []
const csessHeader = JSON.parse(readFileSync(join(csessDir, 'session.json'), 'utf8'))

// ── 2 · Convert spec → loadable cfproj (then clean it out of the repo) ─────────
log('▸ building loadable project…')
const audioDir = join(ROOT, 'Content', 'Audio')
mkdirSync(audioDir, { recursive: true })
const before = new Set(readdirSync(audioDir))
execFileSync('node', ['scripts/spec-to-cfproj.mjs', specPath], { cwd: ROOT, stdio: 'inherit' })
const newCfproj = readdirSync(audioDir).find(f => !before.has(f) && f.endsWith('.cfproj'))
if (!newCfproj) { console.error('spec-to-cfproj produced no .cfproj'); process.exit(1) }
const cfprojPath = join(audioDir, newCfproj)
const dawProject = JSON.parse(readFileSync(cfprojPath, 'utf8')).dawProject
rmSync(cfprojPath, { force: true }) // don't dirty the repo — we only needed the object

const bpm = dawProject.tempo || 120
const endBeat = Math.max(...dawProject.arrangementClips.map(c => c.startBeat + c.durationBeats), 4)
const sliceBeats = Math.min(endBeat, (SECONDS * bpm) / 60)

// Timelapse reveal snapshots (from the song's build-history).
const history = dawProject.history?.length ? dawProject.history : buildHistoryFor(dawProject)
const snaps = TIMELAPSE ? foldRevealSnapshots(dawProject, history) : null

// ── 3 · Headless studio: load the song, bounce audio, record a playthrough ─────
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
const VW = 1440, VH = 900

async function openStudio(context, initial = dawProject) {
  // Preset the UI tier so the first-run "how much studio" modal never appears,
  // and show the full studio (richest visual for content).
  await context.addInitScript(() => { try { localStorage.setItem('100lights-ui-tier', 'full') } catch { /* private */ } })
  const page = await context.newPage()
  await page.goto(`${URL}/new?modules=audio`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => typeof (window).__dawDispatch === 'function', null, { timeout: 30000 })
  await page.waitForTimeout(600)
  await page.evaluate(p => (window).__dawDispatch({ type: 'LOAD_PROJECT', project: p }), initial)
  await page.waitForTimeout(800)
  // Dismiss anything still overlaying the arrangement (onboarding, banners).
  await page.keyboard.press('Escape').catch(() => {})
  return page
}

// Render the song-video format engine, synced to the real audio, at native 9:16.
// Inlines lib/song-video (one source of truth) into a self-contained page loaded
// via file://; the <audio> drives the engine clock so audio + visual lock.
async function recordFormatVideo(browser, wavBuf, songData, meta) {
  const rdir = join(TMP, 'render'); mkdirSync(rdir, { recursive: true })
  writeFileSync(join(rdir, 'mix.wav'), wavBuf)
  const strip = s => s
    .replace(/^import .*from '\.\/formats\.mjs'.*$/m, '')
    .replace(/^export function/m, 'function').replace(/^export const FORMATS/m, 'const FORMATS')
    .replace(/^export const FORMAT_IDS.*$/m, '').replace(/[^\x00-\x7F]/g, '')
  const formats = strip(readFileSync(join(ROOT, 'lib/song-video/formats.mjs'), 'utf8'))
  const engine = strip(readFileSync(join(ROOT, 'lib/song-video/engine.mjs'), 'utf8'))
  const aj = o => JSON.stringify(o).replace(/[^\x00-\x7F]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'))
  const html = `<style>*{margin:0}html,body{height:100%;background:#050409;overflow:hidden}canvas{width:100vw;height:100vh;display:block}</style>
<canvas id=c></canvas><audio id=a src="mix.wav" preload=auto></audio>
<script type="module">
${formats}
${engine}
const SONG=${aj(songData)};
const audio=document.getElementById('a');
const inst=mountSongVideo(document.getElementById('c'),SONG,{format:${aj(FORMAT)},brand:'100LIGHTS',meta:${aj(meta)},hook:[{text:'an AI wrote this'},{text:'in one pass.',accent:true}],accent:'#a78bfa',loopBeats:SONG.loopBeats,synth:false,media:audio});
window.__ready=false;
audio.addEventListener('canplaythrough',()=>{inst.play();window.__ready=true;},{once:true}); audio.load();
</script>`
  writeFileSync(join(rdir, 'render.html'), html)
  const W9 = 810, H9 = 1440
  const ctx = await browser.newContext({ viewport: { width: W9, height: H9 }, recordVideo: { dir: join(TMP, 'video'), size: { width: W9, height: H9 } } })
  const page = await ctx.newPage()
  await page.goto('file://' + join(rdir, 'render.html'), { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 15000 }).catch(() => {})
  await page.waitForTimeout((wav.durationSec || SECONDS) * 1000 + 500)
  const v = page.video(); await ctx.close()
  return { videoPath: v ? await v.path() : null, w: W9, h: H9 }
}

// 3a — audio bounce (own context, no video) — realtime, so render just the slice.
log(`▸ bouncing audio (${sliceBeats.toFixed(1)} beats ≈ ${SECONDS}s, realtime)…`)
const ctxA = await browser.newContext({ viewport: { width: VW, height: VH } })
const pageA = await openStudio(ctxA)
const wav = await pageA.evaluate(async (endB) => {
  const r = await (window).__dawRenderWav({ startBeat: 0, endBeat: endB, tailSec: 0.5 })
  return r ? { master: r.master, sampleRate: r.sampleRate, durationSec: r.durationSec } : null
}, sliceBeats)
await ctxA.close()
if (!wav) { console.error('audio bounce failed'); await browser.close(); process.exit(1) }

// 3b — video: a song-video FORMAT render (9:16, synced to audio) OR the studio.
log(`▸ recording ${MODE}…`)
let videoPath, capW = VW, capH = VH
const roi = []
if (FORMAT) {
  const songData = songVideoData(dawProject, { startBeat: 0, beats: sliceBeats, genre: spec.genre })
  const r = await recordFormatVideo(browser, Buffer.from(wav.master, 'base64'), songData, defaultMeta(songData))
  videoPath = r.videoPath; capW = r.w; capH = r.h
  roi.push({ t: 0, x: 0, y: 0, w: capW, h: capH, panel: 'video' }) // already 9:16 — full frame
  await browser.close()
} else {
  const ctxV = await browser.newContext({ viewport: { width: VW, height: VH }, recordVideo: { dir: join(TMP, 'video'), size: { width: VW, height: VH } } })
  const pageV = await openStudio(ctxV, TIMELAPSE ? snaps[0] : dawProject)
  const arrRect = await pageV.evaluate(() => {
    const el = document.querySelector('[data-help-id="add-track"]')?.closest('section, main, .daw-arrangement') || document.body
    const r = el.getBoundingClientRect()
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
  })
  roi.push({ t: 0, x: arrRect.x, y: arrRect.y, w: arrRect.w, h: arrRect.h, panel: 'arrangement' })
  if (TIMELAPSE) {
    const stepMs = Math.max(110, Math.floor((SECONDS * 1000) / snaps.length))
    for (let i = 1; i < snaps.length; i++) { await pageV.evaluate(p => (window).__dawDispatch({ type: 'LOAD_PROJECT', project: p }), snaps[i]); await pageV.waitForTimeout(stepMs) }
    await pageV.waitForTimeout(900)
  } else {
    await pageV.evaluate(() => (window).__daw?.play(0)); await pageV.waitForTimeout(SECONDS * 1000); await pageV.evaluate(() => (window).__daw?.stop())
  }
  const video = pageV.video(); await ctxV.close()
  videoPath = video ? await video.path() : null
  await browser.close()
}
if (!videoPath || !existsSync(videoPath)) { console.error('video capture failed'); process.exit(1) }

// ── 4 · Assemble the session (video + audio + reasons spread across the clip) ──
log('▸ assembling session…')
// Re-time the composer's decision events across the playthrough so the marketing
// selector cuts distributed moments (the reasons describe the generation, not the
// playthrough — spreading them is the honest way to anchor them to frames).
// Playthrough duration = recorded video length (includes the studio-load intro).
// Spread events across the ACTUAL playback window (after the ~load pad) so the
// marketing selector cuts real motion, not the loading screen.
const dur = SECONDS
const loadPad = Math.min(3, dur * 0.4)
const spread = composerEvents.map((e, i) => ({
  ...e, t: +(loadPad + (i / Math.max(1, composerEvents.length - 1)) * Math.max(0.5, dur - loadPad - 0.5)).toFixed(3),
}))

const header = {
  started_at: new Date().toISOString(),
  capture: { path: 'capture.webm', fps: 25, width: capW, height: capH, started_at: new Date().toISOString() },
  audio: { path: 'final_mix.wav', sample_rate: wav.sampleRate, duration_s: wav.durationSec, stems: [] },
  musical: csessHeader.musical ?? {
    bpm, key: KEY || spec.scale || null, time_signature: '4/4',
    genre_tags: [spec.genre], instrument_list: spec.tracks.map(t => t.name),
  },
  generation: csessHeader.generation ?? { model: 'generate-and-capture', prompt_or_seed: Number(SEED), total_takes: 3, rejected_takes: 2 },
  roi_fallback: { x: 0, y: 0, w: capW, h: capH, panel: 'full' },
  outcome: 'completed',
  duration_s: dur,
}
const files = [
  { name: 'capture.webm', data: readFileSync(videoPath) },
  { name: 'final_mix.wav', data: Buffer.from(wav.master, 'base64') },
]
const dir = ingestSession({ root: OUT_ROOT, sessionId: `gencap-${MODE}-${spec.genre}-${SEED}`, header, events: spread, roi, files })
rmSync(TMP, { recursive: true, force: true })
log(`\n✓ ${MODE} session → ${dir}`)
log(`  video ${(files[0].data.length / 1e6).toFixed(1)}MB · audio ${(files[1].data.length / 1e6).toFixed(1)}MB · ${spread.length} events · ${roi.length} roi`)
log(`  feed it: python -m pipeline run --root ${OUT_ROOT}`)
