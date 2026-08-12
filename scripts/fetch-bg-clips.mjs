#!/usr/bin/env node
// Fetch REAL nature footage for the Music Video background library from the Pexels Video API
// (free, permissive license — https://www.pexels.com/license/). For each nature clip it:
//   1. searches Pexels for an on-theme landscape clip,
//   2. downloads a ~HD source and transcodes to a web-optimized, muted, 1280×720 MP4 (+poster),
//   3. writes public/bg/nature/<id>.mp4 and <id>.jpg (overriding the procedural loop),
//   4. records the id in lib/bg-fetched.ts and the credit in public/bg/nature/CREDITS.json.
//
// Setup: put a free key in .env.local  →  PEXELS_API_KEY=xxxxxxxx   (get one at
// https://www.pexels.com/api/). Needs ffmpeg on PATH. Then:  npm run bg:fetch
//
// Re-running refreshes everything; pass ids to limit, e.g. `npm run bg:fetch -- beach-waves city-night`.

import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'public', 'bg', 'nature')
mkdirSync(OUT, { recursive: true })

// Search query per clip id (must match the NATURE list in lib/bg-library.ts).
const QUERIES = {
  'aerial-coastline': 'aerial coastline ocean cliffs',
  'aerial-forest': 'aerial forest canopy trees',
  'aerial-desert': 'aerial desert sand dunes',
  'beach-waves': 'ocean waves beach shore',
  'beach-sunset': 'beach sunset golden hour',
  'mountains-peaks': 'mountain peaks clouds drone',
  'mountains-valley': 'misty mountain valley fog',
  'animals-birds': 'flock of birds flying sky',
  'animals-jellyfish': 'jellyfish underwater ocean',
  'city-night': 'city skyline night lights',
  'city-timelapse': 'city traffic night timelapse',
  'street-golden': 'city street golden hour people walking',
  'street-crosswalk': 'people crossing busy street daytime',
  'street-cafe': 'outdoor cafe street people daytime',
  'night-streetlamps': 'street lamp people walking night',
  'night-neon': 'neon signs alley night city',
  'night-rain-neon': 'rainy street night neon reflections',
  'night-aurora': 'aurora borealis night sky',
  'cozy-rain-window': 'rain drops on window glass',
  'cozy-fireplace': 'cozy fireplace fire closeup',
  'cozy-coffee': 'coffee cup steam morning',
  'nature-sunbeams': 'sunlight rays through forest trees',
  'nature-flowers': 'wildflower field breeze sunny',
  'nature-clouds': 'clouds timelapse blue sky',
  'nature-underwater': 'underwater sunlight caustics ocean',
  // More per category
  'street-market2': 'busy street market people daytime',
  'street-rain-day': 'rainy street day umbrellas walking',
  'street-alley': 'narrow alley old town daytime',
  'night-highway': 'highway lights night long exposure',
  'night-bridge': 'bridge city lights night',
  'night-market': 'night market street food lights',
  'cozy-tea': 'tea cup steam cozy warm',
  'cozy-books': 'bookshelf library cozy reading',
  'cozy-snow-window': 'snow falling outside window',
  'nature-waterfall': 'waterfall forest slow motion',
  'nature-autumn': 'autumn leaves falling forest',
  'nature-desert-night': 'desert stars night timelapse',
  'aerial-mountains2': 'aerial mountain range drone',
  'aerial-ocean': 'aerial ocean waves drone',
  'beach-palm': 'palm trees beach breeze tropical',
  'beach-aerial': 'aerial tropical beach turquoise water',
  'mountains-snow': 'snowy mountains winter landscape',
  'mountains-lake': 'mountain lake reflection calm',
  'animals-fish': 'fish swimming coral reef underwater',
  'animals-deer': 'deer forest wildlife nature',
  'city-rooftop': 'city rooftop skyline view day',
  'city-aerial-traffic': 'aerial city intersection traffic',
}

// --- key ---------------------------------------------------------------------------------
function loadKey() {
  if (process.env.PEXELS_API_KEY) return process.env.PEXELS_API_KEY.trim()
  const envFile = join(ROOT, '.env.local')
  if (existsSync(envFile)) {
    const m = readFileSync(envFile, 'utf8').match(/^\s*PEXELS_API_KEY\s*=\s*(.+)\s*$/m)
    if (m) return m[1].replace(/^["']|["']$/g, '').trim()
  }
  return null
}
const KEY = loadKey()
if (!KEY) {
  console.error('✗ No PEXELS_API_KEY. Add `PEXELS_API_KEY=...` to .env.local (free key at https://www.pexels.com/api/).')
  process.exit(1)
}
try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }) }
catch { console.error('✗ ffmpeg not found on PATH. Install it (brew install ffmpeg) and retry.'); process.exit(1) }

