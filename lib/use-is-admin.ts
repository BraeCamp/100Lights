'use client'

import { useUser } from '@clerk/nextjs'
import { isAdminAddress } from '@/lib/admin-email'

/**
 * Is the person at the keyboard an admin?
 *
 * Email match only — the same question lib/admin-auth.ts asks, minus the
 * cookie. That cookie exists to gate the /admin area, where things can be
 * changed; this gates read-only tools inside the studio, and demanding a
 * separate login to read a level meter would mean nobody ever uses them.
 *
 * Returns undefined until Clerk has answered, so a menu can stay hidden rather
 * than flickering into view and back out again.
 */
export function useIsAdmin(): boolean | undefined {
  const { user, isLoaded } = useUser()
  // DEVELOPMENT ONLY seam, so the admin-only UI can actually be tested.
  //
  // Clerk cannot be signed in from a headless run, so without this a check can
  // only ever prove the menu is HIDDEN — which is the half that would pass just
  // as well if the menu did not exist. Gated on NODE_ENV rather than the
  // DAW_HOOKS flag, because that flag can be switched on for a production
  // bundle and this must never be.
  if (process.env.NODE_ENV === 'development'
    && typeof window !== 'undefined'
    && (window as unknown as { __forceAdmin?: boolean }).__forceAdmin) return true
  if (!isLoaded) return undefined
  const email = user?.primaryEmailAddress?.emailAddress
    ?? user?.emailAddresses?.[0]?.emailAddress
  return isAdminAddress(email)
}
