#!/usr/bin/env node
// watch-video.mjs — decompose a video into inputs an AI can genuinely read:
// scene-change frames, timestamped 4×5 contact sheets, and a plain-text
// transcript from the video's captions. "Watching" then = Read the INDEX.md,
// skim the sheets, read the transcript, and open individual full-res frames
// where detail matters.
//
//   node scripts/watch-video.mjs <youtube-url-or-local-file> [options]
//
// Options:
//   --out <dir>       output folder (default ~/video-watch/<id>)
//   --scene <0..1>    scene-change threshold (default 0.30; lower = more frames)
//   --interval <sec>  also grab a frame every N sec of no scene change (default 20)
//   --max <n>         cap on frames; evenly thinned above this (default 700)
//   --height <px>     download resolution cap (default 720 — UI text stays legible)
//   --audio           also extract audio.wav (for analyze-mix.py style analysis)
//   --force           redo even if the folder already has output
//
// Layout of the result:
//   INDEX.md          start here — title, chapters, sheet → time-range map
//   sheets/*.jpg      4×5 grids, timestamps burned into every tile (the skim layer)
//   frames/*.jpg      full-res single frames, timestamp top-left (the zoom layer)
//   frames.json       [{ i, t, file }] frame → seconds map
//   transcript.txt    [h:mm:ss] caption lines (auto or manual subs)
//   chapters.txt      video chapters if the upload has them
//   audio.wav         only with --audio

import { execFileSync, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const execFileP = promisify(execFile)

// ── args ────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
if (!args.length || args[0].startsWith('--')) {
  console.error('usage: node scripts/watch-video.mjs <url-or-file> [--out dir] [--scene 0.30] [--interval 20] [--max 700] [--height 720] [--audio] [--force]')
  process.exit(1)
}
const source = args[0]
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : dflt
}
const has = name => args.includes(`--${name}`)
const SCENE = Number(opt('scene', '0.30'))
const INTERVAL = Number(opt('interval', '20'))
const MAX_FRAMES = Number(opt('max', '700'))
const HEIGHT = Number(opt('height', '720'))
const isUrl = /^https?:\/\//.test(source)