// --- helpers -----------------------------------------------------------------------------
const only = process.argv.slice(2)
const ids = Object.keys(QUERIES).filter(id => !only.length || only.includes(id))

// Pick the best landscape mp4 file: highest width ≤ 1920, preferring the "hd" quality tier.
function bestFile(video) {
  const files = (video.video_files || []).filter(f => f.file_type === 'video/mp4' && f.width && f.height && f.width >= f.height)
  if (!files.length) return null
  const usable = files.filter(f => f.width <= 1920)
  const pool = usable.length ? usable : files
  return pool.sort((a, b) => (b.width - a.width) || (a.quality === 'hd' ? -1 : 1))[0]
}

async function pexelsSearch(query) {
  const url = `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&orientation=landscape&size=medium&per_page=12`
  const res = await fetch(url, { headers: { Authorization: KEY } })
  if (!res.ok) throw new Error(`Pexels ${res.status} ${res.statusText}`)
  const data = await res.json()
  return data.videos || []
}

async function download(url, dest) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`download ${res.status}`)
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()))
}

const credits = existsSync(join(OUT, 'CREDITS.json')) ? JSON.parse(readFileSync(join(OUT, 'CREDITS.json'), 'utf8')) : {}
const fetchedTs = join(ROOT, 'lib', 'bg-fetched.ts')
// Seed from the real .mp4 files already on disk, so a partial run never drops earlier clips.
const fetched = new Set(readdirSync(OUT).filter(f => f.endsWith('.mp4')).map(f => f.replace(/\.mp4$/, '')))

// --- run ---------------------------------------------------------------------------------
for (const id of ids) {
  const raw = join(tmpdir(), `bg-${id}-${process.pid}.mp4`)
  try {
    const videos = await pexelsSearch(QUERIES[id])
    // Prefer clips at least 8s long with a usable landscape file.
    const cand = videos.map(v => ({ v, f: bestFile(v) })).filter(x => x.f).sort((a, b) => (b.v.duration >= 8 ? 1 : 0) - (a.v.duration >= 8 ? 1 : 0))[0]
    if (!cand) { console.warn(`  – ${id}: no suitable clip, keeping procedural loop`); continue }

    await download(cand.f.link, raw)
    // Transcode: fill 1280×720, drop audio, ~12s, faststart for instant play; then a poster.
    execFileSync('ffmpeg', ['-y', '-i', raw, '-t', '12', '-an',
      '-vf', 'scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,fps=30',
      '-c:v', 'libx264', '-crf', '25', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart', join(OUT, `${id}.mp4`)], { stdio: 'ignore' })
    execFileSync('ffmpeg', ['-y', '-i', join(OUT, `${id}.mp4`), '-frames:v', '1', '-q:v', '4',
      join(OUT, `${id}.jpg`)], { stdio: 'ignore' })

    fetched.add(id)
    credits[id] = { photographer: cand.v.user?.name || 'Pexels', url: cand.v.url, source: 'Pexels' }
    console.log(`  ✓ ${id}  ← ${cand.v.user?.name || 'Pexels'} (${cand.f.width}×${cand.f.height})`)
  } catch (e) {
    console.warn(`  ✗ ${id}: ${e.message} — keeping procedural loop`)
  }
}

// --- write manifests ---------------------------------------------------------------------
const list = [...fetched].sort()
writeFileSync(fetchedTs,
  `// Auto-generated by scripts/fetch-bg-clips.mjs — nature clip ids that have real, hosted-\n` +
  `// quality footage bundled at public/bg/nature/<id>.mp4 (with a real <id>.jpg poster). Any id\n` +
  `// NOT listed here falls back to its procedural .webm loop. Do not edit by hand; re-run\n` +
  `// \`npm run bg:fetch\` to refresh.\n` +
  `export const FETCHED_NATURE: string[] = [${list.map(s => `'${s}'`).join(', ')}]\n`)
writeFileSync(join(OUT, 'CREDITS.json'), JSON.stringify(credits, null, 2) + '\n')

console.log(`\n✓ ${list.length} real clips bundled. Footage from Pexels (https://www.pexels.com/license/) — see public/bg/nature/CREDITS.json.`)
