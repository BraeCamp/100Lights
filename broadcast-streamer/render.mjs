// BROWSERLESS renderer — a 24/7 music-visual stream from ffmpeg ALONE. No Chromium, no Xvfb, no
// PulseAudio, no display. It pulls a station's playlist + look from the app, then runs one ffmpeg
// that loops the audio forever, turns it into a reactive visual, and pushes H.264/AAC to RTMP.
//
// Why this exists: the browser streamer (stream.mjs) is heavy (a whole Chromium per stream) and needs
// Linux capture plumbing. This renderer runs anywhere ffmpeg does — a $0 micro box, a Pi, even macOS —
// and one small machine can run many of these. It's the "Phase C cost unlock" from the roadmap. It
// doesn't reproduce every Lightning Bug look (no video-background modes / object detection yet), but
// it's a real, cheap, always-on audio-reactive broadcast.
//
// Env: BASE_URL, STATION (slug) or BROADCAST_ID, RTMP_URL, STREAM_KEY (omit → write to OUT file for a
// local test), WIDTH/HEIGHT/FPS/VBITRATE/ABITRATE, VIZ (cqt|spectrum|waves|bars), OUT (test file).
import { spawn } from 'node:child_process'
import { writeFile, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const env = process.env
const BASE_URL = (env.BASE_URL || 'https://100lights.com').replace(/\/$/, '')
const STATION = env.STATION || 'cinematic'
const SLUG = env.BROADCAST_ID || STATION
const W = parseInt(env.WIDTH || '1280', 10), H = parseInt(env.HEIGHT || '720', 10), FPS = parseInt(env.FPS || '30', 10)
const VBITRATE = env.VBITRATE || '2500k', ABITRATE = env.ABITRATE || '128k'
const RTMP_URL = (env.RTMP_URL || 'rtmp://a.rtmp.youtube.com/live2').replace(/\/$/, '')
const STREAM_KEY = env.STREAM_KEY || ''
const OUT = env.OUT || ''
const VIZ = (env.VIZ || 'cqt').toLowerCase()

const log = (...a) => console.log(`[render ${new Date().toISOString()}]`, ...a)

// Dark backdrop tuned to the station's palette id (the visualiser carries the colour).
const BG = { aurora: '0x0a1414', sunset: '0x1a0e0a', ocean: '0x08131c', neon: '0x0c0018', fire: '0x1a0a06', ice: '0x0a1016', candy: '0x160a14', mono: '0x0d0d0f' }
// showspectrum colour theme per palette (used when VIZ=spectrum).
const SPECTRUM = { fire: 'fire', sunset: 'fiery', ocean: 'cool', ice: 'cool', neon: 'plasma', aurora: 'viridis', candy: 'fruit', mono: 'green' }

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
  // default: constant-Q — the iconic musical bars + sonogram
  return `${base}[0:a]showcqt=s=${W}x${H}:r=${FPS}:bar_g=2:sono_g=3:bar_v=9[cqt];[bg][cqt]overlay,format=yuv420p[v]`
}

async function fetchPlaylist() {
  const r = await fetch(`${BASE_URL}/api/broadcast/playlist?station=${encodeURIComponent(SLUG)}`)
  if (!r.ok) throw new Error(`playlist ${r.status}`)
  const d = await r.json()
  const tracks = (d.tracks || []).map(t => String(t.url)).filter(Boolean)
  const paletteId = d.station?.fullScene?.colorCfg?.paletteId || d.station?.scene?.paletteId || 'mono'
  return { tracks, paletteId, title: d.station?.title || SLUG }
}

// concat demuxer playlist (absolute URLs; remote is fine with the protocol whitelist).
async function writeConcat(tracks) {
  const dir = await mkdtemp(join(tmpdir(), 'lbstream-'))
  const file = join(dir, 'playlist.txt')
  await writeFile(file, tracks.map(u => `file '${u.replace(/'/g, "'\\''")}'`).join('\n') + '\n')
  return file
}

function runFfmpeg(concatFile, paletteId) {
  const dest = STREAM_KEY ? `${RTMP_URL}/${STREAM_KEY}` : OUT
  const out = STREAM_KEY
    ? ['-f', 'flv', dest]
    : ['-f', 'mp4', '-movflags', '+faststart', dest]
  const args = [
    '-loglevel', 'warning', '-nostdin', '-re',
    '-stream_loop', '-1',
    '-protocol_whitelist', 'file,http,https,tcp,tls,crypto,concat',
    '-safe', '0', '-f', 'concat', '-i', concatFile,
    '-filter_complex', vizGraph(paletteId),
    '-map', '[v]', '-map', '0:a',
    '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'stillimage', '-pix_fmt', 'yuv420p',
    '-b:v', VBITRATE, '-maxrate', VBITRATE, '-bufsize', dbl(VBITRATE), '-g', String(FPS * 2), '-r', String(FPS),
    '-c:a', 'aac', '-b:a', ABITRATE, '-ar', '44100', '-ac', '2',
    ...(OUT && !STREAM_KEY && env.TEST_SECONDS ? ['-t', env.TEST_SECONDS] : []),
    ...out,
  ]
  log(`ffmpeg → ${STREAM_KEY ? RTMP_URL + '/***' : dest} (viz=${VIZ}, ${W}x${H}@${FPS})`)
  return spawn('ffmpeg', args, { stdio: ['ignore', 'inherit', 'inherit'] })
}
function dbl(r) { const m = /^(\d+)(k|M)?$/.exec(r); return m ? `${+m[1] * 2}${m[2] || ''}` : r }

let shuttingDown = false, child = null
for (const s of ['SIGTERM', 'SIGINT']) process.on(s, () => { shuttingDown = true; try { child?.kill('SIGTERM') } catch {}; process.exit(0) })

async function main() {
  const { tracks, paletteId, title } = await fetchPlaylist()
  if (!tracks.length) { log(`no tracks for "${SLUG}" — add audio or Jamendo tags in the radio admin`); process.exit(1) }
  log(`"${title}" — ${tracks.length} tracks, palette ${paletteId}`)
  const concat = await writeConcat(tracks)
  // Reliability (Phase B): if ffmpeg drops (network blip, RTMP disconnect), relaunch after a short wait.
  for (;;) {
    child = runFfmpeg(concat, paletteId)
    const code = await new Promise(res => child.on('exit', res))
    if (shuttingDown || (OUT && !STREAM_KEY)) break   // one-shot for local file tests
    log(`ffmpeg exited (${code}) — restarting in 3s`)
    await new Promise(r => setTimeout(r, 3000))
  }
}
main().catch(e => { log('fatal', e); process.exit(1) })
