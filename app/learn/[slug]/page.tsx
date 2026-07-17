import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getArticle, getArticles } from '@/lib/learn-articles'
import { renderMarkdown } from '@/lib/simple-markdown'

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

export default async function LearnArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const a = await getArticle(slug)
  if (!a) notFound()

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: a.title,
    description: a.description,
    datePublished: a.date,
    ...(a.updated ? { dateModified: a.updated } : {}),
    author: { '@type': 'Organization', name: '100Lights' },
    publisher: { '@type': 'Organization', name: '100Lights', url: 'https://100lights.com' },
    mainEntityOfPage: `https://100lights.com/learn/${a.slug}`,
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)' }}>
      {!a.draft && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />}
      <main id="main" className="max-w-3xl mx-auto px-6 py-14">
        <nav style={{ marginBottom: 26 }}>
          <Link href="/learn" style={{ fontSize: 13, color: 'var(--text-muted)', textDecoration: 'none' }}>← All guides</Link>
        </nav>
        {a.draft && (
          <p style={{ fontSize: 11, fontWeight: 800, color: '#f59e0b', letterSpacing: '0.08em', margin: '0 0 14px' }}>DRAFT — not yet published</p>
        )}
        <article>
          {renderMarkdown(a.body)}
        </article>
        <aside style={{
          marginTop: 48, padding: '26px 24px', borderRadius: 16, textAlign: 'center',
          background: 'linear-gradient(135deg, rgba(124,58,237,0.12), rgba(59,130,246,0.08))',
          border: '1px solid rgba(139,92,246,0.3)',
        }}>
          <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 6px' }}>Try it yourself — free, in your browser</p>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 16px' }}>Everything in this guide works in the 100Lights studio. No downloads, no plugins.</p>
          <Link href="/sign-up" style={{ display: 'inline-block', padding: '10px 22px', borderRadius: 10, background: 'var(--accent)', color: '#fff', fontSize: 13.5, fontWeight: 700, textDecoration: 'none' }}>
            Open the studio
          </Link>
        </aside>
      </main>
    </div>
  )
}

export const dynamic = 'force-dynamic'
