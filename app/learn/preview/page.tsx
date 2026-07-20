import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getArticles } from '@/lib/learn-articles'
import { isAdmin } from '@/lib/admin-auth'

// Admin-only index of everything in the Learn section, drafts included, so
// unpublished articles are reachable in production for review. Force-dynamic
// and noindex — see the sibling [slug] route for why this can't live on /learn.
export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Draft previews',
  robots: { index: false, follow: false },
}

export default async function DraftIndexPage() {
  if (!await isAdmin()) notFound()
  const articles = await getArticles({ includeDrafts: true })
  const drafts = articles.filter(a => a.draft).length

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)' }}>
      <main id="main" className="max-w-3xl mx-auto px-6 py-14">
        <header style={{ marginBottom: 30 }}>
          <Link href="/learn" style={{ fontSize: 13, color: 'var(--text-muted)', textDecoration: 'none' }}>← Public Learn index</Link>
          <h1 style={{ fontSize: 32, fontWeight: 800, color: 'var(--text-primary)', margin: '14px 0 8px', letterSpacing: '-0.02em' }}>Draft previews</h1>
          <p style={{ fontSize: 14, color: 'var(--text-secondary)', margin: 0 }}>
            {articles.length} articles, {drafts} unpublished. Only you can see this page.
          </p>
        </header>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {articles.map(a => (
            <Link key={a.slug} href={`/learn/preview/${a.slug}`} style={{
              display: 'block', textDecoration: 'none', padding: '16px 18px', borderRadius: 12,
              border: '1px solid var(--border)', background: 'var(--bg-card)',
            }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                <h2 style={{ fontSize: 16, fontWeight: 750, color: 'var(--text-primary)', margin: 0 }}>{a.title}</h2>
                {a.draft
                  ? <span style={{ fontSize: 9, fontWeight: 800, color: '#f59e0b', border: '1px solid rgba(245,158,11,0.4)', borderRadius: 99, padding: '1px 8px', letterSpacing: '0.06em' }}>DRAFT</span>
                  : <span style={{ fontSize: 9, fontWeight: 800, color: '#34d399', border: '1px solid rgba(52,211,153,0.4)', borderRadius: 99, padding: '1px 8px', letterSpacing: '0.06em' }}>LIVE</span>}
              </div>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, margin: '7px 0 8px' }}>{a.description}</p>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                {a.minutes} min read{a.tags.length ? ` · ${a.tags.join(' · ')}` : ''}
              </div>
            </Link>
          ))}
        </div>
      </main>
    </div>
  )
}
