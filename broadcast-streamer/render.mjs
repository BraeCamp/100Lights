// BROWSERLESS renderer — a 24/7 music-visual stream from ffmpeg ALONE. No Chromium, no Xvfb, no
// PulseAudio, no display. It pulls a station's playlist + look from the app, then runs one ffmpeg
// that loops the audio forever, draws a visual, and pushes H.264/AAC to RTMP.
//
// Why this exists: the browser streamer (stream.mjs) is heavy (a whole Chromium per stream) and needs
// Linux capture plumbing. This renderer runs anywhere ffmpeg does — a $0 micro box, a Pi, even macOS —
// and one small machine can run many of these. It's the "Phase C cost unlock" from the roadmap.
//
// THREE load modes (per-station `scene.renderer`, or the RENDERER env override), lightest last:
//   • reactive — audio-reactive visualiser (showcqt/spectrum/waves/bars), 720p. Heaviest (~0.7 core,
//                ~2.6 Mbps). The most "alive" look.
//   • loop     — a slow drifting gradient, pre-encoded ONCE then streamed with -c:v copy (no live video
//                encoding). ~0.05 core, ~0.5 Mbps. Gentle motion for near-zero cost.
//   • still    — a static palette card at a few fps (updates only when the track changes). The picture
//                barely moves, so x264 emits almost nothing: ~0.02 core, ~audio-only bandwidth. Pack
//                ~15 radios on a 1 TB box. Best for calm/background stations where motion isn't the point.
// The DELAY people reach for ("send a minute late") doesn't save load — it's a YouTube-side buffer
// (set stream latency to "Normal") that just lets a low/bursty bitrate ride smoothly. Load comes from
// how much the PICTURE CHANGES; `still` is the answer to "reduce it even more".
//
// Env: BASE_URL, STATION (slug) or BROADCAST_ID, RTMP_URL, STREAM_KEY (omit → write to OUT file for a
// local test), RENDERER (reactive|loop|still), WIDTH/HEIGHT/FPS/VBITRATE/ABITRATE, VIZ (reactive),
// LOOP_VBITRATE/LOOP_SECS/LOOP_VIDEO (loop), STILL_FPS/STILL_VBITRATE/STILL_IMAGE (still), OUT/TEST_SECONDS.
import { spawn } from 'node:child_process'
import { writeFile, mkdtemp, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const env = process.env
const HERE = dirname(fileURLToPath(import.meta.url))
const BASE_URL = (env.BASE_URL || 'https://100lights.com').replace(/\/$/, '')
const STATION = env.STATION || 'cinematic'
const SLUG = env.BROADCAST_ID || STATION
const W = parseInt(env.WIDTH || '1280', 10), H = parseInt(env.HEIGHT || '720', 10), FPS = parseInt(env.FPS || '30', 10)
const VBITRATE = env.VBITRATE || '2500k', ABITRATE = env.ABITRATE || '128k'
const RTMP_URL_ENV = env.RTMP_URL ? env.RTMP_URL.replace(/\/$/, '') : ''   // explicit env override (wins)
const STREAM_KEY = env.STREAM_KEY || ''
const OUT = env.OUT || ''
const VIZ = (env.VIZ || 'cqt').toLowerCase()
const RENDERER_ENV = (env.RENDERER || '').toLowerCase()   // '' → use the station's scene.renderer
// loop mode
const LOOP_VBITRATE = env.LOOP_VBITRATE || '900k'
const LOOP_SECS = parseInt(env.LOOP_SECS || '30', 10)     // gradient animation period (seamless loop)
const LOOP_VIDEO = env.LOOP_VIDEO || ''                    // custom bg video (path/url) → skips generation
// still mode
const STILL_FPS = parseInt(env.STILL_FPS || '4', 10)      // a handful of fps is plenty for a static card
const STILL_VBITRATE = env.STILL_VBITRATE || '200k'
const STILL_IMAGE = env.STILL_IMAGE || ''                 // custom channel art (path/url) → skips generation

const log = (...a) => console.log(`[render ${new Date().toISOString()}]`, ...a)
function dbl(r) { const m = /^(\d+)(k|M)?$/.exec(r); return m ? `${+m[1] * 2}${m[2] || ''}` : r }

// Dark backdrop tuned to the station's palette id (the reactive visualiser carries the colour).
const BG = { aurora: '0x0a1414', sunset: '0x1a0e0a', ocean: '0x08131c', neon: '0x0c0018', fire: '0x1a0a06', ice: '0x0a1016', candy: '0x160a14', mono: '0x0d0d0f' }
// showspectrum colour theme per palette (used when VIZ=spectrum).
const SPECTRUM = { fire: 'fire', sunset: 'fiery', ocean: 'cool', ice: 'cool', neon: 'plasma', aurora: 'viridis', candy: 'fruit', mono: 'green' }
// Gradient colours per palette for the loop/still cards (dark → accent → accent2).
const GRAD = {
  aurora: ['0x0a1414', '0x12564f', '0x3a2f6e'], sunset: ['0x160b08', '0x8a3f22', '0x5a2a4e'],
  ocean:  ['0x08131c', '0x134b60', '0x0e2a52'], neon:   ['0x0c0018', '0x6a1a7a', '0x1c2a7a'],
  fire:   ['0x160806', '0x8a2f16', '0x5a1a24'], ice:    ['0x0a1016', '0x2a5f7a', '0x3f5f8a'],
  candy:  ['0x160a14', '0x8a3f6a', '0x3f2a7a'], mono:   ['0x0d0d0f', '0x33333c', '0x1e1e26'],
}
const gradColors = (paletteId) => GRAD[paletteId] || GRAD.mono

function vizGraph(paletteId) {
  const bg = BG[paletteId] || '0x0d0f14'
  const base = `color=c=${bg}:s=${W}x${H}:r=${FPS}[bg];`
  if (VIZ === 'spectrum') {
    const c = SPECTRUM[paletteId] || 'intensity'
    return `${base}[0:a]showspectrum=s=${W}x${H}:mode=combined:slide=scroll:color=${c}:scale=cbrt:fps=${FPS}[v0];[bg][v0]overlay,format=yuv420p[v]`
  }
  if (VIZ === 'waves') {
    return `${base}[0:a]showwaves=s=${W}x${Math.round(H * 0.5)}:mode=cline:rate=${FPS}:colors=0x9d84ff[w];[bg][w]overlay=(W-w)/2:(H-h)/2,format=yuv420p[v]`
  }
  if (VIZ === 'bars') {
    return `${base}[0:a]showfreqs=s=${W}x${H}:mode=bar:ascale=log:fscale=log:colors=0x9d84ff[f];[bg][f]overlay,format=yuv420p[v]`
  }
  return `${base}[0:a]showcqt=s=${W}x${H}:r=${FPS}:bar_g=2:sono_g=3:bar_v=9[cqt];[bg][cqt]overlay,format=yuv420p[v]`
}

async function fetchPlaylist() {
  const r = await fetch(`${BASE_URL}/api/broadcast/playlist?station=${encodeURIComponent(SLUG)}`)
  if (!r.ok) throw new Error(`playlist ${r.status}`)
  const d = await r.json()
  const tracks = (d.tracks || []).map(t => String(t.url)).filter(Boolean)
  const scene = d.station?.fullScene || d.station?.scene || {}
  const paletteId = scene.colorCfg?.paletteId || scene.paletteId || 'mono'
  const renderer = (scene.renderer || 'reactive').toLowerCase()
  const rtmpUrl = (RTMP_URL_ENV || d.station?.rtmpUrl || 'rtmp://a.rtmp.youtube.com/live2').replace(/\/$/, '')
  return { tracks, paletteId, renderer, title: d.station?.title || SLUG, rtmpUrl, channel: d.station?.channel || '' }
}

// concat demuxer playlist (absolute URLs; remote is fine with the protocol whitelist).
async function writeConcat(tracks) {
  const dir = await mkdtemp(join(tmpdir(), 'lbstream-'))
  const file = join(dir, 'playlist.txt')
  await writeFile(file, tracks.map(u => `file '${u.replace(/'/g, "'\\''")}'`).join('\n') + '\n')
  return file
}

// One-time generate (and cache) a seamless drifting-gradient loop for a palette. Encoded slowly for
// tight compression; then every stream just -c:v copy's it, so live video CPU is ~zero.
async function generateLoop(paletteId) {
  if (LOOP_VIDEO) return LOOP_VIDEO
  const dir = join(HERE, 'assets'); await mkdir(dir, { recursive: true })
  const path = join(dir, `loop_${paletteId}_${W}x${H}_${FPS}_${LOOP_VBITRATE}_${LOOP_SECS}.mp4`)
  if (existsSync(path)) return path
  const [c0, c1, c2] = gradColors(paletteId)
  const src = `gradients=s=${W}x${H}:c0=${c0}:c1=${c1}:c2=${c2}:nb_colors=3:x0=0:y0=0:x1=${W}:y1=${H}:duration=${LOOP_SECS}:speed=0.006:rate=${FPS}`
  const args = ['-loglevel', 'error', '-nostdin', '-f', 'lavfi', '-i', src, '-t', String(LOOP_SECS),
    '-c:v', 'libx264', '-preset', 'veryslow', '-b:v', LOOP_VBITRATE, '-maxrate', LOOP_VBITRATE, '-bufsize', dbl(LOOP_VBITRATE),
    '-g', String(FPS * 2), '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path]
  log(`generating gradient loop (one-time) → ${path}`)
  await new Promise((res, rej) => spawn('ffmpeg', args, { stdio: ['ignore', 'inherit', 'inherit'] }).on('exit', c => c === 0 ? res() : rej(new Error(`loop gen exited ${c}`))))
  return path
}

// One-time generate (and cache) a static palette card PNG for `still` mode.
async function generateCard(paletteId) {
  if (STILL_IMAGE) return STILL_IMAGE
  const dir = join(HERE, 'assets'); await mkdir(dir, { recursive: true })
  const path = join(dir, `card_${paletteId}_${W}x${H}.png`)
  if (existsSync(path)) return path
  const [c0, c1, c2] = gradColors(paletteId)
  const src = `gradients=s=${W}x${H}:c0=${c0}:c1=${c1}:c2=${c2}:nb_colors=3:x0=0:y0=0:x1=${W}:y1=${H}:duration=1:speed=0:rate=1`
  const args = ['-loglevel', 'error', '-nostdin', '-f', 'lavfi', '-i', src, '-frames:v', '1', path]
  log(`generating still card (one-time) → ${path}`)
  await new Promise((res, rej) => spawn('ffmpeg', args, { stdio: ['ignore', 'inherit', 'inherit'] }).on('exit', c => c === 0 ? res() : rej(new Error(`card gen exited ${c}`))))
  return path
}

const AUDIO_IN = (concatFile) => ['-stream_loop', '-1', '-re', '-protocol_whitelist', 'file,http,https,tcp,tls,crypto,concat', '-safe', '0', '-f', 'concat', '-i', concatFile]
const OUT_ARGS = (rtmpUrl) => STREAM_KEY ? ['-f', 'flv', `${rtmpUrl}/${STREAM_KEY}`] : ['-f', 'mp4', '-movflags', '+faststart', OUT]
const TEST_TAIL = () => (OUT && !STREAM_KEY && env.TEST_SECONDS) ? ['-t', env.TEST_SECONDS] : []

function argsReactive(concatFile, paletteId, rtmpUrl) {
  return [
    '-loglevel', 'warning', '-nostdin', '-re', '-stream_loop', '-1',
    '-protocol_whitelist', 'file,http,https,tcp,tls,crypto,concat', '-safe', '0', '-f', 'concat', '-i', concatFile,
    '-filter_complex', vizGraph(paletteId), '-map', '[v]', '-map', '0:a',
    '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'stillimage', '-pix_fmt', 'yuv420p',
    '-b:v', VBITRATE, '-maxrate', VBITRATE, '-bufsize', dbl(VBITRATE), '-g', String(FPS * 2), '-r', String(FPS),
    '-c:a', 'aac', '-b:a', ABITRATE, '-ar', '44100', '-ac', '2', ...TEST_TAIL(), ...OUT_ARGS(rtmpUrl),
  ]
}
function argsLoop(concatFile, loopPath, rtmpUrl) {
  return [
    '-loglevel', 'warning', '-nostdin',
    '-stream_loop', '-1', '-re', '-i', loopPath,   // video: the pre-encoded gradient loop
    ...AUDIO_IN(concatFile),                        // audio: the playlist
    '-map', '0:v', '-map', '1:a',
    '-c:v', 'copy',                                 // ← no live video encoding
    '-c:a', 'aac', '-b:a', ABITRATE, '-ar', '44100', '-ac', '2', ...TEST_TAIL(), ...OUT_ARGS(rtmpUrl),
  ]
}
function argsStill(concatFile, cardPath, rtmpUrl) {
  return [
    '-loglevel', 'warning', '-nostdin',
    '-loop', '1', '-framerate', String(STILL_FPS), '-i', cardPath,   // video: one still image
    ...AUDIO_IN(concatFile),
    '-map', '0:v', '-map', '1:a',
    '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'stillimage', '-pix_fmt', 'yuv420p',
    '-r', String(STILL_FPS), '-g', String(Math.max(2, STILL_FPS * 2)),   // ~2s keyframes (YouTube prefers ≤2s)
    '-b:v', STILL_VBITRATE, '-maxrate', STILL_VBITRATE, '-bufsize', dbl(STILL_VBITRATE),
    '-c:a', 'aac', '-b:a', ABITRATE, '-ar', '44100', '-ac', '2', ...TEST_TAIL(), ...OUT_ARGS(rtmpUrl),
  ]
}

let shuttingDown = false, child = null
for (const s of ['SIGTERM', 'SIGINT']) process.on(s, () => { shuttingDown = true; try { child?.kill('SIGTERM') } catch {}; process.exit(0) })

async function main() {
  const { tracks, paletteId, renderer, title, rtmpUrl, channel } = await fetchPlaylist()
  if (!tracks.length) { log(`no tracks for "${SLUG}" — add audio or Jamendo tags in the radio admin`); process.exit(1) }
  const mode = RENDERER_ENV || renderer || 'reactive'
  log(`"${title}" — ${tracks.length} tracks · palette ${paletteId} · mode ${mode}${channel ? ` · channel: ${channel}` : ''}`)
  const concat = await writeConcat(tracks)

  // Prepare the video asset for the light modes (falls back to reactive if generation fails).
  let build
  if (mode === 'loop') {
    try { const lp = await generateLoop(paletteId); build = (rtmp) => argsLoop(concat, lp, rtmp) }
    catch (e) { log('loop asset failed, falling back to reactive:', e.message); build = (rtmp) => argsReactive(concat, paletteId, rtmp) }
  } else if (mode === 'still') {
    try { const cp = await generateCard(paletteId); build = (rtmp) => argsStill(concat, cp, rtmp) }
    catch (e) { log('still asset failed, falling back to reactive:', e.message); build = (rtmp) => argsReactive(concat, paletteId, rtmp) }
  } else {
    build = (rtmp) => argsReactive(concat, paletteId, rtmp)
  }

  // Reliability (Phase B): if ffmpeg drops (network blip, RTMP disconnect), relaunch after a short wait.
  for (;;) {
    const args = build(rtmpUrl)
    log(`ffmpeg → ${STREAM_KEY ? rtmpUrl + '/***' : OUT} (${mode}, ${W}x${H})`)
    child = spawn('ffmpeg', args, { stdio: ['ignore', 'inherit', 'inherit'] })
    const code = await new Promise(res => child.on('exit', res))
    if (shuttingDown || (OUT && !STREAM_KEY)) break   // one-shot for local file tests
    log(`ffmpeg exited (${code}) — restarting in 3s`)
    await new Promise(r => setTimeout(r, 3000))
  }
}
main().catch(e => { log('fatal', e); process.exit(1) })
