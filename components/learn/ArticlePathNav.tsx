import Link from 'next/link'

interface Neighbor { slug: string; title: string }

export interface PathNavData {
  pathSlug: string
  pathTitle: string
  emoji: string
  index: number   // 0-based position of the current article
  total: number   // total steps in the path
  prev: Neighbor | null
  next: Neighbor | null
}

/** Compact banner shown near the top of an article that belongs to a path. */
export function ArticlePathBanner({ nav }: { nav: PathNavData }) {
  return (
    <Link href={`/learn/paths/${nav.pathSlug}`} style={{ textDecoration: 'none', display: 'block', marginBottom: 24 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 11,
        background: 'var(--accent-subtle)', border: '1px solid rgba(139,92,246,0.28)',
      }}>
        <span aria-hidden style={{ fontSize: 17, lineHeight: 1 }}>{nav.emoji}</span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--accent-light)' }}>
            Part {nav.index + 1} of {nav.total} · Learning path
          </div>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nav.pathTitle}</div>
        </div>
        <span aria-hidden style={{ color: 'var(--accent-light)', fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap' }}>View path →</span>
      </div>
    </Link>
  )
}

/** Prominent "next in this path" footer shown at the end of the article. */
export function ArticlePathFooter({ nav }: { nav: PathNavData }) {
  return (
    <section style={{ marginTop: 40 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
        <h2 style={{ fontSize: 15, fontWeight: 750, color: 'var(--text-primary)', margin: 0 }}>
          {nav.emoji} {nav.pathTitle}
        </h2>
        <Link href={`/learn/paths/${nav.pathSlug}`} style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--accent-light)', textDecoration: 'none', whiteSpace: 'nowrap' }}>
          Full path ({nav.total}) →
        </Link>
      </div>

      {nav.next ? (
        <Link href={`/learn/${nav.next.slug}`} style={{ textDecoration: 'none', display: 'block' }}>
          <div style={{
            padding: '18px 20px', borderRadius: 14, border: '1px solid rgba(139,92,246,0.35)',
            background: 'linear-gradient(135deg, rgba(124,58,237,0.14), rgba(59,130,246,0.08))',
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--accent-light)', marginBottom: 5 }}>
              Next in this path · Part {nav.index + 2} of {nav.total}
            </div>
            <div style={{ fontSize: 16.5, fontWeight: 750, color: 'var(--text-primary)', lineHeight: 1.3 }}>{nav.next.title} →</div>
          </div>
        </Link>
      ) : (
        <div style={{
          padding: '18px 20px', borderRadius: 14, border: '1px solid var(--border)', background: 'var(--bg-card)',
        }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-primary)' }}>🎉 That’s the last guide in this path.</div>
          <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 3 }}>
            <Link href={`/learn/paths/${nav.pathSlug}`} style={{ color: 'var(--accent-light)', textDecoration: 'none' }}>Review the whole path</Link> or explore another.
          </div>
        </div>
      )}

      {nav.prev && (
        <Link href={`/learn/${nav.prev.slug}`} style={{ textDecoration: 'none', display: 'inline-block', marginTop: 12 }}>
          <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>← Previous: <span style={{ color: 'var(--text-secondary)' }}>{nav.prev.title}</span></span>
        </Link>
      )}
    </section>
  )
}
