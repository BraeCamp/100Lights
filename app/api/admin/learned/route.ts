import { isAdmin } from '@/lib/admin-auth'
import { allShared, setSharedState } from '@/lib/voice/shared-learned'

export const runtime = 'nodejs'

/**
 * Review what the studios have taught each other.
 *
 * ⚠️ NOTHING REACHES ANOTHER USER UNTIL SOMEBODY HERE SAYS SO. A pooled entry
 * acts on other people's songs, which is a different risk in kind from a cache
 * that only ever answers its own author — so approval is a person, not a
 * threshold, until there is enough evidence to loosen it. The contributor count
 * is what that evidence looks like: "said by nine different people" is a very
 * different row from "said by one person once".
 */
export async function GET() {
  if (!await isAdmin()) return new Response('Unauthorized', { status: 401 })
  try {
    return Response.json({ entries: await allShared() })
  } catch (e) {
    return Response.json({ entries: [], error: String(e) }, { status: 500 })
  }
}

export async function PATCH(req: Request) {
  if (!await isAdmin()) return new Response('Unauthorized', { status: 401 })
  let body: { id?: string; approved?: boolean; blocked?: boolean }
  try { body = await req.json() } catch { return new Response('bad json', { status: 400 }) }
  if (!body.id) return new Response('no id', { status: 400 })
  await setSharedState(body.id, { approved: body.approved, blocked: body.blocked })
  return Response.json({ ok: true })
}
