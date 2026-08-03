import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import { sql } from '@/lib/db'
import { ensureTables, rowToItem, jsonLdScript } from '@/lib/community-server'
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
    // removed_at IS NULL: an admin-removed item must not keep rendering (with
    // full content + indexable meta) on its public share page.
    const rows = await sql`SELECT * FROM community_items WHERE id = ${id} AND removed_at IS NULL`
    return rows[0] ?? null
  } catch {
    return null  // malformed uuid etc.
  }
})

export interface RelatedItem { id: string; name: string; description: string; author_name: string; kind: string }

// Related items: prefer the same kind (value-ranked); backfill with recent items
// of any kind so the section is never empty. Server-rendered → the internal links
// are in the SSR HTML (good for crawling + keeps thin item pages linked).
const fetchRelated = cache(async (kind: string, excludeId: string): Promise<RelatedItem[]> => {
  await ensureTables()
  try {
    const same = await sql`
      SELECT id, name, description, author_name, kind FROM community_items
      WHERE kind = ${kind} AND id <> ${excludeId} AND removed_at IS NULL
      ORDER BY (votes + downloads * 0.5 + 1) DESC LIMIT 6
    ` as RelatedItem[]
    if (same.length >= 4) return same
    const seen = new Set([excludeId, ...same.map(r => r.id)])
    const more = await sql`
      SELECT id, name, description, author_name, kind FROM community_items
      WHERE id <> ${excludeId} AND removed_at IS NULL
      ORDER BY created_at DESC LIMIT 12
    ` as RelatedItem[]
    const filled = [...same]
    for (const r of more) { if (filled.length >= 6) break; if (!seen.has(r.id)) { filled.push(r); seen.add(r.id) } }
    return filled
  } catch {
    return []
  }
})

// Remix lineage: projects shared after opening THIS as a starter.
const fetchRemixes = cache(async (id: string): Promise<RelatedItem[]> => {
  await ensureTables()
  try {
    return await sql`
      SELECT id, name, description, author_name, kind FROM community_items
      WHERE remixed_from = ${id} AND removed_at IS NULL
      ORDER BY (votes + downloads * 0.5 + 1) DESC LIMIT 12
    ` as RelatedItem[]
  } catch {
    return []
  }
})

// The original this item was remixed FROM (backlink), if any.
const fetchSource = cache(async (sourceId: string | null): Promise<{ id: string; name: string; author_name: string } | null> => {
  if (!sourceId) return null
  await ensureTables()
  try {
    const rows = await sql`SELECT id, name, author_name FROM community_items WHERE id = ${sourceId} AND removed_at IS NULL LIMIT 1`
    return (rows[0] as { id: string; name: string; author_name: string }) ?? null
  } catch {
    return null
  }
})

// Other shares by the same creator — keyed on the stable handle (author_username)
// so it's the same person, not everyone who happens to share their display name.
const fetchByAuthor = cache(async (handle: string | null, excludeId: string): Promise<RelatedItem[]> => {
  if (!handle) return []
  await ensureTables()
  try {
    return await sql`
      SELECT id, name, description, author_name, kind FROM community_items
      WHERE author_username = ${handle} AND id <> ${excludeId} AND removed_at IS NULL
      ORDER BY (votes + downloads * 0.5 + 1) DESC LIMIT 4
    ` as RelatedItem[]
  } catch {
    return []
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
  // Index only high-value pages so crawl budget goes to pages that can rank:
  // official 100Lights content + items with real engagement. The thin long tail
  // is noindex,follow — crawlers still pass link-equity up to the category hubs
  // and the main feed, but don't index thousands of near-empty item pages.
  const votes = Number(item.votes ?? 0)
  const downloads = Number(item.downloads ?? 0)
  const highValue = item.author_name === '100Lights' || (votes + downloads) >= 3
  return {
    title,
    description,
    alternates: { canonical: `https://100lights.com/community/${id}` },
    openGraph: { title, description, type: isPost ? 'article' : 'music.song', siteName: '100Lights Community', url: `https://100lights.com/community/${id}` },
    twitter: { card: 'summary_large_image', title, description },
    ...(highValue ? {} : { robots: { index: false, follow: true } }),
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
  const [related, byAuthor, remixes, source] = await Promise.all([
    fetchRelated(item.kind as string, id),
    fetchByAuthor((item.author_username as string | null) ?? null, id),
    fetchRemixes(id),
    fetchSource((item.remixed_from as string | null) ?? null),
  ])
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(jsonLd) }} />
      {/* key={id}: soft-navigating between two /community/[id] pages reuses this
          client instance, so its useState(initialItem) would keep showing the
          previous item. Keying on id forces a fresh mount per item. */}
      <ItemClient key={id} id={id} initialItem={initialItem} related={related} byAuthor={byAuthor} remixes={remixes} source={source} author={item.author_name as string} authorHandle={(item.author_username as string | null) ?? undefined} kind={item.kind as string} />
    </>
  )
}
