'use client'

import { usePathname } from 'next/navigation'

// Embed pages (/embed/[id]) are bare widgets rendered inside a third-party
// iframe, so they must NOT carry the site chrome/analytics that the root layout
// mounts for everyone else (announcement banner, age gate, referral capture,
// PostHog, service worker). This renders its children everywhere EXCEPT /embed —
// on an embed route the wrapped chrome never mounts, so none of that JS runs in
// the iframe. (usePathname is client-side, so this doesn't force dynamic
// rendering the way reading headers() in the root layout would.)
export function HideOnEmbed({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  if (pathname?.startsWith('/embed/')) return null
  return <>{children}</>
}
