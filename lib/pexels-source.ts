// Fetch background videos from the Pexels API and tag them as they come in — we keep only the
// stream link + tags (never the file). Brightness is measured from the poster (one frame) with
// sharp; speed defaults to 'standard' (can't measure motion without the video — correct it in the
// admin). Category comes from the search query. Runs server-side (admin route / script).
import sharp from 'sharp'
import type { PexelsBg, Brightness } from '@/lib/pexels-bg'

const key = () => process.env.PEXELS_API_KEY || ''

// Aesthetic query pool → our category, for "fetch random". Admin can also type any query.
export const QUERY_POOL: { q: string; category: string }[] = [
  { q: 'ink in water', category: 'Abstract' }, { q: 'paint mixing', category: 'Abstract' },
  { q: 'liquid marble', category: 'Abstract' }, { q: 'colored smoke', category: 'Abstract' },
  { q: 'oil water macro', category: 'Abstract' }, { q: 'fluid art', category: 'Abstract' },
  { q: 'neon lights', category: 'Neon' }, { q: 'neon tunnel', category: 'Neon' }, { q: 'laser lights', category: 'Neon' },
  { q: 'bokeh lights', category: 'Light' }, { q: 'light leaks', category: 'Light' }, { q: 'glitter', category: 'Light' },
  { q: 'film grain', category: 'Film' }, { q: 'projector', category: 'Film' }, { q: 'old film', category: 'Film' },
  { q: 'city night', category: 'Night' }, { q: 'rainy neon street', category: 'Night' }, { q: 'night highway', category: 'Night' },
  { q: 'forest', category: 'Nature' }, { q: 'autumn leaves', category: 'Nature' }, { q: 'underwater', category: 'Nature' },
  { q: 'ocean waves', category: 'Beach' }, { q: 'beach sunset', category: 'Beach' },
  { q: 'aerial mountains', category: 'Aerial' }, { q: 'aerial coastline', category: 'Aerial' },
  { q: 'fireplace', category: 'Cozy' }, { q: 'rain on window', category: 'Cozy' }, { q: 'coffee steam', category: 'Cozy' },
  { q: 'starry sky', category: 'Ambient' }, { q: 'aurora', category: 'Ambient' }, { q: 'clouds timelapse', category: 'Ambient' },
]

interface PexelsVideoFile { quality: string; file_type: string; width: number; height: number; link: string }
interface PexelsVideo { id: number; width: number; height: number; duration: number; image: string; user?: { name: string; url: string }; video_files: PexelsVideoFile[] }

// Prefer an mp4 nearest 1080p (good quality, not huge).
function bestMp4(v: PexelsVideo): string | null {
  const mp4 = (v.video_files || []).filter(f => f.file_type === 'video/mp4' && f.link)
  if (!mp4.length) return null
  return mp4.sort((a, b) => Math.abs((a.height || 0) - 1080) - Math.abs((b.height || 0) - 1080))[0].link
}

async function posterBrightness(url: string): Promise<Brightness> {
  try {
    const r = await fetch(url); if (!r.ok) return 'mid'
    const buf = Buffer.from(await r.arrayBuffer())
    const s = await sharp(buf).resize(48, 27, { fit: 'inside' }).stats()
    const [rc, gc, bc] = s.channels
    const luma = 0.2126 * rc.mean + 0.7152 * gc.mean + 0.0722 * bc.mean   // Rec.709, 0–255
    return luma < 64 ? 'dark' : luma >= 132 ? 'bright' : 'mid'
  } catch { return 'mid' }
}

export async function fetchAndTag(opts: { query: string; category?: string; count?: number; page?: number }): Promise<PexelsBg[]> {
  if (!key()) throw new Error('PEXELS_API_KEY not set')
  const per = Math.min(30, Math.max(1, opts.count ?? 12))
  const url = `https://api.pexels.com/videos/search?query=${encodeURIComponent(opts.query)}&per_page=${per}&page=${opts.page ?? 1}&orientation=landscape&size=medium`
  const r = await fetch(url, { headers: { Authorization: key() } })
  if (!r.ok) throw new Error(`Pexels API ${r.status}`)
  const data = await r.json() as { videos?: PexelsVideo[] }
  const out: PexelsBg[] = []
  for (const v of data.videos ?? []) {
    const mp4 = bestMp4(v); if (!mp4) continue
    const brightness = await posterBrightness(v.image)
    out.push({
      id: `px-${v.id}`, pexelsId: v.id, title: opts.query, mp4, poster: v.image,
      width: v.width || 0, height: v.height || 0, duration: v.duration || 0,
      category: opts.category ?? 'Abstract', brightness, speed: 'standard',
      tags: Array.from(new Set(opts.query.toLowerCase().split(/\s+/).filter(Boolean).concat(opts.category ? [opts.category.toLowerCase()] : []))),
      author: v.user?.name ?? '', authorUrl: v.user?.url ?? '', status: 'active',
    })
  }
  return out
}
