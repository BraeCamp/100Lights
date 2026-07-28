import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getArticles } from '@/lib/learn-articles'
import { getLearnPath, getLearnPaths } from '@/lib/learn-paths-store'
import PathArticleList, { type PathStep } from '@/components/learn/PathArticleList'

export const revalidate = 60

const LEVEL_LABEL: Record<string, string> = { beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced' }

export async function generateStaticParams() {
  return (await getLearnPaths()).map(p => ({ slug: p.slug }))
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const path = await getLearnPath(slug)
  if (!path) return { title: 'Learning Path' }
  return {
    title: `${path.title} — A Free Music-Production Path`,
    description: path.goal,
    alternates: { canonical: `https://100lights.com/learn/paths/${path.slug}` },
    openGraph: {
      title: `${path.title} · 100Lights Learn`,
      description: path.goal,
      url: `https://100lights.com/learn/paths/${path.slug}`,
      type: 'website',
      siteName: '100Lights',
    },
  }
}

export default async function LearningPathPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const path = await getLearnPath(slug)
  if (!path) notFound()

  // Resolve each slug: published set gates linking; the with-drafts set supplies
  // titles for steps that aren't live yet (shown as "coming soon").
  const [published, withDrafts] = await Promise.all([
    getArticles(),
    getArticles({ includeDrafts: true }),
  ])
  const pubSet = new Set(published.map(a => a.slug))
  const bySlug = new Map(withDrafts.map(a => [a.slug, a]))

  const steps: PathStep[] = path.articleSlugs.map(s => {
    const a = bySlug.get(s)
    return {
      slug: s,
      title: a?.title ?? s.replace(/-/g, ' '),
      description: a?.description ?? '',
      minutes: a?.minutes ?? null,
      published: pubSet.has(s),
    }
  })
  const liveCount = steps.filter(s => s.published).length
  const totalMin = steps.filter(s => s.published).reduce((sum, s) => sum + (s.minutes ?? 5), 0)

  // JSON-LD: a Course made of its published articles.
  const jsonLd = {
    '@context': 'https://schema.org', '@type': 'Course',
    name: path.title, description: path.goal,
    provider: { '@type': 'Organization', name: '100Lights', url: 'https://100lights.com' },
    hasCourseInstance: { '@type': 'CourseInstance', courseMode: 'online' },
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)' }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <main id="main" className="max-w-2xl mx-auto px-6 py-14">
        {/* Breadcrumb */}
        <nav aria-label="Breadcrumb" style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 22, fontSize: 12.5, color: 'var(--text-muted)', flexWrap: 'wrap' }}>
          <Link href="/learn" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>Learn</Link>
          <span aria-hidden>/</span>
          <Link href="/learn/paths" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>Paths</Link>
          <span aria-hidden>/</span>
          <span style={{ color: 'var(--text-secondary)' }}>{path.title}</span>
        </nav>

        {/* Hero */}
        <header style={{ marginBottom: 30 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <div aria-hidden style={{ fontSize: 30, lineHeight: 1 }}>{path.emoji}</div>
            <span style={{
              fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
              color: 'var(--accent-light)', background: 'var(--accent-subtle)', border: '1px solid rgba(139,92,246,0.25)',
              borderRadius: 99, padding: '4px 11px',
            }}>{LEVEL_LABEL[path.level]} path · {liveCount} guide{liveCount === 1 ? '' : 's'}{totalMin ? ` · ~${totalMin} min` : ''}</span>
          </div>
          <h1 style={{ fontSize: 34, fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 12px', letterSpacing: '-0.02em', lineHeight: 1.1 }}>
            {path.title}
          </h1>
          <p style={{ fontSize: 16, color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0 }}>{path.goal}</p>
        </header>

        <PathArticleList steps={steps} accent="var(--accent)" />

        <p style={{ marginTop: 30, fontSize: 12.5, color: 'var(--text-muted)' }}>
          Your progress is saved on this device — no account needed. <Link href="/learn/paths" style={{ color: 'var(--accent-light)', textDecoration: 'none' }}>See all paths →</Link>
        </p>
      </main>
    </div>
  )
}
