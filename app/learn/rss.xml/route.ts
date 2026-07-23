import { getArticles } from '@/lib/learn-articles'

// RSS 2.0 feed for the Learn section — lets readers, newsletters, and
// aggregators subscribe to new guides. Route Handlers aren't cached by default
// in this Next, and the article list is DB/fs-backed (dynamic), so rather than
// force static rendering we compute per request and let the CDN hold it for an
// hour via s-maxage. That way a scheduled guide joins the feed the hour it
// publishes, with no deploy — same cadence as the sitemap.

const BASE = 'https://100lights.com'

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export async function GET() {
  const published = (await getArticles({ includeDrafts: false }))
    .slice()
    .sort((a, b) => (b.updated ?? b.date).localeCompare(a.updated ?? a.date))

  const items = published
    .map(a => {
      const url = `${BASE}/learn/${a.slug}`
      return `    <item>
      <title>${escapeXml(a.title)}</title>
      <link>${url}</link>
      <guid isPermaLink="true">${url}</guid>
      <description>${escapeXml(a.description)}</description>
      <pubDate>${new Date(a.updated ?? a.date).toUTCString()}</pubDate>
    </item>`
    })
    .join('\n')

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>100Lights — Learn</title>
    <link>${BASE}/learn</link>
    <atom:link href="${BASE}/learn/rss.xml" rel="self" type="application/rss+xml"/>
    <description>Guides on making music in your browser — beats, mixing, chords, recording, and sound design.</description>
    <language>en-us</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${items}
  </channel>
</rss>`

  return new Response(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    },
  })
}
