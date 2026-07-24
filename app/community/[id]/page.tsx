import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import { sql } from '@/lib/db'
import { ensureTables, rowToItem } from '@/lib/community-server'
import type { CommunityItem } from '@/lib/community'
import { ItemClient } from './ItemClient'

// Public share page for one community item. No account needed to listen —
// this is the link people paste into chats, and the OG tags make it unfurl
// with a waveform card.

export const runtime = 'nodejs'
// ISR: a shared item's content is effectively static (votes/downloads load
// client-side). Cache the rendered page an hour instead of hitting the DB on
// every crawler visit across ~hundreds of item URLs.
export const revalidate = 3600

// cache() dedupes the two fetches per render (generateMetadata + the page).
const fetchItem = cache(async (id: string) => {
  await ensureTables()
  try {
    const rows = await sql`SELECT * FROM community_items WHERE id = ${id}`
    return rows[0] ?? null
  } catch {
    return null  // malformed uuid etc.
  }
})

const KIND_LABEL: Record<string, string> = {
  song: 'Song', sample: 'Sample', preset: 'Preset', recipe: 'Recipe', pack: 'Sample pack', project: 'Project starter', theme: 'Theme', kit: 'Drum kit', pattern: 'Beat pattern', post: 'Post',
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const item = await fetchItem(id)
  if (!item) return { title: 'Not found' }
  const kind = item.kind as string
  const kindLabel = KIND_LABEL[kind] ?? 'Share'
  const isPost = kind === 'post'
  const title = isPost
    ? `${item.name} — 100Lights Community`
    : `${item.name} — ${kindLabel} by ${item.author_name}`
  const description = (item.description as string)
    || (isPost ? `A post by ${item.author_name} on 100Lights Community.` : `Listen to this ${kindLabel.toLowerCase()} on 100Lights Community — no account needed.`)
  return {
    title,
    description,
    alternates: { canonical: `https://100lights.com/community/${id}` },
    openGraph: { title, description, type: isPost ? 'article' : 'music.song', siteName: '100Lights Community', url: `https://100lights.com/community/${id}` },
    twitter: { card: 'summary_large_image', title, description },
  }
}

export default async function CommunityItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const item = await fetchItem(id)
  if (!item) notFound()
  // Structured data: text posts are Articles; everything else is a
  // MusicRecording so search results carry the author + rich snippets.
  const datePublished = item.created_at ? new Date(item.created_at as string).toISOString().slice(0, 10) : undefined
  const jsonLd = item.kind === 'post'
    ? {
        '@context': 'https://schema.org',
        '@type': 'Article',
        headline: item.name,
        author: { '@type': 'Person', name: item.author_name },
        datePublished,
        url: `https://100lights.com/community/${id}`,
        ...(item.description ? { articleBody: item.description } : {}),
      }
    : {
        '@context': 'https://schema.org',
        '@type': 'MusicRecording',
        name: item.name,
        byArtist: { '@type': 'Person', name: item.author_name },
        datePublished,
        url: `https://100lights.com/community/${id}`,
        ...(item.description ? { description: item.description } : {}),
      }
  const initialItem = rowToItem(item, null, new Set<string>(), new Map(), new Map()) as unknown as CommunityItem
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <ItemClient id={id} initialItem={initialItem} />
    </>
  )
}
