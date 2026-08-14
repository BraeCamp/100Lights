// Lightning Bug 24/7 streamer — loads a station's broadcast page in a real (headful-on-Xvfb)
// Chromium, then captures the X display + PulseAudio and pushes H.264/AAC to an RTMP target
// (YouTube Live by default). No OBS, no desktop — this is the process that runs on an always-on box
// so the stream keeps going with your own devices off.
//
// Driven entirely by env (see .env.example). entrypoint.sh sets up Xvfb (:99) + a PulseAudio null
// sink named `broadcast` before running this. ffmpeg reads `:99` (video) and `broadcast.monitor`
// (audio) — i.e. exactly what the page draws + plays.
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'

const env = process.env
const BASE_URL   = (env.BASE_URL || 'https://100lights.com').replace(/\/$/, '')
const STATION    = env.STATION || 'cinematic'
// Later: a full-interface broadcast project uses ?broadcast=<id>. For now a station slug.
const PAGE_URL   = env.BROADCAST_ID
  ? `${BASE_URL}/apps/lightningbug?broadcast=${encodeURIComponent(env.BROADCAST_ID)}`
  : `${BASE_URL}/apps/lightningbug?station=${encodeURIComponent(STATION)}&broadcast=1`
const WIDTH      = parseInt(env.WIDTH || '1280', 10)
const HEIGHT     = parseInt(env.HEIGHT || '720', 10)
const FPS        = parseInt(env.FPS || '30', 10)
const VBITRATE   = env.VBITRATE || '2500k'          // video bitrate (720p30 ≈ 2500k; 1080p30 ≈ 4500k)
const ABITRATE   = env.ABITRATE || '128k'
const RTMP_URL   = (env.RTMP_URL || 'rtmp://a.rtmp.youtube.com/live2').replace(/\/$/, '')
const STREAM_KEY = env.STREAM_KEY || ''
const DISPLAY    = env.DISPLAY || ':99'

if (!STREAM_KEY) { console.error('[streamer] STREAM_KEY is required (your YouTube/Twitch stream key).'); process.exit(1) }

const log = (...a) => console.log(`[streamer ${new Date().toISOString()}]`, ...a)

let browser, ffmpeg, shuttingDown = false

async function openPage() {
  browser = await chromium.launch({
    headless: false,                      // headful onto Xvfb so x11grab can capture the real pixels
    args: [
      `--window-position=0,0`,
      `--window-size=${WIDTH},${HEIGHT}`,
      '--start-fullscreen', '--kiosk',
      '--autoplay-policy=no-user-gesture-required',   // no tap-to-start needed
      '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows', '--disable-infobars',
      '--use-gl=swiftshader',              // software WebGL/canvas — no GPU on a free box
      '--force-device-scale-factor=1',
      '--no-first-run', '--no-default-browser-check', '--mute-audio=false',
    ],
  })
  const ctx = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 })
  const page = await ctx.newPage()
  page.on('crash', () => { if (!shuttingDown) { log('page crashed — restarting'); restart() } })
  log('loading', PAGE_URL)
  await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 })
  // Autoplay is unlocked by the flag, but click a "tap to start" overlay if one shows anyway.
  await page.waitForTimeout(2500)
  for (const label of [/tap to start/i, /start/i]) {
    try { const el = page.getByText(label).first(); if (await el.isVisible({ timeout: 1000 })) { await el.click({ timeout: 2000 }); log('clicked start overlay'); break } } catch {}
  }
  await page.mouse.click(Math.floor(WIDTH / 2), Math.floor(HEIGHT / 2)).catch(() => {})   // belt-and-suspenders
  log('page ready — audio should be playing to the pulse sink')
  return page
}

function startFfmpeg() {
  const g = String(FPS * 2)
  const args = [
    '-loglevel', 'warning', '-nostdin',
    '-thread_queue_size', '512', '-f', 'x11grab', '-draw_mouse', '0', '-framerate', String(FPS), '-video_size', `${WIDTH}x${HEIGHT}`, '-i', DISPLAY,
    '-thread_queue_size', '512', '-f', 'pulse', '-i', 'broadcast.monitor',
    '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency', '-pix_fmt', 'yuv420p',
    '-b:v', VBITRATE, '-maxrate', VBITRATE, '-bufsize', doubleRate(VBITRATE), '-g', g, '-keyint_min', String(FPS),
    '-c:a', 'aac', '-b:a', ABITRATE, '-ar', '44100', '-ac', '2',
    '-f', 'flv', `${RTMP_URL}/${STREAM_KEY}`,
  ]
  log('starting ffmpeg →', RTMP_URL + '/***')
  ffmpeg = spawn('ffmpeg', args, { stdio: ['ignore', 'inherit', 'inherit'] })
  ffmpeg.on('exit', code => {
    if (shuttingDown) return
    log(`ffmpeg exited (${code}) — retrying in 3s`)
    setTimeout(startFfmpeg, 3000)
  })
}

function doubleRate(r) { const m = /^(\d+)(k|M)?$/.exec(r); if (!m) return r; return `${parseInt(m[1], 10) * 2}${m[2] || ''}` }

async function restart() {
  try { ffmpeg?.kill('SIGKILL') } catch {}
  try { await browser?.close() } catch {}
  process.exit(1)   // let the container's restart policy bring it back clean
}

async function main() {
  await openPage()
  startFfmpeg()
  // Keep the process alive; the container watches this PID.
  setInterval(() => {}, 1 << 30)
}

for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, async () => { shuttingDown = true; log('shutting down'); try { ffmpeg?.kill('SIGTERM') } catch {}; try { await browser?.close() } catch {}; process.exit(0) })
main().catch(e => { log('fatal', e); process.exit(1) })
