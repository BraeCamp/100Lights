import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getArticle, getArticles } from '@/lib/learn-articles'
import { renderMarkdown } from '@/lib/simple-markdown'
import { pickRecommendations } from '@/lib/article-recommendations'
import { articlePersona, extractHeadings, extractFaq } from '@/lib/article-personas'
import ArticleRecommendations from '@/components/ArticleRecommendations'
import ReadingProgress from '@/components/learn/ReadingProgress'
import ArticleToc from '@/components/learn/ArticleToc'
import ArticleShare from '@/components/learn/ArticleShare'
import ArticleReactions from '@/components/learn/ArticleReactions'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function fmtDate(iso: string) {
  const [y, m, d] = iso.split('-').map(Number)
  return m && d ? `${MONTHS[m - 1]} ${d}, ${y}` : iso
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const a = await getArticle(slug)
  if (!a) return { title: 'Not found' }
  return {
    title: a.title,
    description: a.description,
    alternates: { canonical: `https://100lights.com/learn/${a.slug}` },
    ...(a.draft ? { robots: { index: false } } : {}),
    openGraph: { title: a.title, description: a.description, type: 'article', url: `https://100lights.com/learn/${a.slug}`, siteName: '100Lights' },
    twitter: { card: 'summary_large_image', title: a.title, description: a.description },
  }
}

// Draft previews deliberately live on a separate route (/learn/preview/[slug]).
// This page sets `revalidate`, and a revalidating route may not read cookies
// at all — even behind an `if` — so an admin check here throws
// DYNAMIC_SERVER_USAGE and 500s for anonymous visitors. Keeping the two apart
// is what lets published articles stay fully static.
export default async function LearnArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const a = await getArticle(slug)
  if (!a) notFound()

  const url = `https://100lights.com/learn/${a.slug}`
  const persona = articlePersona(a)
  const headings = extractHeadings(a.body)
  const faqs = extractFaq(a.body)

  // Weighted by shared tags, and re-rolled on every revalidation rather than
  // seeded — so the set rotates and internal links spread across the section
  // instead of piling onto the same three articles forever.
  const recommendations = pickRecommendations(a, await getArticles(), 3)

  const jsonLd: Record<string, unknown>[] = [
    {
      '@context': 'https://schema.org', '@type': 'Article',
      headline: a.title, description: a.description, datePublished: a.date,
      ...(a.updated ? { dateModified: a.updated } : {}),
      author: { '@type': 'Organization', name: '100Lights' },
      publisher: { '@type': 'Organization', name: '100Lights', url: 'https://100lights.com' },
      mainEntityOfPage: url,
    },
    {
      '@context': 'https://schema.org', '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://100lights.com' },
        { '@type': 'ListItem', position: 2, name: 'Learn', item: 'https://100lights.com/learn' },
        { '@type': 'ListItem', position: 3, name: a.title, item: url },
      ],
    },
    ...(faqs.length ? [{
      '@context': 'https://schema.org', '@type': 'FAQPage',
      mainEntity: faqs.map(f => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
    }] : []),
  ]

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)' }}>
      {!a.draft && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />}
      <ReadingProgress />
      <ArticleToc headings={headings} />
      <main id="main" className="max-w-3xl mx-auto px-6 py-14">
        {/* Breadcrumb */}
        <nav aria-label="Breadcrumb" style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 20, fontSize: 12.5, color: 'var(--text-muted)', flexWrap: 'wrap' }}>
          <Link href="/" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>Home</Link>
          <span aria-hidden>/</span>
          <Link href="/learn" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>Learn</Link>
          <span aria-hidden>/</span>
          <span style={{ color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '55%' }}>{a.title}</span>
        </nav>

        {a.draft && (
          <p style={{ fontSize: 11, fontWeight: 800, color: '#f59e0b', letterSpacing: '0.08em', margin: '0 0 14px' }}>DRAFT — not yet published</p>
        )}

        <article>
          {!/^\s*#\s/.test(a.body) && (
            <h1 style={{ color: 'var(--text-primary)', fontSize: 32, fontWeight: 800, letterSpacing: '-0.01em', lineHeight: 1.3, margin: '0 0 12px' }}>
              {a.title}
            </h1>
          )}

          {/* Byline: the editorial voice this piece is written in, plus meta. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '2px 0 26px', paddingBottom: 20, borderBottom: '1px solid var(--border)' }}>
            <div aria-hidden style={{ width: 40, height: 40, flexShrink: 0, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, background: `linear-gradient(135deg, ${persona.from}, ${persona.to})` }}>{persona.emoji}</div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-primary)' }}>{persona.label}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.4 }}>
                {persona.tagline}
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 3 }}>
                {fmtDate(a.date)} · {a.minutes} min read{a.updated ? ` · updated ${fmtDate(a.updated)}` : ''}
              </div>
            </div>
          </div>

          {renderMarkdown(a.body)}
        </article>

        {/* Share + tags */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginTop: 30 }}>
          {a.tags.length > 0 ? (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {a.tags.map(t => (
                <Link key={t} href={`/learn?topic=${encodeURIComponent(t)}`} style={{
                  fontSize: 10.5, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', textDecoration: 'none',
                  color: 'var(--text-muted)', border: '1px solid var(--border)', borderRadius: 99, padding: '3px 10px',
                }}>{t}</Link>
              ))}
            </div>
          ) : <span />}
          <ArticleShare url={url} title={a.title} />
        </div>

        <ArticleReactions slug={a.slug} />

        <ArticleRecommendations items={recommendations} />

        <aside style={{
          marginTop: 48, padding: '26px 24px', borderRadius: 16, textAlign: 'center',
          background: 'linear-gradient(135deg, rgba(124,58,237,0.12), rgba(59,130,246,0.08))',
          border: '1px solid rgba(139,92,246,0.3)',
        }}>
          <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 6px' }}>Try it yourself — free, in your browser</p>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 16px' }}>Everything in this guide works in the 100Lights studio. No downloads, no plugins.</p>
          <Link href="/new?modules=audio" style={{ display: 'inline-block', padding: '10px 22px', borderRadius: 10, background: 'var(--accent)', color: '#fff', fontSize: 13.5, fontWeight: 700, textDecoration: 'none' }}>
            Open in the studio
          </Link>
        </aside>
      </main>
    </div>
  )
}

export const revalidate = 60

// Pre-render the published articles at build (fast first paint); DB-only
// articles render on demand and then cache for the revalidate window.
export async function generateStaticParams() {
  return (await getArticles({ includeDrafts: false })).map(a => ({ slug: a.slug }))
}
