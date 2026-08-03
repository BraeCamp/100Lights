import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import { sql } from '@/lib/db'
import { ensureTables, jsonLdScript } from '@/lib/community-server'

// Public creator profile: everything one person has shared, server-rendered and
// crawlable. Fills out the community with a real per-creator surface (better than
// the client-side ?author= filter) and gives each producer a page worth sharing.
// Reached from an item's byline / "More from <creator>".

export const runtime = 'nodejs'
export const revalidate = 3600

const KIND_LABEL: Record<string, string> = {
  song: 'Song', sample: 'Sample', preset: 'Preset', recipe: 'Chord recipe', pack: 'Sample pack', project: 'Project starter', theme: 'Theme', kit: 'Drum kit', pattern: 'Beat pattern', post: 'Post', clip: 'Clip',
}

type Item = { id: string; name: string; description: string; kind: string; votes: number; downloads: number }
type Stats = { shares: number; votes: number; downloads: number }
type Collection = { id: string; name: string; count: number }

const fetchCreator = cache(async (name: string): Promise<{ items: Item[]; stats: Stats; collections: Collection[] }> => {
  await ensureTables()
  try {
    // Independent queries — run them in parallel (one round-trip, not three).
    const [items, s, collections] = await Promise.all([
      sql`
        SELECT id, name, description, kind, votes, downloads FROM community_items
        WHERE author_name = ${name} AND removed_at IS NULL
        ORDER BY (votes + downloads * 0.5 + 1) DESC LIMIT 60
      `,
      sql`
        SELECT COUNT(*)::int AS shares, COALESCE(SUM(votes),0)::int AS votes, COALESCE(SUM(downloads),0)::int AS downloads
        FROM community_items WHERE author_name = ${name} AND removed_at IS NULL
      `,
      sql`
        SELECT c.id, c.name, COUNT(ci.item_id)::int AS count
        FROM community_collections c JOIN community_collection_items ci ON ci.collection_id = c.id
        WHERE c.author_name = ${name} AND c.removed_at IS NULL
        GROUP BY c.id ORDER BY c.created_at DESC LIMIT 12
      `,
    ]) as [Item[], { shares: number; votes: number; downloads: number }[], Collection[]]
    return { items, stats: s[0] ?? { shares: 0, votes: 0, downloads: 0 }, collections }
  } catch {
    return { items: [], stats: { shares: 0, votes: 0, downloads: 0 }, collections: [] }
  }
})

// Deterministic avatar hue from the name (matches the feed's avatar colouring idea).
function hue(name: string): number {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360
  return h
}

export async function generateMetadata({ params }: { params: Promise<{ name: string }> }): Promise<Metadata> {
  const { name: raw } = await params
  const name = decodeURIComponent(raw)
  const { stats } = await fetchCreator(name)
  const title = `${name} — 100Lights Community`
  const description = stats.shares > 0
    ? `${name} has shared ${stats.shares} sound${stats.shares === 1 ? '' : 's'} on 100Lights — samples, presets, chord recipes and more. Listen and remix in your browser.`
    : `${name} on the 100Lights Community.`
  return {
    title,
    description,
    alternates: { canonical: `https://100lights.com/community/creator/${encodeURIComponent(name)}` },
    openGraph: { title, description, type: 'profile', siteName: '100Lights Community', url: `https://100lights.com/community/creator/${encodeURIComponent(name)}` },
    twitter: { card: 'summary_large_image', title, description },
    ...(stats.shares >= 1 ? {} : { robots: { index: false, follow: true } }),
  }
}

export default async function CreatorProfilePage({ params }: { params: Promise<{ name: string }> }) {
  const { name: raw } = await params
  const name = decodeURIComponent(raw)
  const { items, stats, collections } = await fetchCreator(name)
  if (stats.shares === 0) notFound()

  const h = hue(name)
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ProfilePage',
    mainEntity: { '@type': 'Person', name, url: `https://100lights.com/community/creator/${encodeURIComponent(name)}` },
    url: `https://100lights.com/community/creator/${encodeURIComponent(name)}`,
  }
  const stat = (n: number, label: string) => (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <span style={{ fontSize: 18, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{n.toLocaleString()}</span>
      <span style={{ fontSize: 11, color: 'var(--text-muted, #a3a2b5)' }}>{label}</span>
    </div>
  )

  return (
    <main style={{ maxWidth: 860, margin: '0 auto', padding: '28px 18px 72px', color: 'var(--text-primary, #f1f0ff)' }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(jsonLd) }} />
      <nav style={{ fontSize: 12.5, color: 'var(--text-muted, #a3a2b5)', marginBottom: 16 }}>
        <Link href="/community" style={{ color: 'inherit', textDecoration: 'none' }}>Community</Link>
        <span style={{ margin: '0 6px' }}>/</span>
        <span style={{ color: 'var(--text-secondary, #cfceda)' }}>{name}</span>
      </nav>

      <header style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 26 }}>
        <div aria-hidden style={{
          width: 60, height: 60, borderRadius: '50%', flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 24, fontWeight: 800, color: '#fff',
          background: `linear-gradient(135deg, hsl(${h} 70% 52%), hsl(${(h + 40) % 360} 70% 42%))`,
        }}>{name.slice(0, 1).toUpperCase()}</div>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.01em', margin: '0 0 8px' }}>{name}</h1>
          <div style={{ display: 'flex', gap: 22 }}>
            {stat(stats.shares, stats.shares === 1 ? 'share' : 'shares')}
            {stat(stats.votes, 'upvotes')}
            {stat(stats.downloads, 'imports')}
          </div>
        </div>
      </header>

      {collections.length > 0 && (
        <section style={{ marginBottom: 26 }}>
          <h2 style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-muted, #a3a2b5)', margin: '0 0 12px' }}>🔖 Collections</h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {collections.map(c => (
              <Link key={c.id} href={`/community/collection/${c.id}`} style={{
                display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 600, textDecoration: 'none',
                color: 'var(--text-primary, #f1f0ff)', background: 'var(--bg-surface, #17171b)', border: '1px solid var(--border, #26262b)',
                borderRadius: 9, padding: '8px 13px',
              }}>{c.name}<span style={{ fontSize: 11, color: 'var(--text-muted, #a3a2b5)' }}>{c.count}</span></Link>
            ))}
          </div>
        </section>
      )}

      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 10 }}>
        {items.map(r => (
          <li key={r.id}>
            <Link href={`/community/${r.id}`} style={{
              display: 'block', textDecoration: 'none', color: 'inherit',
              background: 'var(--bg-surface, #17171b)', border: '1px solid var(--border, #26262b)',
              borderRadius: 10, padding: '13px 15px',
            }}>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 3 }}>{r.name}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted, #a3a2b5)', marginBottom: r.description ? 6 : 0 }}>
                {KIND_LABEL[r.kind] ?? r.kind}{(r.votes + r.downloads) > 0 ? ` · ${r.votes} upvotes · ${r.downloads} imports` : ''}
              </div>
              {r.description && (
                <p style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--text-secondary, #cfceda)', margin: 0, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{r.description}</p>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </main>
  )
}
