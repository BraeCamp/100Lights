// Who is this request? One answer, for every API route.
//
// Twelve routes had each written this out by hand, and they had already
// drifted: ten used the x-test-user header verbatim as the user id while
// /api/apollo/presets prefixed it with "test-". So the same headless user owned
// their Apollo presets under one id and their projects under another. Identity
// is the wrong thing to re-derive per route — a mistake here is an
// authorisation mistake, and it is invisible until someone reads two files side
// by side.
//
// The header is honoured ONLY in development builds with DEV_OPEN=1, exactly as
// before. In production this collapses to "whatever Clerk says", and there is
// now one line to audit rather than twelve.

import { auth } from '@clerk/nextjs/server'

/** True only where synthetic users are allowed: dev builds with DEV_OPEN=1. */
export function testUsersAllowed(): boolean {
  return process.env.DEV_OPEN === '1' && process.env.NODE_ENV !== 'production'
}

/**
 * The synthetic user a headless tool is acting as, or null.
 *
 * Returns the header verbatim — the format the other ten routes already used,
 * and the one that keeps a test user's rows together across tables.
 */
export function testUserId(req: Request): string | null {
  if (!testUsersAllowed()) return null
  const raw = req.headers.get('x-test-user')
  return raw && raw.trim() ? raw.trim() : null
}

/** The signed-in user, falling back to a synthetic one in dev. Null = nobody. */
export async function currentUserId(req: Request): Promise<string | null> {
  const { userId } = await auth()
  return userId ?? testUserId(req)
}

/**
 * The signed-in user, or a 401 to return.
 *
 * Written as a discriminated result rather than a throw so a route reads
 * straight down: `const who = await requireUserId(req); if ('response' in who)
 * return who.response`.
 */
export async function requireUserId(
  req: Request,
): Promise<{ userId: string } | { response: Response }> {
  const userId = await currentUserId(req)
  if (!userId) {
    return {
      response: new Response(JSON.stringify({ error: 'Not signed in' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
    }
  }
  return { userId }
}
