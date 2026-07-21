import type { MetadataRoute } from 'next'
import { sql } from '@/lib/db'
import { getArticles } from '@/lib/learn-articles'

// Community items are the long-tail SEO surface: every shared sample, recipe,
// and song is a public, playable page with its own OG card. Fragments (#…)
// are omitted — crawlers ignore them.
// Rebuild hourly. Scheduled articles publish themselves without a deploy, so
// a fully static sitemap would keep advertising yesterday's set and newly
// live guides would go undiscovered until someone shipped code.
export const revalidate = 3600

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = 'https://100lights.com'
  const staticPages: MetadataRoute.Sitemap = [
    { url: base,                    lastModified: new Date(), changeFrequency: 'weekly',  priority: 1 },
    { url: `${base}/community`,     lastModified: new Date(), changeFrequency: 'daily',   priority: 0.9 },
    { url: `${base}/sign-up`,       lastModified: new Date(), changeFrequency: 'monthly', priority: 0.9 },
    { url: `${base}/download`,      lastModified: new Date(), changeFrequency: 'monthly', priority: 0.7 },
    { url: `${base}/tools`,                     lastModified: new Date(), changeFrequency: 'monthly', priority: 0.8 },
    { url: `${base}/tools/tuner`,               lastModified: new Date(), changeFrequency: 'monthly', priority: 0.8 },
    { url: `${base}/tools/metronome`,           lastModified: new Date(), changeFrequency: 'monthly', priority: 0.8 },
    // Per-tempo metronome pages (40–220 BPM) — each targets a "N bpm metronome"
    // search. Lower priority than the hubs but a broad long-tail surface.
    ...Array.from({ length: 220 - 40 + 1 }, (_, i) => ({
      url: `${base}/tools/metronome/${40 + i}`,
      lastModified: new Date(), changeFrequency: 'yearly' as const, priority: 0.5,
    })),
    { url: `${base}/tools/chord-progressions`,  lastModified: new Date(), changeFrequency: 'monthly', priority: 0.8 },
    { url: `${base}/sign-in`,       lastModified: new Date(), changeFrequency: 'monthly', priority: 0.5 },
    { url: `${base}/legal/terms`,   lastModified: new Date(), changeFrequency: 'yearly',  priority: 0.3 },
    { url: `${base}/legal/privacy`, lastModified: new Date(), changeFrequency: 'yearly',  priority: 0.3 },
  ]

  // Learn guides — published only; the index page joins once one is live
  const published = await getArticles({ includeDrafts: false })
  const learn: MetadataRoute.Sitemap = published.length === 0 ? [] : [
    { url: `${base}/learn`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.8 },
    ...published.map(a => ({
      url: `${base}/learn/${a.slug}`,
      lastModified: new Date(a.updated ?? a.date),
      changeFrequency: 'monthly' as const,
      priority: 0.7,
    })),
  ]

  let items: MetadataRoute.Sitemap = []
  try {
    const rows = await sql`
      SELECT id, created_at FROM community_items
      ORDER BY created_at DESC LIMIT 500
    `
    items = rows.map(r => ({
      url: `${base}/community/${r.id}`,
      lastModified: new Date(r.created_at as string),
      changeFrequency: 'monthly' as const,
      priority: 0.6,
    }))
  } catch { /* DB unavailable — static pages still ship */ }

  return [...staticPages, ...learn, ...items]
}
