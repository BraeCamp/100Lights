// Generate the POOL of AI background images ONCE per genre and cache them in R2, so every song's video
// reuses them → $0 AI per video (the "generate once, reuse forever" bake-out for visuals). Uses
// Replicate flux-schnell (a few cents total). Run:
//   node scripts/generate-bg-pool.mjs --dry              # print the prompts, generate nothing (free)
//   node scripts/generate-bg-pool.mjs                    # generate N per genre → R2
//   node scripts/generate-bg-pool.mjs --n=2 --genres=lofi,synthwave
// Needs REPLICATE_API_TOKEN + R2_* in .env.local.
import { readFileSync } from 'node:fs'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'

const env = {}
for (const l of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
const argv = process.argv.slice(2)
const DRY = argv.includes('--dry')
const N = Number((argv.find(a => a.startsWith('--n=')) || '--n=3').split('=')[1]) || 3
const only = (argv.find(a => a.startsWith('--genres=')) || '').split('=')[1]?.split(',').filter(Boolean)

// genre id → a VISUAL mood prompt (the musical feel translated into imagery). Abstract, no text/people.
const VISUAL = {
  house: 'vibrant club lights, warm energetic gradient bokeh',
  'deep-house': 'warm dusk gradient, soft jazzy haze, gentle bokeh',
  techno: 'dark industrial concrete, cold blue-grey fog, minimal',
  trance: 'euphoric sky, aurora light rays, uplifting glow',
  dnb: 'fast neon light streaks, dark urban motion blur',
  dubstep: 'heavy dark energy, glitchy fractured neon',
  trap: 'moody dark purple haze, sparse smoke, night city',
  boombap: 'dusty vintage soul, warm brown tones, old paper texture',
  lofi: 'cozy warm room, soft sunset, rainy window, muted pastel',
  'future-bass': 'bright candy gradient, dreamy pastel clouds',
  synthwave: 'retro 80s neon grid horizon, magenta and cyan sunset',
  ambient: 'ethereal misty landscape, soft fog, calm pale light',
  rock: 'gritty stage, dramatic spotlight, dark energy',
  pop: 'bright colorful confetti bokeh, cheerful gradient',
  rnb: 'smooth velvet purple, soft candlelight, intimate',
  funk: 'groovy retro 70s warm orange, disco shapes',
  reggaeton: 'tropical night neon, palm silhouettes, warm',
  'bossa-nova': 'gentle beach dusk, soft warm pastel, calm sea',
  afrobeat: 'vibrant warm earth tones, layered pattern, sunlit',
  disco: 'sparkling mirror-ball light, colorful retro glitter',
}
const genres = (only?.length ? Object.keys(VISUAL).filter(g => only.includes(g)) : Object.keys(VISUAL))

const s3 = new S3Client({
  region: 'auto', endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
})

async function flux(prompt) {
  const res = await fetch('https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.REPLICATE_API_TOKEN}`, 'Content-Type': 'application/json', Prefer: 'wait' },
    body: JSON.stringify({ input: { prompt, aspect_ratio: '9:16', output_format: 'webp', num_outputs: 1 } }),
  })
  const j = await res.json()
  if (j.error) throw new Error(typeof j.error === 'string' ? j.error : JSON.stringify(j.error))
  const out = Array.isArray(j.output) ? j.output[0] : j.output
  if (!out) throw new Error('no output from replicate')
  return out
}

let ok = 0, fail = 0
for (const g of genres) {
  for (let i = 0; i < N; i++) {
    const prompt = `${VISUAL[g]}, abstract background artwork, no text, no words, no people, cinematic, high quality, vertical`
    if (DRY) { console.log(`[dry] bg-pool/${g}/${i}.webp  ←  ${prompt}`); continue }
    try {
      const url = await flux(prompt)
      const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer())
      const key = `bg-pool/${g}/${i}.webp`
      await s3.send(new PutObjectCommand({ Bucket: env.R2_BUCKET, Key: key, Body: bytes, ContentType: 'image/webp' }))
      console.log(`✓ ${key} (${(bytes.length / 1024) | 0} KB)`); ok++
    } catch (e) { console.error(`✗ bg-pool/${g}/${i}: ${e.message}`); fail++ }
  }
}
if (!DRY) console.log(`\ndone — ${ok} uploaded, ${fail} failed. Pool at bg-pool/<genre>/ in R2 (reused across every video).`)
