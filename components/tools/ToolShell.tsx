import Link from 'next/link'

/**
 * Shared frame for the free-tool pages.
 *
 * Every tool is a small, genuinely useful standalone widget with a quiet path
 * into the full studio — not a paywall or a teaser. The "open in the studio"
 * link at the bottom is the whole funnel: someone lands here from a search,
 * gets what they came for, and finds the studio only if they want more.
 */
export default function ToolShell({
  title,
  intro,
  children,
  studioHref = '/new?modules=audio',
  studioLabel = 'Open the full studio',
}: {
  title: string
  intro: string
  children: React.ReactNode
  studioHref?: string
  studioLabel?: string
}) {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)' }}>
      <main id="main" className="max-w-2xl mx-auto px-6 py-14">
        <nav style={{ marginBottom: 24, display: 'flex', gap: 16, fontSize: 13 }}>
          <Link href="/" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>100Lights</Link>
          <Link href="/tools" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>Tools</Link>
        </nav>

        <header style={{ marginBottom: 28 }}>
          <h1 style={{ fontSize: 32, fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 10px', letterSpacing: '-0.02em' }}>{title}</h1>
          <p style={{ fontSize: 15, color: 'var(--text-secondary)', lineHeight: 1.65, margin: 0 }}>{intro}</p>
        </header>

        {children}

        <aside style={{
          marginTop: 40, padding: '20px 22px', borderRadius: 14,
          background: 'linear-gradient(135deg, rgba(124,58,237,0.10), rgba(59,130,246,0.06))',
          border: '1px solid rgba(139,92,246,0.25)',
          display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
        }}>
          <div style={{ flex: '1 1 260px' }}>
            <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 3px' }}>Want to make the whole track?</p>
            <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.55 }}>
              This is one piece of the 100Lights studio — a full DAW that runs in your browser, free, no downloads.
            </p>
          </div>
          <Link href={studioHref} style={{
            flexShrink: 0, display: 'inline-block', padding: '10px 20px', borderRadius: 10,
            background: 'var(--accent)', color: '#fff', fontSize: 13.5, fontWeight: 700, textDecoration: 'none',
          }}>{studioLabel}</Link>
        </aside>
      </main>
    </div>
  )
}
