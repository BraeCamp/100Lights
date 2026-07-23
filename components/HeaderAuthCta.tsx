'use client'

// The landing-page header's auth-aware CTA, isolated into a client component so
// the page itself can prerender statically (no server-side auth() call, which
// would force per-request dynamic rendering and hurt TTFB/SEO). Crawlers and the
// first paint see the signed-out CTA; it swaps to Dashboard once Clerk hydrates.

import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { useUser } from '@clerk/nextjs'

export default function HeaderAuthCta() {
  const { isSignedIn } = useUser()

  if (isSignedIn) {
    return (
      <Link
        href="/dashboard"
        className="flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-lg"
        style={{ background: 'var(--accent)', color: '#fff' }}
      >
        Dashboard <ArrowRight size={14} aria-hidden="true" />
      </Link>
    )
  }
  return (
    <>
      <Link href="/sign-in" className="text-sm" style={{ color: 'var(--text-secondary)' }}>Sign in</Link>
      <Link
        href="/sign-up"
        className="flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-lg"
        style={{ background: 'var(--accent)', color: '#fff' }}
      >
        Get started
      </Link>
    </>
  )
}
