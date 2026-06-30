import { sql } from '@/lib/db'
import { presignDownload } from '@/lib/r2'
import type { CfProjFile, SerializedAudioMedia } from '@/lib/project-serializer'

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function toRfc2822(dateStr: string): string {
  return new Date(dateStr).toUTCString()
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const rows = await sql`
    SELECT p.id, p.data, p.saved_at, p.owner_username
    FROM projects p
    INNER JOIN podcast_feeds pf ON pf.project_id = p.id
    WHERE p.id = ${id} AND p.deleted_at IS NULL
  `

  if (rows.length === 0) {
    return new Response('Not Found', { status: 404 })
  }

  const row = rows[0]
  const data = row.data as CfProjFile
  if (data.audioMode !== 'podcast') {
    return new Response('Not Found', { status: 404 })
  }

  const meta = data.podcastMeta
  const showName     = meta?.showName     ?? data.name ?? 'Untitled Show'
  const episodeTitle = meta?.episodeTitle ?? data.name ?? 'Untitled Episode'
  const description  = meta?.description ?? ''
  const host         = meta?.host ?? (row.owner_username as string) ?? ''
  const guests       = meta?.guests ?? ''
  const allAuthors   = [host, ...guests.split(',').map((g: string) => g.trim())].filter(Boolean).join(', ')
  const websiteUrl   = meta?.websiteUrl ?? ''
  const explicit     = meta?.explicit ? 'yes' : 'no'
  const episodeType  = meta?.episodeType ?? 'full'
  const savedAt      = (row.saved_at as string) ?? data.savedAt ?? new Date().toISOString()
  const pubDate      = toRfc2822(savedAt)

  // Get the first audio media item's R2 key
  const audioMedia: SerializedAudioMedia[] = data.audioMedia ?? []
  let enclosureUrl = ''
  if (audioMedia.length > 0 && audioMedia[0].r2Key) {
    // 24-hour signed URL — long enough for a podcast platform to fetch
    enclosureUrl = await presignDownload(audioMedia[0].r2Key, 86400)
  }

  // Build optional tags
  const seasonTag        = meta?.season != null ? `\n      <itunes:season>${meta.season}</itunes:season>` : ''
  const episodeNumberTag = meta?.episodeNumber != null ? `\n      <itunes:episode>${meta.episodeNumber}</itunes:episode>` : ''
  const imageTag         = meta?.artwork
    ? `\n    <itunes:image href="${escapeXml(websiteUrl + '/artwork.jpg')}"/>`
    : ''
  const websiteTag       = websiteUrl ? `\n    <link>${escapeXml(websiteUrl)}</link>` : ''
  const categoryTags     = (meta?.tags ?? '')
    .split(',')
    .map((t: string) => t.trim())
    .filter(Boolean)
    .map((t: string) => `\n    <itunes:category text="${escapeXml(t)}"/>`)
    .join('')

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>${escapeXml(showName)}</title>
    <description>${escapeXml(description)}</description>
    <itunes:author>${escapeXml(allAuthors || host)}</itunes:author>
    <itunes:explicit>${explicit}</itunes:explicit>${imageTag}${websiteTag}${categoryTags}
    <item>
      <title>${escapeXml(episodeTitle)}</title>
      <description>${escapeXml(description)}</description>
      <itunes:author>${escapeXml(allAuthors || host)}</itunes:author>
      <itunes:episodeType>${episodeType}</itunes:episodeType>${seasonTag}${episodeNumberTag}
      <itunes:explicit>${explicit}</itunes:explicit>
      <enclosure url="${escapeXml(enclosureUrl)}" length="0" type="audio/webm"/>
      <guid isPermaLink="false">${escapeXml(id)}</guid>
      <pubDate>${pubDate}</pubDate>
      <itunes:duration>0</itunes:duration>
    </item>
  </channel>
</rss>`

  return new Response(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}
