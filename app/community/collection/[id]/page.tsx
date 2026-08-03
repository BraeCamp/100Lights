import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import { sql } from '@/lib/db'
import { ensureTables, isUuid, jsonLdScript } from '@/lib/community-server'

// Public collection page: a creator-curated, shareable set of community items —
// server-rendered and crawlable (another rich SEO surface + a page worth sharing).

export const runtime = 'nodejs'
export const revalidate = 600

const KIND_LABEL: Record<string, string> = {
  song: 'Song', sample: 'Sample', preset: 'Preset', recipe: 'Chord recipe', pack: 'Sample pack', project: 'Project starter', theme: 'Theme', kit: 'Drum kit', pattern: 'Beat pattern', post: 'Post', clip: 'Clip',
}

type Collection = { id: string; name: string; description: string; author_name: string; author_username: string | null }
type Item = { id: string; name: string; kind: string; author_name: string }

const fetchCollection = cache(async (id: string): Promise<{ collection: Collection; items: Item[] } | null> => {
  if (!isUuid(id)) return null
  await ensureTables()
  try {
    const c = await sql`SELECT id, name, description, author_name, author_username FROM community_collections WHERE id = ${id} AND removed_at IS NULL`
    if (!c.length) return null
    const items = await sql`
      SELECT i.id, i.name, i.kind, i.author_name FROM community_collection_items ci
      JOIN community_items i ON i.id = ci.item_id AND i.removed_at IS NULL
      WHERE ci.collection_id = ${id}
      ORDER BY ci.position, ci.added_at
    ` as Item[]
    return { collection: c[0] as Collection, items }
  } catch {
    return null
  }
})

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const data = await fetchCollection(id)
  if (!data) return { title: 'Not found' }
  const { collection, items } = data
  const title = `${collection.name} — a collection by ${collection.author_name} · 100Lights`
  const description = collection.description || `${items.length} pick${items.length === 1 ? '' : 's'} curated by ${collection.author_name} on 100Lights — listen and remix free.`
  return {
    title,
    description,
    alternates: { canonical: `https://100lights.com/community/collection/${id}` },
    openGraph: { title, description, type: 'website', siteName: '100Lights Community', url: `https://100lights.com/community/collection/${id}` },
    twitter: { card: 'summary_large_image', title, description },
    ...(items.length >= 1 ? {} : { robots: { index: false, follow: true } }),
  }
}

export default async function CollectionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const data = await fetchCollection(id)
  if (!data) notFound()
  const { collection, items } = data

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: collection.name,
    ...(collection.description ? { description: collection.description } : {}),
    url: `https://100lights.com/community/collection/${id}`,
    hasPart: items.slice(0, 30).map(i => ({ '@type': i.kind === 'post' ? 'Article' : 'MusicRecording', name: i.name, url: `https://100lights.com/community/${i.id}` })),
  }

  return (
    <main style={{ maxWidth: 860, margin: '0 auto', padding: '28px 18px 72px', color: 'var(--text-primary, #f1f0ff)' }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(jsonLd) }} />
      <nav style={{ fontSize: 12.5, color: 'var(--text-muted, #a3a2b5)', marginBottom: 16 }}>
        <Link href="/community" style={{ color: 'inherit', textDecoration: 'none' }}>Community</Link>
        <span style={{ margin: '0 6px' }}>/</span>
        <Link href={`/community/creator/${encodeURIComponent(collection.author_username ?? collection.author_name)}`} style={{ color: 'inherit', textDecoration: 'none' }}>{collection.author_name}</Link>
      </nav>

      <header style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#a78bfa', marginBottom: 6 }}>🔖 Collection</div>
        <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.01em', margin: '0 0 8px' }}>{collection.name}</h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted, #a3a2b5)', margin: 0 }}>
          {items.length} pick{items.length === 1 ? '' : 's'} · by{' '}
          <Link href={`/community/creator/${encodeURIComponent(collection.author_username ?? collection.author_name)}`} style={{ color: 'var(--text-secondary, #cfceda)', textDecoration: 'none', fontWeight: 600 }}>{collection.author_name}</Link>
        </p>
        {collection.description && (
          <p style={{ fontSize: 14.5, lineHeight: 1.55, color: 'var(--text-secondary, #cfceda)', margin: '12px 0 0', maxWidth: 620 }}>{collection.description}</p>
        )}
      </header>

      {items.length === 0 ? (
        <p style={{ color: 'var(--text-muted, #a3a2b5)', fontSize: 14 }}>This collection is empty.</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 10 }}>
          {items.map(r => (
            <li key={r.id}>
              <Link href={`/community/${r.id}`} style={{
                display: 'block', textDecoration: 'none', color: 'inherit',
                background: 'var(--bg-surface, #17171b)', border: '1px solid var(--border, #26262b)',
                borderRadius: 10, padding: '13px 15px',
              }}>
                <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 2 }}>{r.name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted, #a3a2b5)' }}>{KIND_LABEL[r.kind] ?? r.kind} · by {r.author_name}</div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
