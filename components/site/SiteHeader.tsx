// The one simple top bar for everything outside the editors — home, /apps,
// /store, tool and app landing surfaces. Server component (static-friendly);
// auth state lives in the isolated HeaderAuthCta client leaf.

import Link from 'next/link'
import { LogoMark } from '@/components/Logo'
import HeaderAuthCta from '@/components/HeaderAuthCta'

const NAV = [
  { href: '/apps', label: 'Apps' },
  { href: '/community', label: 'Community' },
  { href: '/learn', label: 'Learn' },
  { href: '/#pricing', label: 'Pricing' },
]

export default function SiteHeader() {
  return (
    <header style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-base)' }}>
      <nav
        aria-label="Main navigation"
        className="flex items-center justify-between px-6 py-4 max-w-6xl mx-auto"
      >
        <Link href="/" className="flex items-center gap-2.5" aria-label="100Lights home">
          <LogoMark size={32} />
          <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>100Lights</span>
        </Link>

        <div className="hidden sm:flex items-center gap-6">
          {NAV.map(n => (
            <Link key={n.href} href={n.href} className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              {n.label}
            </Link>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <HeaderAuthCta />
        </div>
      </nav>
    </header>
  )
}
