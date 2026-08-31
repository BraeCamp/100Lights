import { auth } from '@clerk/nextjs/server'
import { testUserId } from '@/lib/api-user'
import { objectExists, presignedRedirect } from '@/lib/r2'

export const runtime = 'nodejs'

// GET /api/render-clip?stamp=… — a render made somewhere other than this laptop.
//
// Brae: "The song would load on the program's backend using server CPU and sent
// the product to the user so that the calculations aren't done on the user's
// device unless they're on offline mode."
//
// ⚠️ WHAT THIS IS AND IS NOT, because a button that quietly does nothing is
// worse than no button.
//
// It SERVES renders. A clip's identity is a content hash of its notes, its
// patch and the tempo (freezeStamp), which is deterministic and identical for
// every user — so a song rendered once can be served to everyone who opens it,
// which is the actual prize. That part works today.
//
// It does NOT yet MAKE renders. Rendering needs a machine that can run Apollo's
// engine, and the routes here cap at 60–120s where a song is minutes of DSP —
// so this cannot be a serverless function. It wants the worker box. Until that
// exists, a song nobody has rendered comes back 404 and the studio says so
// plainly instead of pretending to be loading.
//
// The engine itself is portable (it runs under plain Node with three globals
// shimmed — scripts/apollo-fx-devices.test.mjs does exactly that), so the
// missing piece is infrastructure, not feasibility.

const KEY = (stamp: string) => `renders/${stamp}.m4a`

export async function GET(req: Request) {
  const { userId } = await auth()
  // DEV_OPEN test user, as the assistant route does — lets headless checks
  // exercise this path. Inert in production.
  if (!userId && !testUserId(req)) {
    return Response.json({ error: 'Sign in to use server loading.' }, { status: 401 })
  }

  const stamp = new URL(req.url).searchParams.get('stamp') ?? ''
  // A content hash, nothing else: this becomes a storage key, and a key built
  // from unchecked input is somebody else's bucket.
  if (!/^[A-Za-z0-9_|-]{8,200}$/.test(stamp)) {
    return Response.json({ error: 'Bad stamp' }, { status: 400 })
  }

  const key = KEY(stamp)
  try {
    if (await objectExists(key)) return presignedRedirect(key, 86_400, 3_600)
  } catch {
    return Response.json({ error: 'Storage unavailable', retry: true }, { status: 503 })
  }

  // Not rendered yet, and this cannot render it. Say which, so the client can
  // fall back to its own engine rather than waiting for something that is not
  // coming.
  return Response.json({
    error: 'No server render exists for this part yet.',
    renderer: false,
  }, { status: 404 })
}
