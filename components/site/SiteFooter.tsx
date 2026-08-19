// The site-wide footer — every public surface links back into the whole
// constellation from here, so no page is ever one-link-deep again. Registry-
// driven: new modules/apps/tools appear automatically.

import Link from 'next/link'
import { LogoMark } from '@/components/Logo'
import { MODULES, APPS, TOOLS, GAMES } from '@/lib/lights-registry'

function Col({ title, links }: { title: string; links: { href: string; label: string }[] }) {
  return (
    <div>
      <div className="text-xs font-bold uppercase mb-3" style={{ color: 'var(--text-muted)', letterSpacing: '0.08em' }}>
        {title}
      </div>
      <ul className="flex flex-col gap-2" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {links.map(l => (
          <li key={l.href}>
            <Link href={l.href} className="text-xs" style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}>
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function SiteFooter() {
  const studios = MODULES.filter(m => m.status !== 'hidden').map(m => ({ href: m.href, label: m.name }))
  const apps = APPS.filter(a => a.status !== 'hidden' && !a.noindex).map(a => ({ href: a.href, label: a.name }))
  const tools = TOOLS.slice(0, 6).map(t => ({ href: t.href, label: t.name }))

  return (
    <footer className="border-t" style={{ borderColor: 'var(--border)', background: 'var(--bg-base)' }}>
      <div className="max-w-6xl mx-auto px-6 py-12">
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-8 mb-10">
          <Col title="Studios" links={[...studios, { href: '/create', label: 'New project' }]} />
          <Col title="Apps" links={[...apps, { href: '/apps', label: 'All apps →' }]} />
          <Col title="Tools" links={[...tools, { href: '/tools', label: 'All tools →' }]} />
          <Col title="Learn" links={[
            { href: '/learn', label: 'Guides' },
            { href: '/tutorial', label: 'Tutorials' },
            { href: '/learn/paths', label: 'Learning paths' },
            ...GAMES.slice(0, 1).map(g => ({ href: '/play', label: 'Play' })),
          ]} />
          <Col title="100Lights" links={[
            { href: '/store', label: 'Store' },
            { href: '/community', label: 'Community' },
            { href: '/creators', label: 'Creators' },
            { href: '/download', label: 'Desktop app' },
            { href: '/legal/terms', label: 'Terms' },
            { href: '/legal/privacy', label: 'Privacy' },
          ]} />
        </div>
        <div className="flex flex-col sm:flex-row items-center gap-3 sm:justify-between pt-6 border-t" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-2">
            <LogoMark size={22} />
            <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>100Lights</span>
          </div>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>© 2026 100Lights. Built for musicians.</p>
        </div>
      </div>
    </footer>
  )
}
