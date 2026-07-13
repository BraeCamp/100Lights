import { auth } from '@clerk/nextjs/server'
import { presignDownload } from '@/lib/r2'

export async function GET(req: Request) {
  const { userId } = await auth()
  // DEV_OPEN test collaborators (mirrors /api/liveblocks-auth) — dev builds only
  const testUser = process.env.DEV_OPEN === '1' && process.env.NODE_ENV !== 'production'
    ? req.headers.get('x-test-user')
    : null
  if (!userId && !testUser) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const key = new URL(req.url).searchParams.get('key')
  if (!key) return Response.json({ error: 'Missing key' }, { status: 400 })

  // Any signed-in user may resolve a key. Keys are unguessable
  // (<ownerId>/<uuid>.<ext>) and travel only inside project data, so access
  // follows the same capability model as invite-by-link collaboration —
  // collaborators must be able to fetch the owner's clip audio.

  // 24-hour expiry — generous enough for a long editing session
  const url = await presignDownload(key, 86400)
  return Response.json({ url })
}
