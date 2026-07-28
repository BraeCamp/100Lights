import { auth } from '@clerk/nextjs/server'
import { getReads, markReads } from '@/lib/reading-progress'

export const runtime = 'nodejs'

// GET /api/learn/progress — the signed-in user's read slugs (empty for guests).
export async function GET() {
  const { userId } = await auth()
  if (!userId) return Response.json({ signedIn: false, reads: [] })
  return Response.json({ signedIn: true, reads: await getReads(userId) })
}

// POST /api/learn/progress — record read slugs. Body: { slug } or { slugs: [] }.
// Guests get a friendly no-op (200, not 401) so the client never logs an error.
export async function POST(req: Request) {
  const { userId } = await auth()
  if (!userId) return Response.json({ signedIn: false })
  const body = await req.json().catch(() => ({})) as { slug?: string; slugs?: string[] }
  const slugs = Array.isArray(body.slugs) ? body.slugs : body.slug ? [body.slug] : []
  await markReads(userId, slugs)
  return Response.json({ signedIn: true, ok: true })
}
