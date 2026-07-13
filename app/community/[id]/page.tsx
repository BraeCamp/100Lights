import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { sql } from '@/lib/db'
import { ensureTables } from '@/lib/community-server'
import { ItemClient } from './ItemClient'

// Public share page for one community item. No account needed to listen —
// this is the link people paste into chats, and the OG tags make it unfurl
// with a waveform card.

export const runtime = 'nodejs'

async function fetchItem(id: string) {
  await ensureTables()
  try {
    const rows = await sql`SELECT * FROM community_items WHERE id = ${id}`
    return rows[0] ?? null
  } catch {
    return null  // malformed uuid etc.
  }
}

const KIND_LABEL: Record<string, string> = {
  song: 'Song', sample: 'Sample', preset: 'Preset', recipe: 'Recipe', pack: 'Sample pack', project: 'Project starter',
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const item = await fetchItem(id)
  if (!item) return { title: 'Not found' }
  const kindLabel = KIND_LABEL[item.kind as string] ?? 'Share'
  const title = `${item.name} — ${kindLabel} by ${item.author_name}`
  const description = (item.description as string) || `Listen to this ${kindLabel.toLowerCase()} on 100Lights Community — no account needed.`
  return {
    title,
    description,
    openGraph: { title, description, type: 'music.song', siteName: '100Lights Community' },
    twitter: { card: 'summary_large_image', title, description },
  }
}

export default async function CommunityItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const item = await fetchItem(id)
  if (!item) notFound()
  return <ItemClient id={id} />
}
