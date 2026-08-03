import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import { sql } from '@/lib/db'
import { ensureTables, COMMUNITY_KINDS } from '@/lib/community-server'

// Category hub: one rich, server-rendered, crawlable page per community kind
// (/community/browse/samples, /recipes, /starters…). This is the durable SEO
// surface — an aggregation page that can actually rank — in place of thousands of
// thin individual item pages (those are noindex,follow; see [id]/generateMetadata).
// The live interactive feed still lives at /community?kind=<kind>.

export const runtime = 'nodejs'
export const revalidate = 3600

interface KindMeta { label: string; blurb: string }
const KIND_META: Record<string, KindMeta> = {
  song:    { label: 'Songs',           blurb: 'Full tracks made in 100Lights — press play and listen right in your browser, no account needed.' },
  sample:  { label: 'Samples',         blurb: 'Free one-shots and loops shared by producers. Audition each one, then import it into your own project with a click.' },
  preset:  { label: 'Presets',         blurb: 'Synth patches you can install in one click — they sync across your devices and drop straight onto a track.' },
  recipe:  { label: 'Chord recipes',   blurb: 'Chord progressions as editable MIDI. Audition them, then open one in the studio and make it your own.' },
  pack:    { label: 'Sample packs',    blurb: 'Curated bundles of samples — grab a whole kit of sounds at once.' },
  project: { label: 'Project starters', blurb: 'Remixable starting points — open one, hear how it was built, and turn it into your own track.' },
  theme:   { label: 'Themes',          blurb: 'Editor colour themes and looks made by the community.' },
  kit:     { label: 'Drum kits',       blurb: 'Ready-to-play drum kits you can load onto a beat and start programming.' },
  pattern: { label: 'Beat patterns',   blurb: 'Drum patterns you can drop onto the step grid and build a groove from.' },
  post:    { label: 'Posts',           blurb: 'Tips, questions, and feedback threads from the 100Lights community.' },
  clip:    { label: 'Clips',           blurb: 'Short screen-recorded clips from the studio.' },
}
// URL-friendly aliases so /community/browse/starters resolves to the 'project' kind.
const ALIAS: Record<string, string> = { starters: 'project', starter: 'project', samples: 'sample', songs: 'song', presets: 'preset', recipes: 'recipe', packs: 'pack', kits: 'kit', patterns: 'pattern', themes: 'theme', posts: 'post', clips: 'clip' }

function resolveKind(param: string): string | null {
  const k = ALIAS[param] ?? param
  return (COMMUNITY_KINDS as readonly string[]).includes(k) ? k : null
}

type Row = { id: string; name: string; description: string; author_name: string; votes: number; downloads: number; created_at: string }

const fetchKind = cache(async (kind: string): Promise<Row[]> => {
  await ensureTables()
  try {
    return await sql`
      SELECT id, name, description, author_name, votes, downloads, created_at
      FROM community_items
      WHERE kind = ${kind} AND removed_at IS NULL
      ORDER BY (votes + downloads * 0.5 + 1) DESC
      LIMIT 60
    ` as Row[]
  } catch {
    return []
  }
})

export async function generateMetadata({ params }: { params: Promise<{ kind: string }> }): Promise<Metadata> {
  const { kind: param } = await params
  const kind = resolveKind(param)
  if (!kind) return { title: 'Not found' }
  const meta = KIND_META[kind]
  const rows = await fetchKind(kind)
  const title = `${meta.label} — 100Lights Community`
  const description = meta.blurb
  return {
    title,
    description,
    alternates: { canonical: `https://100lights.com/community/browse/${kind}` },
    openGraph: { title, description, type: 'website', siteName: '100Lights Community', url: `https://100lights.com/community/browse/${kind}` },
    twitter: { card: 'summary_large_image', title, description },
    // A near-empty category isn't worth indexing yet.
    ...(rows.length >= 3 ? {} : { robots: { index: false, follow: true } }),
  }
}

export default async function CommunityCategoryPage({ params }: { params: Promise<{ kind: string }> }) {
  const { kind: param } = await params
  const kind = resolveKind(param)
  if (!kind) notFound()
  const meta = KIND_META[kind]
  const rows = await fetchKind(kind)

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: `${meta.label} — 100Lights Community`,
    description: meta.blurb,
    url: `https://100lights.com/community/browse/${kind}`,
    hasPart: rows.slice(0, 20).map(r => ({
      '@type': kind === 'post' ? 'Article' : 'MusicRecording',
      name: r.name,
      url: `https://100lights.com/community/${r.id}`,
      ...(kind === 'post' ? {} : { byArtist: { '@type': 'Person', name: r.author_name } }),
    })),
  }

  const others = (COMMUNITY_KINDS as readonly string[]).filter(k => k !== kind && KIND_META[k])

  return (
    <main style={{ maxWidth: 860, margin: '0 auto', padding: '28px 18px 72px', color: 'var(--text-primary, #f1f0ff)' }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <nav style={{ fontSize: 12.5, color: 'var(--text-muted, #a3a2b5)', marginBottom: 14 }}>
        <Link href="/community" style={{ color: 'inherit', textDecoration: 'none' }}>Community</Link>
        <span style={{ margin: '0 6px' }}>/</span>
        <span style={{ color: 'var(--text-secondary, #cfceda)' }}>{meta.label}</span>
      </nav>

      <header style={{ marginBottom: 22 }}>
        <h1 style={{ fontSize: 27, fontWeight: 800, letterSpacing: '-0.01em', margin: '0 0 8px' }}>{meta.label}</h1>
        <p style={{ fontSize: 14.5, lineHeight: 1.55, color: 'var(--text-secondary, #cfceda)', margin: 0, maxWidth: 620 }}>{meta.blurb}</p>
        <Link href={`/community?kind=${kind}`} style={{ display: 'inline-block', marginTop: 12, fontSize: 13, fontWeight: 700, color: '#a78bfa', textDecoration: 'none' }}>
          Open the interactive feed →
        </Link>
      </header>

      {rows.length === 0 ? (
        <p style={{ color: 'var(--text-muted, #a3a2b5)', fontSize: 14 }}>Nothing here yet — be the first to share.</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 10 }}>
          {rows.map(r => (
            <li key={r.id}>
              <Link href={`/community/${r.id}`} style={{
                display: 'block', textDecoration: 'none', color: 'inherit',
                background: 'var(--bg-surface, #17171b)', border: '1px solid var(--border, #26262b)',
                borderRadius: 10, padding: '13px 15px',
              }}>
                <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 3 }}>{r.name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted, #a3a2b5)', marginBottom: r.description ? 6 : 0 }}>
                  by {r.author_name}{(r.votes + r.downloads) > 0 ? ` · ${r.votes} upvotes · ${r.downloads} imports` : ''}
                </div>
                {r.description && (
                  <p style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--text-secondary, #cfceda)', margin: 0, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{r.description}</p>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}

      <footer style={{ marginTop: 40, paddingTop: 20, borderTop: '1px solid var(--border, #26262b)' }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted, #a3a2b5)', marginBottom: 10 }}>Browse other categories</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {others.map(k => (
            <Link key={k} href={`/community/browse/${k}`} style={{
              fontSize: 13, fontWeight: 600, textDecoration: 'none', color: 'var(--text-secondary, #cfceda)',
              background: 'var(--bg-surface, #17171b)', border: '1px solid var(--border, #26262b)',
              borderRadius: 999, padding: '5px 13px',
            }}>{KIND_META[k].label}</Link>
          ))}
        </div>
      </footer>
    </main>
  )
}
