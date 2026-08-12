#!/usr/bin/env node
// Frame-samples every background clip to tag TWO attributes, deterministically (non-AI):
//   • brightness (bright / mid / dark) — flash-aware: the mean luma sets the level, but a clip
//     with bright FLASHES (high per-frame peak) never counts as "dark", so the dark-room filter
//     is honest. Falls back to the poster (sharp) when a clip has no local video file.
//   • speed     (fast / standard / slow) — mean inter-frame change (motion). Slow, low-movement
//     clips (ink in water, lava lamp, drifting colour) are what the idle/"between-songs"
//     transition mode plays until music is detected.
// Writes lib/bg-brightness.ts (BRIGHTNESS_MAP) and lib/bg-motion.ts (MOTION_MAP + TRANSITION_CLIPS).
//
//   node scripts/tag-bg-clips.mjs --dry     # print the measured distributions, write nothing
//   node scripts/tag-bg-clips.mjs           # write both maps
//
// Uses ffmpeg signalstats (luma) + tblend=difference (motion). Values are 0–255.
import sharp from 'sharp'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, writeFile, unlink, access, readdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const exec = promisify(execFile)
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const TMP = process.env.CLAUDE_JOB_DIR ? join(process.env.CLAUDE_JOB_DIR, 'tmp') : '/tmp'
const DRY = process.argv.includes('--dry')
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? Number(process.argv[i + 1]) : d }

// Brightness thresholds (mean luma 0–255) + the flash guard (peak whole-frame luma).
const DARK_MEAN = arg('--dark', 64), BRIGHT_MEAN = arg('--bright', 132)
const DARK_SAFE_PEAK = arg('--dark-peak', 105)  // a "dark" clip must never brighten past this
const FLASH_PEAK = arg('--flash', 190)           // this bright a flash forces 'bright' regardless of mean
// Motion thresholds (mean inter-frame luma change 0–255).
const SLOW_MAX = arg('--slow', 4), FAST_MIN = arg('--fast', 12)

const exists = async p => { try { await access(p); return true } catch { return false } }
// Enumerate clips from disk: id universe = every bundled poster; a clip is a "video" if it has
// a local .mp4/.webm to sample (else poster-only). Mirrors how bg-library resolves srcs.
const POSTER_DIRS = ['public/bg/nature', 'public/bg/generative']
async function firstExisting(cands) { for (const c of cands) if (await exists(join(ROOT, c))) return join(ROOT, c); return null }
async function enumerate() {
  const ids = new Set()
  for (const d of POSTER_DIRS) { try { (await readdir(join(ROOT, d))).filter(f => f.endsWith('.jpg')).forEach(f => ids.add(f.replace(/\.jpg$/, ''))) } catch { /* dir missing */ } }
  const out = []
  for (const id of ids) {
    const video = await firstExisting([`public/bg/nature/${id}.mp4`, `public/bg/nature/${id}.webm`, `public/bg/generative/${id}.webm`])
    const poster = await firstExisting([`public/bg/nature/${id}.jpg`, `public/bg/generative/${id}.jpg`])
    out.push({ id, video, poster })
  }
  return out
}

async function signalYs(file, motion) {
  // Sample ~5s at 4fps, tiny scale; optionally diff successive frames for motion.
  const out = join(TMP, `sig-${motion ? 'm' : 'b'}-${Buffer.from(file).toString('base64url').slice(-24)}.txt`)
  const vf = `fps=4,scale=48:27${motion ? ',tblend=all_mode=difference' : ''},signalstats,metadata=print:file=${out}`
  try {
    await exec('ffmpeg', ['-hide_banner', '-nostats', '-loglevel', 'error', '-i', file, '-vf', vf, '-frames:v', '20', '-an', '-f', 'null', '-'], { timeout: 60000 })
    const txt = await readFile(out, 'utf8')
    await unlink(out).catch(() => {})
    const yavg = [...txt.matchAll(/YAVG=([\d.]+)/g)].map(m => +m[1])
    const ymax = [...txt.matchAll(/YMAX=([\d.]+)/g)].map(m => +m[1])
    return { yavg, ymax }
  } catch { await unlink(out).catch(() => {}); return { yavg: [], ymax: [] } }
}

async function measure(clip) {
  if (clip.video) {
    const b = await signalYs(clip.video, false)
    if (b.yavg.length) {
      const mean = b.yavg.reduce((a, c) => a + c, 0) / b.yavg.length
      const peak = Math.max(...b.yavg)                          // brightest whole-frame moment (flash)
      const m = await signalYs(clip.video, true)
      const motion = m.yavg.length ? m.yavg.reduce((a, c) => a + c, 0) / m.yavg.length : null
      return { id: clip.id, mean, peak, motion, src: 'video' }
    }
  }
  // Fallback: poster only (no local video / decode failed) → brightness from the still, no motion.
  if (clip.poster) {
    try {
      const s = await sharp(clip.poster).resize(48, 27, { fit: 'inside' }).stats()
      const [r, g, gb] = s.channels
      const mean = 0.2126 * r.mean + 0.7152 * g.mean + 0.0722 * gb.mean
      return { id: clip.id, mean, peak: mean, motion: null, src: 'poster' }
    } catch { /* skip */ }
  }
  return null
}

const brightBucket = ({ mean, peak }) =>
  (mean >= BRIGHT_MEAN || peak >= FLASH_PEAK) ? 'bright'
    : (mean < DARK_MEAN && peak < DARK_SAFE_PEAK) ? 'dark'
      : 'mid'
