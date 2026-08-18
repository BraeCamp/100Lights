import * as Sentry from '@sentry/nextjs'

// Initialize the Sentry SDK for whichever server runtime this instrumentation loads in. Without these
// imports the Sentry.init() in sentry.{server,edge}.config never runs on the server, so server-side
// errors silently never reached Sentry (they only went to PostHog via onRequestError below) — which is
// why the Sentry project showed zero events despite the DSN being wired.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config')
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config')
  }
}

// Server-side error visibility: uncaught errors in API routes and server components go to BOTH
//   • Sentry, via the canonical App Router onRequestError hook (captureRequestError) — previously missing
//   • PostHog as $exception events (mirrors the client-side capture in PostHogProvider), so beta reports
//     come with server stacks too.
export async function onRequestError(
  err: unknown,
  request: { path: string; method: string; headers: Record<string, string | string[] | undefined> },
  context: { routerKind: string; routePath: string; routeType: string },
) {
  // Sentry first, synchronously — don't let a failing PostHog fetch swallow the Sentry report.
  Sentry.captureRequestError(err, request, context)

  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY
  if (!key) return
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com'
  const e = err instanceof Error ? err : new Error(String(err))
  try {
    await fetch(`${host}/i/v0/e/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: key,
        event: '$exception',
        distinct_id: 'server',
        properties: {
          message: e.message,
          stack: e.stack?.slice(0, 4000),
          path: request.path,
          method: request.method,
          route: context.routePath,
          route_type: context.routeType,
          server_side: true,
        },
      }),
    })
  } catch { /* never let telemetry break error handling */ }
}
