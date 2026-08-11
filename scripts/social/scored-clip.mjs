#!/usr/bin/env node
// FORMAT — "this clip, but I scored it". Take a PUBLIC-DOMAIN video acquired online, generate a fresh
// genre score for it, and composite a vertical Short (cover-cropped clip + burned hook caption + the new
// score replacing the original audio). Demonstrates the pipeline: generate audio → use online media →
// finished video. Reuses scripts/social/_music.mjs.
//
//   node scripts/social/scored-clip.mjs [--video=path.mp4] [--genre=cinematic] [--hook=epic] [--seg=10] [--title="..."]
//
// Default source = a clip in ~/Desktop/caption-test-videos/ (already acquired online from archive.org).
import { readdirSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir, homedir } from 'node:os'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { KITS, MELODIES, renderScore } from './_music.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const OUT_DIR = join(homedir(), 'Desktop', '100lights-ai-renders')
const argv = process.argv.slice(2)
const flag = (n, d) => { const a = argv.find(x => x.startsWith(`--${n}=`)); return a ? a.split('=')[1] : d }
const ff = (args) => { try { execFileSync('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] }) } catch (e) { throw new Error('ffmpeg:\n' + (e.stderr?.toString().split('\n').slice(-8).join('\n') || e.message)) } }
const SEG = Math.max(5, Number(flag('seg', '10')))

function defaultVideo() {
  const dir = join(homedir(), 'Desktop', 'caption-test-videos')
  if (existsSync(dir)) { const m = readdirSync(dir).filter(f => /\.(mp4|mov|webm)$/i.test(f)); if (m.length) return join(dir, m[0]) }
  return null
}

const overlayHtml = (title, genre) => `<!doctype html><html><body style="margin:0;width:1080px;height:1920px;overflow:hidden;
  font-family:-apple-system,'Helvetica Neue',Helvetica,Arial,sans-serif;color:#fff;display:flex;flex-direction:column;align-items:center;text-align:center;
  text-shadow:0 3px 18px rgba(0,0,0,.8),0 0 6px rgba(0,0,0,.7)">
  <div style="margin-top:150px;padding:0 60px;font-size:64px;font-weight:800;line-height:1.15">${title}</div>
  <div style="flex:1"></div>
  <div style="font-size:${Math.min(150, Math.floor(1450 / Math.max(3, genre.length)))}px;font-weight:900;letter-spacing:1px">${genre}</div>
  <div style="margin-top:24px;font-size:40px;font-weight:600;opacity:.9">score</div>
  <div style="flex:1"></div>
  <div style="margin-bottom:190px;font-size:44px;font-weight:700;opacity:.92">does it fit? 🎬</div>
  <div style="margin-bottom:80px;font-size:30px;font-weight:800;letter-spacing:6px;opacity:.6">100LIGHTS</div>
</body></html>`

async function main() {
  const video = flag('video', defaultVideo())
  if (!video || !existsSync(video)) { console.error('No source video. Pass --video=path.mp4 (or run scripts that download PD clips into ~/Desktop/caption-test-videos/).'); process.exit(1) }
  const kit = KITS[flag('genre', 'cinematic')] || KITS.cinematic
  const hook = MELODIES[flag('hook', 'epic')] || MELODIES.epic
  const title = flag('title', 'this old clip · fresh score')
  const tmp = mkdtempSync(join(tmpdir(), 'scored-'))
  try {
    console.log(`▸ generating ${kit.name} score (${kit.bpm} BPM)…`)
    const wav = renderScore(kit, hook, SEG, tmp, 'score')
    console.log(`▸ styling caption overlay…`)
    const browser = await chromium.launch()
    const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } })
    await page.setContent(overlayHtml(title, kit.name), { waitUntil: 'load' })
    const png = join(tmp, 'overlay.png'); await page.screenshot({ path: png, type: 'png', omitBackground: true })
    await browser.close()
    console.log(`▸ compositing (${basename(video)} + score)…`)
    const out = flag('out', join(OUT_DIR, `Short - Scored Clip (${kit.name}).mp4`))
    ff(['-y', '-i', video, '-i', wav, '-loop', '1', '-i', png,
      '-filter_complex', `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,eq=brightness=-0.05[base];[base][2:v]overlay=0:0[v]`,
      '-map', '[v]', '-map', '1:a', '-t', String(SEG), '-r', '30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', out])
    const secs = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out]).toString().trim()
    console.log(`\n✓ ${out}\n  ${kit.name} score over ${basename(video)} · ${(+secs).toFixed(0)}s · 1080x1920`)
  } finally { rmSync(tmp, { recursive: true, force: true }) }
}
main().catch(e => { console.error(e.message || e); process.exit(1) })
