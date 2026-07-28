'use client'

import { useEffect } from 'react'
import { useAuth } from '@clerk/nextjs'

// Referral attribution for the affiliate program (see lib/affiliates.ts).
//
// A creator link is 100lights.com/?ref=CODE. This leaf:
//   1. captures ?ref= into localStorage on first load (survives the whole
//      sign-up flow — Clerk redirects, email verification, etc.), then
//   2. once the visitor is signed in, redeems that code exactly once. Redeeming
//      grants the new user their bonus Pro perk AND writes the attribution row
//      (code_redemptions) that the affiliate is paid on.
//
// It reads window.location directly rather than Next's useSearchParams so it
// never opts a page out of static prerendering (see app/layout.tsx).

const REF_KEY = '100lights-ref'

// Codes are [A-Z0-9]{3,32}; normalize + validate so a junk ?ref= is ignored.
function cleanRef(raw: string | null): string | null {
  if (!raw) return null
  const c = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
  return /^[A-Z0-9]{3,32}$/.test(c) ? c : null
}

export default function ReferralCapture() {
  const { isLoaded, isSignedIn } = useAuth()

  // Capture ?ref= as early as possible, regardless of auth state.
  useEffect(() => {
    try {
      const ref = cleanRef(new URLSearchParams(window.location.search).get('ref'))
      if (ref) localStorage.setItem(REF_KEY, ref)
    } catch { /* private mode / no storage — nothing to do */ }
  }, [])

  // Once signed in, redeem the stored code a single time.
  useEffect(() => {
    if (!isLoaded || !isSignedIn) return
    let ref: string | null = null
    try { ref = cleanRef(localStorage.getItem(REF_KEY)) } catch { return }
    if (!ref) return

    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/codes/redeem', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: ref }),
        })
        if (cancelled) return
        // Clear on any definitive verdict (granted, or a permanent decline like
        // already-redeemed / unknown code). Only keep it for a genuine retry:
        // rate-limited (429) or a server hiccup (5xx).
        if (res.status !== 429 && res.status < 500) {
          try { localStorage.removeItem(REF_KEY) } catch { /* ignore */ }
        }
      } catch { /* network error — leave the ref for the next load */ }
    })()
    return () => { cancelled = true }
  }, [isLoaded, isSignedIn])

  return null
}
