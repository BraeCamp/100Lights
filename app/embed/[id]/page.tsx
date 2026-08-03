import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import { sql } from '@/lib/db'
import { ensureTables, rowToItem } from '@/lib/community-server'
import type { CommunityItem } from '@/lib/community'
import { EmbedClient } from './EmbedClient'

// Embeddable player: a small, frameable widget for one community item, for
// pasting into blogs / Discord / socials. Public (see middleware) and noindex
// (the canonical page is /community/[id]).

export const runtime = 'nodejs'
export const revalidate = 3600

const fetchItem = cache(async (id: string) => {
  await ensureTables()
  try {
    const rows = await sql`SELECT * FROM community_items WHERE id = ${id} AND removed_at IS NULL`
    return rows[0] ?? null
  } catch {
    return null
  }
})

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const item = await fetchItem(id)
  return {
    title: item ? `${item.name} — 100Lights` : 'Not found',
    robots: { index: false, follow: false }, // the /community/[id] page is canonical
  }
}

export default async function EmbedPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const item = await fetchItem(id)
  if (!item) notFound()
  const initialItem = rowToItem(item, null, new Set<string>(), new Map(), new Map()) as unknown as CommunityItem
  return <EmbedClient item={initialItem} />
}
