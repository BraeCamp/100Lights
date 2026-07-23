'use client'

// The landing hero's primary CTA, auth-aware and isolated as a client component
// so app/page.tsx stays statically prerendered (a server-side auth() call would
// force per-request rendering and hurt TTFB/SEO). Crawlers and the first paint
// see the guest CTA — "Start making music" straight into the free, no-signup
// studio — which swaps to "Open your studio" once Clerk confirms a signed-in
// user. Signup is captured later, at Save/Export, not up front.

import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { useUser } from '@clerk/nextjs'

const DEFAULT_CLASS = 'w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold'

export default function HeroCta({ className, guestLabel = 'Start making music' }: { className?: string; guestLabel?: string }) {
  const { isSignedIn } = useUser()
  const href = isSignedIn ? '/dashboard' : '/new?modules=audio'
  const label = isSignedIn ? 'Open your studio' : guestLabel
  return (
    <Link
      href={href}
      className={className ?? DEFAULT_CLASS}
      style={{ background: 'var(--accent)', color: '#fff' }}
    >
      {label} <ArrowRight size={15} aria-hidden="true" />
    </Link>
  )
}
