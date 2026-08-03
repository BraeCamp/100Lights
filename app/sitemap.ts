import type { MetadataRoute } from 'next'
import { sql } from '@/lib/db'
import { getArticles } from '@/lib/learn-articles'
import { TUTORIALS } from '@/lib/tutorials'
import { LEARN_PATHS } from '@/lib/learn-paths'

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
    { url: `${base}/m`,             lastModified: new Date(), changeFrequency: 'monthly', priority: 0.7 },
    { url: `${base}/download`,      lastModified: new Date(), changeFrequency: 'monthly', priority: 0.7 },
    { url: `${base}/creators`,      lastModified: new Date(), changeFrequency: 'monthly', priority: 0.8 },
    { url: `${base}/tools`,                     lastModified: new Date(), changeFrequency: 'monthly', priority: 0.8 },
    { url: `${base}/tools/tuner`,               lastModified: new Date(), changeFrequency: 'monthly', priority: 0.8 },
    { url: `${base}/tools/metronome`,           lastModified: new Date(), changeFrequency: 'monthly', priority: 0.8 },
    { url: `${base}/tools/chord-progressions`,  lastModified: new Date(), changeFrequency: 'monthly', priority: 0.8 },
    { url: `${base}/tools/chord-identifier`,    lastModified: new Date(), changeFrequency: 'monthly', priority: 0.8 },
    { url: `${base}/tools/circle-of-fifths`,    lastModified: new Date(), changeFrequency: 'monthly', priority: 0.8 },
    { url: `${base}/tools/scales`,              lastModified: new Date(), changeFrequency: 'monthly', priority: 0.8 },
    { url: `${base}/tools/delay-calculator`,    lastModified: new Date(), changeFrequency: 'monthly', priority: 0.8 },
    { url: `${base}/tools/ear-training`,        lastModified: new Date(), changeFrequency: 'monthly', priority: 0.8 },
    { url: `${base}/tools/vocal-range`,         lastModified: new Date(), changeFrequency: 'monthly', priority: 0.8 },
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

  // Feature tutorials — a static, self-contained SEO surface (lib/tutorials.ts).
  // Only advertised once tutorials exist (mirrors the Learn/paths gating).
  const tutorials: MetadataRoute.Sitemap = TUTORIALS.length === 0 ? [] : [
    { url: `${base}/tutorial`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.7 },
    ...TUTORIALS.map(t => ({
      url: `${base}/tutorial/${t.slug}`,
      lastModified: new Date(),
      changeFrequency: 'monthly' as const,
      priority: 0.6,
    })),
  ]

  // Learning paths — ordered courses over the Learn guides (only once guides exist)
  const paths: MetadataRoute.Sitemap = published.length === 0 ? [] : [
    { url: `${base}/learn/paths`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.7 },
    ...LEARN_PATHS.map(p => ({
      url: `${base}/learn/paths/${p.slug}`,
      lastModified: new Date(),
      changeFrequency: 'monthly' as const,
      priority: 0.6,
    })),
  ]

  // Community SEO surface, curated rather than exhaustive. Instead of advertising
  // every item (up to 500 thin pages — slow to crawl, most can't rank), index:
  //  1. one rich CATEGORY HUB per kind that has enough content, and
  //  2. a value-ranked subset of items (official 100Lights content + items with
  //     real engagement). The long tail is left to noindex,follow (see the item
  //     page's generateMetadata) so crawl budget goes to pages that can rank.
  let items: MetadataRoute.Sitemap = []
  let categoryHubs: MetadataRoute.Sitemap = []
  let creatorPages: MetadataRoute.Sitemap = []
  try {
    const rows = await sql`
      SELECT id, created_at FROM community_items
      WHERE removed_at IS NULL
        AND (author_name = '100Lights' OR (votes + downloads) >= 3)
      ORDER BY (votes + downloads * 0.5 + 1) DESC
      LIMIT 60
    `
    items = rows.map(r => ({
      url: `${base}/community/${r.id}`,
      lastModified: new Date(r.created_at as string),
      changeFrequency: 'monthly' as const,
      priority: 0.6,
    }))
    const kinds = await sql`
      SELECT kind, MAX(created_at) AS last FROM community_items
      WHERE removed_at IS NULL
      GROUP BY kind
      HAVING COUNT(*) >= 3
    `
    categoryHubs = kinds.map(k => ({
      url: `${base}/community/browse/${k.kind as string}`,
      lastModified: new Date(k.last as string),
      changeFrequency: 'daily' as const,
      priority: 0.7,
    }))
    // Creator profiles — one rich page per active producer (≥2 shares).
    const creators = await sql`
      SELECT author_name, MAX(created_at) AS last FROM community_items
      WHERE removed_at IS NULL AND author_name <> 'Anonymous'
      GROUP BY author_name
      HAVING COUNT(*) >= 2
      LIMIT 200
    `
    creatorPages = creators.map(c => ({
      url: `${base}/community/creator/${encodeURIComponent(c.author_name as string)}`,
      lastModified: new Date(c.last as string),
      changeFrequency: 'weekly' as const,
      priority: 0.6,
    }))
  } catch { /* DB unavailable — static pages still ship */ }

  return [...staticPages, ...learn, ...paths, ...tutorials, ...categoryHubs, ...creatorPages, ...items]
}
