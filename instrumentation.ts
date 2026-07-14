// Server-side error visibility: uncaught errors in API routes and server
// components land in PostHog as $exception events (mirrors the client-side
// capture in PostHogProvider), so beta reports come with server stacks too.

export function register() {
  // no-op — required export
}

export async function onRequestError(
  err: unknown,
  request: { path: string; method: string },
  context: { routerKind: string; routePath: string; routeType: string },
) {
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
