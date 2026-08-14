// Maps a source track URL (incompetech / Scott Buckley / Jamendo / …) → a PUBLIC Cloudflare R2 mirror
// URL. Filled by scripts/bake-radio-r2.mjs. The broadcast playlist route swaps mirrored URLs in and
// flags them `direct`, so the CLIENT fetches straight from R2's CDN (CORS-enabled, zero egress to us)
// instead of our metered /api/broadcast/audio proxy — and the 24/7 streamer pulls from R2 too. Tracks
// that aren't mirrored yet keep proxying: mirroring is incremental and never blocks playback.
import { sql } from '@/lib/db'

let ready = false
async function ensure() {
  if (ready) return
  await sql`
    CREATE TABLE IF NOT EXISTS radio_audio_mirror (
      src_url    TEXT PRIMARY KEY,
      r2_url     TEXT NOT NULL,
      r2_key     TEXT NOT NULL,
      bytes      BIGINT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`
  ready = true
}

/** For the given source URLs, return src → public-R2 URL for any that have been baked. Safe on a
 *  missing table / DB error (returns an empty map → callers just keep the original proxied URLs). */
export async function getMirrorMap(srcUrls: string[]): Promise<Map<string, string>> {
  const uniq = [...new Set(srcUrls.filter(u => /^https?:/i.test(u)))]
  if (!uniq.length) return new Map()
  try {
    await ensure()
    const rows = await sql`SELECT src_url, r2_url FROM radio_audio_mirror WHERE src_url = ANY(${uniq})`
    return new Map(rows.map(r => [String(r.src_url), String(r.r2_url)]))
  } catch {
    return new Map()
  }
}
