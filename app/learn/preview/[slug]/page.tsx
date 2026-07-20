import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getArticle, getArticles } from '@/lib/learn-articles'
import { isAdmin } from '@/lib/admin-auth'
import { renderMarkdown } from '@/lib/simple-markdown'
import { pickRecommendations } from '@/lib/article-recommendations'
import ArticleRecommendations from '@/components/ArticleRecommendations'

// Admin-only draft preview, rendered with the real article template so what
// you read here is what readers will get.
//
// This lives on its own route because /learn/[slug] sets `revalidate`, and a
// revalidating route may not read cookies — so the admin check has to happen
// somewhere fully dynamic. Force-dynamic and noindex, always.
export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Draft preview',
  robots: { index: false, follow: false },
}

export default async function DraftPreviewPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  if (!await isAdmin()) notFound()

  const a = await getArticle(slug, { includeDrafts: true })
  if (!a) notFound()

  const all = await getArticles({ includeDrafts: true })
  const i = all.findIndex(x => x.slug === slug)
  const prev = i > 0 ? all[i - 1] : null
  const next = i >= 0 && i < all.length - 1 ? all[i + 1] : null

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)' }}>
      <main id="main" className="max-w-3xl mx-auto px-6 py-14">
        <nav style={{ display: 'flex', gap: 14, alignItems: 'center', marginBottom: 22, flexWrap: 'wrap' }}>
          <Link href="/learn/preview" style={{ fontSize: 13, color: 'var(--text-muted)', textDecoration: 'none' }}>← All drafts</Link>
          <span style={{ fontSize: 11, fontWeight: 800, color: '#f59e0b', letterSpacing: '0.08em' }}>
            {a.draft ? 'DRAFT PREVIEW' : 'PUBLISHED'}
          </span>
          <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
            {a.minutes} min · {a.tags.join(' · ')}
          </span>
        </nav>

        <article>
          {!/^\s*#\s/.test(a.body) && (
            <h1 style={{ color: 'var(--text-primary)', fontSize: 32, fontWeight: 800, letterSpacing: '-0.01em', lineHeight: 1.3, margin: '0 0 12px' }}>
              {a.title}
            </h1>
          )}
          {renderMarkdown(a.body)}
        </article>

        {/* Recommendations come from PUBLISHED articles only, same as the
            live page — so a preview shows what readers will actually get. */}
        <ArticleRecommendations items={pickRecommendations(a, all.filter(x => !x.draft), 3)} />

        <nav style={{ display: 'flex', justifyContent: 'space-between', gap: 16, marginTop: 44, paddingTop: 20, borderTop: '1px solid var(--border)' }}>
          {prev
            ? <Link href={`/learn/preview/${prev.slug}`} style={{ fontSize: 13, color: '#a78bfa', textDecoration: 'none', maxWidth: '46%' }}>← {prev.title}</Link>
            : <span />}
          {next
            ? <Link href={`/learn/preview/${next.slug}`} style={{ fontSize: 13, color: '#a78bfa', textDecoration: 'none', textAlign: 'right', maxWidth: '46%' }}>{next.title} →</Link>
            : <span />}
        </nav>
      </main>
    </div>
  )
}
