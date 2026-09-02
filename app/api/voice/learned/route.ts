import { auth } from '@clerk/nextjs/server'
import { approvedShared, contributeShared } from '@/lib/voice/shared-learned'

export const runtime = 'nodejs'

/**
 * The commands every studio has been taught.
 *
 * Brae, on pooling the learned cache: "The pooled cache and macro ideas don't
 * seem to require much fund at all."
 *
 * ⚠️ READABLE WITHOUT SIGNING IN, because this is not anybody's data — it is a
 * list of phrasings and the tool each one means, with every argument replaced
 * by a slot before it ever left the browser. A guest benefits from it exactly
 * as much as an account does, and a studio that understands people on their
 * first visit is the whole point.
 *
 * Cached hard: it changes when somebody approves an entry, not when anybody
 * speaks, so an hour of staleness costs nothing and saves every studio a
 * request on every load.
 */
export async function GET() {
  try {
    const rows = await approvedShared()
    return Response.json({ entries: rows }, {
      headers: { 'cache-control': 'public, max-age=600, s-maxage=3600, stale-while-revalidate=86400' },
    })
  } catch {
    // ⚠️ An empty pool, not an error. Every studio works perfectly well on its
    // own cache and rules; this is an improvement on top, and a database that
    // is having a bad morning must not take the voice control down with it.
    return Response.json({ entries: [] }, { headers: { 'cache-control': 'no-store' } })
  }
}

/**
 * Offer a template that the assistant just worked out.
 *
 * Signed in only — not to gate the feature but so that "nine people said this"
 * means nine people. Contributions are invisible until reviewed.
 */
export async function POST(req: Request) {
  const { userId } = await auth()
  if (!userId) return Response.json({ ok: false, reason: 'not signed in' }, { status: 401 })
  let body: { template?: unknown; calls?: unknown }
  try { body = await req.json() } catch { return Response.json({ ok: false, reason: 'bad json' }, { status: 400 }) }

  try {
    const res = await contributeShared(
      userId,
      String(body.template ?? ''),
      body.calls as { name: string; input: Record<string, unknown> }[],
    )
    return Response.json(res, { status: res.ok ? 200 : 400 })
  } catch (e) {
    // Never worth telling the studio about: contributing is a gift, and a
    // failed gift should not look like a failed command.
    console.error('[voice/learned] contribute failed', e)
    return Response.json({ ok: false, reason: 'could not store' }, { status: 500 })
  }
}