const fmtT = s => {
  s = Math.max(0, Math.round(s))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`
}

// ── workdir ─────────────────────────────────────────────────────────────────
let vidId = isUrl
  ? (source.match(/[?&]v=([\w-]{6,})/) || source.match(/youtu\.be\/([\w-]{6,})/) || [null, null])[1]
  : null
if (!vidId) vidId = isUrl ? Buffer.from(source).toString('base64url').slice(0, 16) : path.basename(source).replace(/\.\w+$/, '')
const OUT = path.resolve(opt('out', path.join(os.homedir(), 'video-watch', vidId)))
fs.mkdirSync(OUT, { recursive: true })
const framesDir = path.join(OUT, 'frames')
const sheetsDir = path.join(OUT, 'sheets')

if (!has('force') && fs.existsSync(path.join(OUT, 'INDEX.md'))) {
  console.log(`Already watched — output at ${OUT} (use --force to redo)`)
  process.exit(0)
}
fs.rmSync(framesDir, { recursive: true, force: true })
fs.rmSync(sheetsDir, { recursive: true, force: true })
fs.mkdirSync(framesDir, { recursive: true })
fs.mkdirSync(sheetsDir, { recursive: true })

// ── 1. download (or use local file) ─────────────────────────────────────────
let videoFile
let info = null
if (isUrl) {
  console.log('▸ downloading video + captions (yt-dlp)…')
  const existing = fs.readdirSync(OUT).find(f => /^video\.(mp4|mkv|webm)$/.test(f))
  if (!existing) {
    // a failed subtitle fetch (rate limits on secondary langs) must not kill
    // the run — as long as the video landed, keep going
    try {
      execFileSync('yt-dlp', [
        '-f', `bv*[height<=${HEIGHT}]+ba/b[height<=${HEIGHT}]`,
        '--merge-output-format', 'mp4',
        '--write-info-json',
        '--write-subs', '--write-auto-subs', '--sub-langs', 'en', '--sub-format', 'vtt',
        '-o', path.join(OUT, 'video.%(ext)s'),
        '--no-playlist',
        source,
      ], { stdio: ['ignore', 'inherit', 'inherit'] })
    } catch (e) {
      if (!fs.readdirSync(OUT).some(f => /^video\.(mp4|mkv|webm)$/.test(f))) throw e
      console.log('  (subtitle fetch hiccuped — continuing with what we got)')
    }
  } else {
    console.log(`  reusing existing download: ${existing}`)
  }
  videoFile = path.join(OUT, fs.readdirSync(OUT).find(f => /^video\.(mp4|mkv|webm)$/.test(f)))
  const infoFile = fs.readdirSync(OUT).find(f => f.endsWith('.info.json'))
  if (infoFile) { try { info = JSON.parse(fs.readFileSync(path.join(OUT, infoFile), 'utf8')) } catch { /* fine */ } }
} else {
  videoFile = path.resolve(source)
  if (!fs.existsSync(videoFile)) { console.error(`No such file: ${videoFile}`); process.exit(1) }
}

const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', videoFile]).toString())
const duration = Number(probe.format.duration || info?.duration || 0)
const vstream = probe.streams.find(s => s.codec_type === 'video')
console.log(`  ${fmtT(duration)} · ${vstream?.width}x${vstream?.height}`)

// ── 2. frames: scene changes + interval fallback ────────────────────────────
// One pass: select fires on a scene cut OR when INTERVAL sec passed since the
// last selected frame (so slow screen-recordings still sample regularly).
// showinfo leaks each selected frame's source pts to stderr; the timestamp
// goes into the FILENAME (Homebrew ffmpeg has no drawtext) and onto the
// contact-sheet labels below each tile.
console.log(`▸ extracting frames (scene>${SCENE} or every ${INTERVAL}s)…`)
// isnan() seeds the chain: prev_selected_t is NaN until a frame is selected,
// so without it the OR-expression never fires at all.
const vf = `select='isnan(prev_selected_t)+gt(scene,${SCENE})+gte(t-prev_selected_t,${INTERVAL})',showinfo`
const { stderr } = await execFileP('ffmpeg', [
  '-i', videoFile,
  '-vf', vf,
  '-vsync', 'vfr',
  '-q:v', '3',
  path.join(framesDir, 'f%05d.jpg'),
], { maxBuffer: 512 * 1024 * 1024 })

let times = [...stderr.matchAll(/pts_time:([\d.]+)/g)].map(m => Number(m[1]))
let files = fs.readdirSync(framesDir).filter(f => f.endsWith('.jpg')).sort()
console.log(`  ${files.length} frames`)

// thin evenly if over the cap (keep first + last)
if (files.length > MAX_FRAMES) {
  const keep = new Set()
  for (let k = 0; k < MAX_FRAMES; k++) keep.add(Math.round(k * (files.length - 1) / (MAX_FRAMES - 1)))
  const keptFiles = [], keptTimes = []
  files.forEach((f, i) => { if (keep.has(i)) { keptFiles.push(f); keptTimes.push(times[i]) } else fs.unlinkSync(path.join(framesDir, f)) })
  files = keptFiles; times = keptTimes
  console.log(`  thinned to ${files.length} (--max ${MAX_FRAMES})`)
}
// rename so every frame file carries its own timestamp (sortable + readable)
const frames = files.map((f, i) => {
  const t = times[i] ?? 0
  const name = `f${String(i + 1).padStart(5, '0')}_${fmtT(t).replace(/:/g, '.')}.jpg`
  fs.renameSync(path.join(framesDir, f), path.join(framesDir, name))
  return { i: i + 1, t: Math.round(t * 10) / 10, file: `frames/${name}` }
})
fs.writeFileSync(path.join(OUT, 'frames.json'), JSON.stringify(frames, null, 1))

// ── 3. contact sheets: 4×5 montages, timestamp labeled under every tile ─────
console.log('▸ tiling contact sheets (4×5, labeled)…')
const PER = 20
const MONT_FONT = ['/System/Library/Fonts/Helvetica.ttc', '/System/Library/Fonts/Supplemental/Arial.ttf', '/Library/Fonts/Arial.ttf'].find(f => fs.existsSync(f))
const sheets = []
for (let k = 0; k * PER < frames.length; k++) {
  const batch = frames.slice(k * PER, k * PER + PER)
  const sheet = `sheet${String(k + 1).padStart(3, '0')}.jpg`
  const argv = ['montage', ...(MONT_FONT ? ['-font', MONT_FONT] : []), '-background', '#101318', '-fill', 'white', '-pointsize', '15']
  argv.push('-title', `${fmtT(batch[0].t)} → ${fmtT(batch[batch.length - 1].t)}`)
  for (const fr of batch) argv.push('-label', fmtT(fr.t), path.join(OUT, fr.file))
  argv.push('-tile', '4x', '-geometry', '480x270+3+3', '-quality', '85', path.join(sheetsDir, sheet))
  await execFileP('magick', argv, { maxBuffer: 16 * 1024 * 1024 })
  sheets.push(sheet)
}
console.log(`  ${sheets.length} sheets`)

// ── 4. transcript from captions ─────────────────────────────────────────────
// Prefer manual subs over auto-subs. Auto-sub VTTs carry rolling duplicate
// cues + inline word-timing tags — strip tags, drop repeats.
console.log('▸ transcript…')
const vtts = fs.readdirSync(OUT).filter(f => f.endsWith('.vtt'))
const manual = vtts.find(f => !/\.en[^.]*\.vtt$/.test(f) ? false : !fs.readFileSync(path.join(OUT, f), 'utf8').includes('<c>'))
const vtt = manual ?? vtts[0]
let transcriptLines = 0
if (vtt) {
  const raw = fs.readFileSync(path.join(OUT, vtt), 'utf8')
  const out = []
  let last = ''
  const cueRe = /(\d{2}):(\d{2}):(\d{2})\.\d{3} --> [\d:.]+.*\n([\s\S]*?)(?=\n\n|\n\d{2}:|$)/g
  for (const m of raw.matchAll(cueRe)) {
    const t = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
    const text = m[4]
      .replace(/<[^>]+>/g, '')      // word-timing + styling tags
      .replace(/\s+/g, ' ')
      .trim()
    if (!text || text === last) continue
    // rolling captions repeat the previous line as their first half — trim overlap
    let clean = text
    if (last && text.startsWith(last)) clean = text.slice(last.length).trim()
    last = text
    if (clean) out.push(`[${fmtT(t)}] ${clean}`)
  }
  fs.writeFileSync(path.join(OUT, 'transcript.txt'), out.join('\n') + '\n')
  transcriptLines = out.length
  console.log(`  ${transcriptLines} caption lines (${vtt})`)
} else {
  fs.writeFileSync(path.join(OUT, 'transcript.txt'), '(no captions available for this video — no manual subs, no auto-subs; install whisper for local transcription)\n')
  console.log('  no captions found')
}

// ── 5. chapters ─────────────────────────────────────────────────────────────
if (info?.chapters?.length) {
  fs.writeFileSync(path.join(OUT, 'chapters.txt'), info.chapters.map(c => `[${fmtT(c.start_time)}] ${c.title}`).join('\n') + '\n')
  console.log(`  ${info.chapters.length} chapters`)
}

// ── 6. optional audio for numeric analysis ──────────────────────────────────
if (has('audio')) {
  console.log('▸ extracting audio.wav…')
  await execFileP('ffmpeg', ['-y', '-i', videoFile, '-vn', '-ar', '44100', path.join(OUT, 'audio.wav')], { maxBuffer: 16 * 1024 * 1024 })
}

// ── 7. INDEX.md — the entry point for reading ───────────────────────────────
const sheetMap = sheets.map((s, k) => {
  const a = frames[k * PER], b = frames[Math.min(frames.length - 1, k * PER + PER - 1)]
  return `- \`sheets/${s}\` — ${fmtT(a?.t ?? 0)} → ${fmtT(b?.t ?? duration)} (frames ${a?.i ?? '?'}–${b?.i ?? '?'})`
}).join('\n')
fs.writeFileSync(path.join(OUT, 'INDEX.md'), `# ${info?.title ?? path.basename(videoFile)}

${info ? `**${info.uploader ?? ''}** · ${fmtT(duration)} · ${info.webpage_url ?? ''}` : `${fmtT(duration)} · local file`}

How to watch: skim the contact sheets below in order (each tile has its
timestamp burned in), read \`transcript.txt\` alongside (same timestamps),
and open \`frames/fNNNNN.jpg\` (see \`frames.json\` for the time of each)
whenever a tile needs full-resolution detail.

${info?.chapters?.length ? `## Chapters\n\n${info.chapters.map(c => `- [${fmtT(c.start_time)}] ${c.title}`).join('\n')}\n` : ''}
## Contact sheets (${frames.length} frames, 4×5 per sheet)

${sheetMap}

## Files

- \`transcript.txt\` — ${transcriptLines ? `${transcriptLines} timestamped caption lines` : 'no captions available'}
- \`frames.json\` — frame → seconds map
${has('audio') ? '- `audio.wav` — for scripts/analyze-mix.py-style numeric listening\n' : ''}`)

console.log(`\n✓ watched. Read this first: ${path.join(OUT, 'INDEX.md')}`)
