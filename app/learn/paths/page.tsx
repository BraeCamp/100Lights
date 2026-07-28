import type { Metadata } from 'next'
import Link from 'next/link'
import { GraduationCap } from 'lucide-react'
import { getArticles } from '@/lib/learn-articles'
import { getLearnPaths } from '@/lib/learn-paths-store'

export const revalidate = 60

export const metadata: Metadata = {
  title: 'Learning Paths — Guided Music-Production Courses (Free)',
  description: 'Free, ordered learning paths that take you from your first beat to a finished, mixed track — a few short guides each, all doable in your browser.',
  alternates: { canonical: 'https://100lights.com/learn/paths' },
  openGraph: {
    title: '100Lights Learning Paths',
    description: 'Guided, step-by-step music-production paths — free, in your browser.',
    url: 'https://100lights.com/learn/paths',
    type: 'website',
    siteName: '100Lights',
  },
}

const LEVEL_LABEL: Record<string, string> = { beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced' }

export default async function LearningPathsIndex() {
  const [published, paths] = await Promise.all([getArticles(), getLearnPaths()])
  const pubSet = new Set(published.map(a => a.slug))

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)' }}>
      <main id="main" className="max-w-3xl mx-auto px-6 py-14">
        <nav aria-label="Breadcrumb" style={{ marginBottom: 22, fontSize: 12.5, color: 'var(--text-muted)' }}>
          <Link href="/learn" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>← Learn</Link>
        </nav>

        <header style={{ marginBottom: 34, maxWidth: 620 }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 16,
            fontSize: 12, fontWeight: 600, padding: '5px 12px', borderRadius: 99,
            color: 'var(--accent-light)', background: 'var(--accent-subtle)', border: '1px solid rgba(139,92,246,0.25)',
          }}>
            <GraduationCap size={13} /> Guided paths · start to finish
          </div>
          <h1 style={{ fontSize: 40, fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 14px', letterSpacing: '-0.03em', lineHeight: 1.06 }}>
            Learning paths
          </h1>
          <p style={{ fontSize: 16, color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0 }}>
            Each path is a short, ordered set of guides that teaches one skill end-to-end. Follow them in order — your progress saves as you go, no account needed.
          </p>
        </header>

        <div style={{ display: 'grid', gap: 14 }}>
          {paths.map(path => {
            const liveCount = path.articleSlugs.filter(s => pubSet.has(s)).length
            return (
              <Link key={path.slug} href={`/learn/paths/${path.slug}`} style={{ textDecoration: 'none' }}>
                <div style={{
                  display: 'flex', alignItems: 'flex-start', gap: 16, padding: '20px 22px', borderRadius: 16,
                  border: '1px solid var(--border)', background: 'var(--bg-card)',
                }}>
                  <div aria-hidden style={{ fontSize: 30, lineHeight: 1, flexShrink: 0, marginTop: 2 }}>{path.emoji}</div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 5 }}>
                      {LEVEL_LABEL[path.level]} · {liveCount} guide{liveCount === 1 ? '' : 's'}
                    </div>
                    <div style={{ fontSize: 18, fontWeight: 750, color: 'var(--text-primary)', letterSpacing: '-0.01em', marginBottom: 5 }}>{path.title}</div>
                    <div style={{ fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{path.description}</div>
                  </div>
                  <div aria-hidden style={{ color: 'var(--text-muted)', fontSize: 20, alignSelf: 'center' }}>→</div>
                </div>
              </Link>
            )
          })}
        </div>
      </main>
    </div>
  )
}