const speedBucket = m => m == null ? 'standard' : m < SLOW_MAX ? 'slow' : m >= FAST_MIN ? 'fast' : 'standard'

// Measure with limited concurrency (ffmpeg is CPU-bound).
const clips = await enumerate()
const rows = []
const POOL = 6
let idx = 0
await Promise.all(Array.from({ length: POOL }, async () => {
  while (idx < clips.length) {
    const c = clips[idx++]
    const r = await measure(c)
    if (r) rows.push(r)
    if (!DRY) process.stderr.write(`\r  measured ${rows.length}/${clips.length}`)
  }
}))
if (!DRY) process.stderr.write('\n')

const brightness = {}, motion = {}
for (const r of rows) { brightness[r.id] = brightBucket(r); motion[r.id] = speedBucket(r.motion) }

// Transition clips for idle mode: LOW-MOVEMENT scenes that drift quietly between songs
// (brightness is a SEPARATE filter — the dark-room control intersects on top, so a bright but
// slow clip like ink-in-water is still a valid transition, just not in dark mode). Sorted
// slowest-first; a hand-picked seed of the nicest calm scenes floats to the front.
const SEED = ['artsy-ink-water', 'artsy-marble-ink', 'artsy-silk', 'artsy-mercury', 'artsy-acrylic-pour', 'artsy-alcohol-ink', 'artsy-water-caustics', 'cozy-coffee', 'cozy-tea', 'cozy-rain-window']
const measured = new Set(rows.map(r => r.id))
const calm = rows.filter(r => motion[r.id] === 'slow').sort((a, b) => (a.motion ?? 99) - (b.motion ?? 99)).map(r => r.id)
const transition = [...SEED.filter(id => measured.has(id)), ...calm.filter(id => !SEED.includes(id))]

if (DRY) {
  const sortB = [...rows].sort((a, b) => a.mean - b.mean)
  const sortM = [...rows].filter(r => r.motion != null).sort((a, b) => a.motion - b.motion)
  console.log('BRIGHTNESS (mean/peak):')
  for (const r of sortB) console.log(`  ${brightBucket(r).padEnd(6)} mean=${r.mean.toFixed(0).padStart(3)} peak=${r.peak.toFixed(0).padStart(3)} ${r.src === 'poster' ? '[poster] ' : ''}${r.id}`)
  console.log('\nSPEED (motion):')
  for (const r of sortM) console.log(`  ${speedBucket(r.motion).padEnd(8)} ${r.motion.toFixed(1).padStart(5)}  ${r.id}`)
  const cB = { dark: 0, mid: 0, bright: 0 }, cM = { slow: 0, standard: 0, fast: 0 }
  rows.forEach(r => { cB[brightBucket(r)]++; cM[speedBucket(r.motion)]++ })
  console.log(`\n${rows.length} clips`)
  console.log(`brightness → dark ${cB.dark} · mid ${cB.mid} · bright ${cB.bright}   (dark<${DARK_MEAN}&peak<${DARK_SAFE_PEAK}, bright>=${BRIGHT_MEAN}|peak>=${FLASH_PEAK})`)
  console.log(`speed      → slow ${cM.slow} · standard ${cM.standard} · fast ${cM.fast}   (slow<${SLOW_MAX}, fast>=${FAST_MIN})`)
  console.log(`transition clips: ${transition.length}`)
  process.exit(0)
}

const brBody = `// AUTO-GENERATED by scripts/tag-bg-clips.mjs — do not edit by hand.
// Flash-aware perceptual brightness of each background clip (sampled across video frames, 0–255
// luma). "dark" requires a low mean AND no bright flashes, so the dark-room filter is honest.
// Regenerate after adding clips: npm run bg:tag
export type Brightness = 'bright' | 'mid' | 'dark'
export const BRIGHTNESS_MAP: Record<string, Brightness> = ${JSON.stringify(brightness, null, 2)}
`
const moBody = `// AUTO-GENERATED by scripts/tag-bg-clips.mjs — do not edit by hand.
// Motion/speed of each clip = mean inter-frame change (0–255). Slow, low-movement clips are the
// calm scenes the idle/"between-songs" transition mode plays until music is detected.
// Regenerate after adding clips: npm run bg:tag
export type Speed = 'fast' | 'standard' | 'slow'
export const MOTION_MAP: Record<string, Speed> = ${JSON.stringify(motion, null, 2)}
// Calm scenes for idle mode (slow + not bright), slowest first, hand-picked seeds first.
export const TRANSITION_CLIPS: string[] = ${JSON.stringify(transition, null, 2)}
`
await writeFile(join(ROOT, 'lib/bg-brightness.ts'), brBody)
await writeFile(join(ROOT, 'lib/bg-motion.ts'), moBody)
const cB = { dark: 0, mid: 0, bright: 0 }, cM = { slow: 0, standard: 0, fast: 0 }
rows.forEach(r => { cB[brightBucket(r)]++; cM[speedBucket(r.motion)]++ })
console.log(`Wrote lib/bg-brightness.ts + lib/bg-motion.ts · ${rows.length} clips`)
console.log(`  brightness: dark ${cB.dark} · mid ${cB.mid} · bright ${cB.bright}`)
console.log(`  speed: slow ${cM.slow} · standard ${cM.standard} · fast ${cM.fast} · transition ${transition.length}`)
