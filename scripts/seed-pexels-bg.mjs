#!/usr/bin/env node
// Bulk-seed the tagged Pexels background catalog (the pexels_bg table). Fetches videos from the
// Pexels API, tags each (poster brightness via sharp + category from the query), and stores ONLY
// the stream link + tags — never the video file. Same logic as the admin "Fetch" button, for bulk.
//
//   node scripts/seed-pexels-bg.mjs                 # ~8 random queries
//   node scripts/seed-pexels-bg.mjs "ink in water" Abstract 20
//   node scripts/seed-pexels-bg.mjs --rounds 20     # 20 random queries
//
// Needs PEXELS_API_KEY + DATABASE_URL in .env.local.
import sharp from 'sharp'
import { neon } from '@neondatabase/serverless'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
function env(name) {
  if (process.env[name]) return process.env[name].trim()
  try { const m = readFileSync(join(ROOT, '.env.local'), 'utf8').match(new RegExp(`^\\s*${name}\\s*=\\s*(.+)\\s*$`, 'm')); if (m) return m[1].trim().replace(/^["']|["']$/g, '') } catch {}
  return ''
}
const KEY = env('PEXELS_API_KEY'), DB = env('DATABASE_URL')
if (!KEY) { console.error('✗ No PEXELS_API_KEY in .env.local'); process.exit(1) }
if (!DB) { console.error('✗ No DATABASE_URL in .env.local'); process.exit(1) }
const sql = neon(DB)

const POOL = [
  ['ink in water', 'Abstract'], ['paint mixing', 'Abstract'], ['liquid marble', 'Abstract'], ['colored smoke', 'Abstract'],
  ['oil water macro', 'Abstract'], ['fluid art', 'Abstract'], ['acrylic pour', 'Abstract'], ['alcohol ink', 'Abstract'],
  ['iridescent', 'Abstract'], ['holographic', 'Abstract'], ['powder explosion', 'Abstract'], ['ferrofluid', 'Abstract'],
  ['soap bubbles', 'Abstract'], ['liquid metal', 'Abstract'], ['watercolor', 'Abstract'], ['prism light', 'Abstract'],
  ['bokeh lights', 'Light'], ['light leaks', 'Light'], ['glitter', 'Light'], ['lens flare', 'Light'], ['sparkles', 'Light'], ['string lights', 'Light'], ['disco ball', 'Light'],
  ['neon lights', 'Neon'], ['neon tunnel', 'Neon'], ['neon sign', 'Neon'], ['cyberpunk city', 'Neon'], ['neon grid', 'Neon'],
  ['film grain', 'Film'], ['projector', 'Film'], ['old film', 'Film'], ['super 8', 'Film'], ['vhs', 'Film'],
  ['city night', 'Night'], ['rainy neon street', 'Night'], ['night highway', 'Night'], ['city lights night', 'Night'], ['fireworks', 'Night'],
  ['forest', 'Nature'], ['autumn leaves', 'Nature'], ['underwater', 'Nature'], ['waterfall', 'Nature'], ['sunbeams forest', 'Nature'], ['flowers', 'Nature'], ['snow falling', 'Nature'],
  ['ocean waves', 'Beach'], ['beach sunset', 'Beach'], ['palm trees', 'Beach'], ['tropical beach', 'Beach'],
  ['aerial mountains', 'Aerial'], ['aerial coastline', 'Aerial'], ['aerial forest', 'Aerial'], ['aerial city', 'Aerial'], ['drone landscape', 'Aerial'],
  ['fireplace', 'Cozy'], ['rain on window', 'Cozy'], ['coffee steam', 'Cozy'], ['candles', 'Cozy'], ['cozy cafe', 'Cozy'], ['rain drops', 'Cozy'],
  ['starry sky', 'Ambient'], ['aurora', 'Ambient'], ['clouds timelapse', 'Ambient'], ['nebula', 'Ambient'], ['galaxy', 'Ambient'], ['sunset sky', 'Ambient'], ['northern lights', 'Ambient'],
  ['street market', 'Streets'], ['rainy street', 'Streets'], ['city street', 'Streets'], ['crosswalk', 'Streets'],
  ['city timelapse', 'City'], ['traffic trails', 'City'], ['skyscrapers', 'City'],
  ['geometric pattern', 'Patterns'], ['kaleidoscope', 'Patterns'], ['fractal', 'Patterns'], ['tunnel motion', 'Patterns'],
  ['misty mountains', 'Mountains'], ['mountain peaks', 'Mountains'], ['snowy mountains', 'Mountains'],
  ['jellyfish', 'Animals'], ['birds flying', 'Animals'], ['fish swimming', 'Animals'], ['water caustics', 'Nature'],
  // Wave 2 — more variety to push toward 10k unique.
  ['liquid crystal', 'Abstract'], ['motion blur lights', 'Abstract'], ['digital waves', 'Abstract'], ['plasma', 'Abstract'], ['energy waves', 'Abstract'], ['gradient flow', 'Abstract'], ['silk fabric', 'Abstract'], ['mercury', 'Abstract'], ['oil bubbles', 'Abstract'], ['chromatic', 'Abstract'], ['abstract loop', 'Abstract'], ['smoke trails', 'Abstract'],
  ['rainforest', 'Nature'], ['ocean surface', 'Nature'], ['coral reef', 'Nature'], ['lava', 'Nature'], ['sand dunes', 'Nature'], ['ice crystals', 'Nature'], ['dew drops', 'Nature'], ['bamboo', 'Nature'], ['cherry blossom', 'Nature'], ['lavender field', 'Nature'], ['wheat field', 'Nature'], ['river', 'Nature'], ['lake reflection', 'Nature'], ['fog', 'Nature'], ['moss', 'Nature'],
  ['milky way', 'Ambient'], ['star trails', 'Ambient'], ['moon', 'Ambient'], ['sunrise', 'Ambient'], ['twilight', 'Ambient'], ['storm clouds', 'Ambient'], ['lightning', 'Ambient'], ['pink sky', 'Ambient'],
  ['subway', 'City'], ['tokyo night', 'City'], ['bridge night', 'City'], ['harbor', 'City'], ['rooftop', 'City'], ['airport', 'City'], ['highway timelapse', 'City'],
  ['fiber optics', 'Light'], ['led wall', 'Light'], ['hologram', 'Light'], ['laser show', 'Neon'], ['ultraviolet', 'Neon'], ['prism rainbow', 'Light'], ['light rays', 'Light'], ['candlelight', 'Cozy'],
  ['bookshelf', 'Cozy'], ['vinyl record', 'Cozy'], ['warm lamp', 'Cozy'], ['snow window', 'Cozy'], ['tea cup', 'Cozy'],
  ['dancing silhouette', 'Streets'], ['crowd', 'Streets'], ['festival lights', 'Night'], ['concert', 'Night'], ['confetti', 'Night'],
  ['spiral', 'Patterns'], ['mandala', 'Patterns'], ['grid lines', 'Patterns'], ['waveform', 'Patterns'], ['particles floating', 'Patterns'], ['op art', 'Patterns'],
  ['foggy forest', 'Mountains'], ['mountain lake', 'Mountains'], ['alps', 'Mountains'], ['canyon', 'Mountains'], ['volcano', 'Mountains'],
  ['butterfly', 'Animals'], ['deer', 'Animals'], ['horses', 'Animals'], ['whale', 'Animals'],
]

async function ensure() {
  await sql`CREATE TABLE IF NOT EXISTS pexels_bg (
    id TEXT PRIMARY KEY, pexels_id BIGINT UNIQUE NOT NULL, title TEXT NOT NULL DEFAULT '', mp4 TEXT NOT NULL,
    poster TEXT NOT NULL DEFAULT '', width INT NOT NULL DEFAULT 0, height INT NOT NULL DEFAULT 0, duration INT NOT NULL DEFAULT 0,
    category TEXT NOT NULL DEFAULT 'Abstract', brightness TEXT NOT NULL DEFAULT 'mid', speed TEXT NOT NULL DEFAULT 'standard',
    tags TEXT[] NOT NULL DEFAULT '{}', author TEXT NOT NULL DEFAULT '', author_url TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active', added_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`
  await sql`CREATE INDEX IF NOT EXISTS pexels_bg_status_idx ON pexels_bg (status, category)`
}
const bestMp4 = v => (v.video_files || []).filter(f => f.file_type === 'video/mp4' && f.link)
  .sort((a, b) => Math.abs((a.height || 0) - 1080) - Math.abs((b.height || 0) - 1080))[0]?.link || null
async function brightnessOf(url) {
  try {
    const r = await fetch(url); if (!r.ok) return 'mid'
    const s = await sharp(Buffer.from(await r.arrayBuffer())).resize(48, 27, { fit: 'inside' }).stats()
    const [rc, gc, bc] = s.channels, luma = 0.2126 * rc.mean + 0.7152 * gc.mean + 0.0722 * bc.mean
    return luma < 64 ? 'dark' : luma >= 132 ? 'bright' : 'mid'
  } catch { return 'mid' }
}

// Returns { added, rate } — rate=true means Pexels 429'd (hourly limit); caller should stop.
async function fetchQuery(query, category, count, page, fast) {
  const url = `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=${count}&page=${page}&orientation=landscape&size=medium`
  let r
  try { r = await fetch(url, { headers: { Authorization: KEY } }) } catch { return { added: 0 } }
  if (r.status === 429) return { added: 0, rate: true }
  if (!r.ok) { console.error(`  ✗ Pexels ${r.status} for "${query}"`); return { added: 0 } }
  const { videos = [] } = await r.json()
  let added = 0
  for (const v of videos) {
    const mp4 = bestMp4(v); if (!mp4) continue
    const brightness = fast ? 'mid' : await brightnessOf(v.image)   // --fast skips the poster-luma step (backfill later)
    const tags = [...new Set(query.toLowerCase().split(/\s+/).concat(category.toLowerCase()))].filter(Boolean)
    const res = await sql`INSERT INTO pexels_bg (id, pexels_id, title, mp4, poster, width, height, duration, category, brightness, speed, tags, author, author_url, status)
      VALUES (${'px-' + v.id}, ${v.id}, ${query}, ${mp4}, ${v.image}, ${v.width || 0}, ${v.height || 0}, ${v.duration || 0}, ${category}, ${brightness}, 'standard', ${tags}, ${v.user?.name || ''}, ${v.user?.url || ''}, 'active')
      ON CONFLICT (pexels_id) DO NOTHING RETURNING id`
    if (res.length) added++
  }
  return { added }
}

const args = process.argv.slice(2)
const has = f => args.includes(f)
const argN = (f, d) => (has(f) ? Number(args[args.indexOf(f) + 1]) || d : d)
const fast = has('--fast')   // skip brightness for speed (bulk); backfill with a re-tag later
await ensure()
let total = 0
if (args[0] && !args[0].startsWith('--')) {
  const { added } = await fetchQuery(args[0], args[1] || 'Abstract', 30, 1, fast); total += added
  console.log(`"${args[0]}" → +${added}`)
} else if (has('--bulk')) {
  // Sweep the whole pool across pages (per_page 80). Pexels caps the API at ~200 req/hr, so a full
  // run to 10k spans a few sessions — it stops cleanly on a 429; just re-run to continue (dedup).
  const pages = argN('--pages', 3)
  let rate = false
  for (let p = 1; p <= pages && !rate; p++) {
    for (const [q, cat] of POOL) {
      const res = await fetchQuery(q, cat, 80, p, fast)
      if (res.rate) { rate = true; console.log(`\n  ⏳ Pexels rate limit hit — stopping. Re-run \`npm run bg:pexels -- --bulk${fast ? ' --fast' : ''}\` later to add more.`); break }
      total += res.added
      process.stdout.write(`\r  page ${p}/${pages} · ${q.slice(0, 16).padEnd(16)} · +${total} new   `)
    }
  }
  console.log('')
} else {
  const rounds = argN('--rounds', 8)
  const picks = [...POOL].sort(() => Math.random() - 0.5).slice(0, rounds)
  for (const [q, cat] of picks) {
    const { added } = await fetchQuery(q, cat, 12, 1 + Math.floor(Math.random() * 4), fast)
    total += added; console.log(`  ${q.padEnd(22)} (${cat}) → +${added}`)
  }
}
const [{ n }] = await sql`SELECT COUNT(*)::int AS n FROM pexels_bg WHERE status='active'`
console.log(`\nAdded ${total}. Catalog now ${n} active videos.`)
process.exit(0)
