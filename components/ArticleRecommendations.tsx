import Link from 'next/link'
import type { Recommendation } from '@/lib/article-recommendations'

/**
 * "Keep reading" block, rendered server-side.
 *
 * Deliberately not a client component: these are the section's internal
 * links, and they need to be in the HTML a crawler reads. Because the page
 * revalidates periodically, the set rotates on its own, which spreads link
 * equity across the whole section instead of pinning it to three favourites.
 */
export default function ArticleRecommendations({ items }: { items: Recommendation[] }) {
  if (!items.length) return null
  return (
    <aside style={{ marginTop: 48, paddingTop: 24, borderTop: '1px solid var(--border)' }}>
      <h2 style={{ fontSize: 15, fontWeight: 750, color: 'var(--text-primary)', margin: '0 0 14px', letterSpacing: '-0.01em' }}>
        Keep reading
      </h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {items.map(({ article, shared }) => (
          <Link
            key={article.slug}
            href={`/learn/${article.slug}`}
            style={{
              display: 'block', textDecoration: 'none', padding: '14px 16px', borderRadius: 12,
              border: '1px solid var(--border)', background: 'var(--bg-card)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>
                {article.title}
              </span>
              {shared.map(t => (
                <span key={t} style={{
                  fontSize: 9.5, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase',
                  color: '#a78bfa', border: '1px solid rgba(167,139,250,0.35)', borderRadius: 99, padding: '1px 7px',
                }}>{t}</span>
              ))}
            </div>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, margin: '7px 0 0' }}>
              {article.description}
            </p>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginTop: 6 }}>
              {article.minutes} min read
            </span>
          </Link>
        ))}
      </div>
    </aside>
  )
}
