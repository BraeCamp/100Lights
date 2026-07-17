import type { MetadataRoute } from 'next'
import { sql } from '@/lib/db'

// Community items are the long-tail SEO surface: every shared sample, recipe,
// and song is a public, playable page with its own OG card. Fragments (#…)
// are omitted — crawlers ignore them.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = 'https://100lights.com'
  const staticPages: MetadataRoute.Sitemap = [
    { url: base,                    lastModified: new Date(), changeFrequency: 'weekly',  priority: 1 },
    { url: `${base}/community`,     lastModified: new Date(), changeFrequency: 'daily',   priority: 0.9 },
    { url: `${base}/sign-up`,       lastModified: new Date(), changeFrequency: 'monthly', priority: 0.9 },
    { url: `${base}/download`,      lastModified: new Date(), changeFrequency: 'monthly', priority: 0.7 },
    { url: `${base}/sign-in`,       lastModified: new Date(), changeFrequency: 'monthly', priority: 0.5 },
    { url: `${base}/legal/terms`,   lastModified: new Date(), changeFrequency: 'yearly',  priority: 0.3 },
    { url: `${base}/legal/privacy`, lastModified: new Date(), changeFrequency: 'yearly',  priority: 0.3 },
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

  return [...staticPages, ...items]
}
