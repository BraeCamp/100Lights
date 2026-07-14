'use client'

import { useEffect, useRef } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { useUser } from '@clerk/nextjs'
import posthog from 'posthog-js'

let initialised = false

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { user } = useUser()
  const identifiedRef = useRef(false)

  useEffect(() => {
    if (initialised || !process.env.NEXT_PUBLIC_POSTHOG_KEY) return
    posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY, {
      api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com',
      capture_pageview: false, // we fire manually below so Next.js route changes are caught
      persistence: 'localStorage',
    })
    initialised = true

    // Crash visibility for the beta: uncaught errors and promise rejections
    // land in PostHog with stack traces, tied to the user who hit them.
    const onError = (e: ErrorEvent) => {
      posthog.capture('$exception', {
        message: e.message,
        source: e.filename ? `${e.filename}:${e.lineno}:${e.colno}` : undefined,
        stack: e.error instanceof Error ? e.error.stack?.slice(0, 4000) : undefined,
        url: window.location.pathname,
      })
    }
    const onRejection = (e: PromiseRejectionEvent) => {
      const r = e.reason
      posthog.capture('$exception', {
        message: r instanceof Error ? r.message : String(r).slice(0, 500),
        stack: r instanceof Error ? r.stack?.slice(0, 4000) : undefined,
        unhandled_rejection: true,
        url: window.location.pathname,
      })
    }
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
  }, [])

  // Identify the logged-in user so events are tied to their account
  useEffect(() => {
    if (!user || identifiedRef.current) return
    posthog.identify(user.id, {
      email: user.primaryEmailAddress?.emailAddress,
      name: user.fullName ?? user.firstName,
    })
    identifiedRef.current = true
  }, [user])

  // Track page views on every route change
  useEffect(() => {
    if (!initialised) return
    const url = pathname + (searchParams.toString() ? `?${searchParams}` : '')
    posthog.capture('$pageview', { $current_url: url })
  }, [pathname, searchParams])

  return <>{children}</>
}
