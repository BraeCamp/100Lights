import { auth } from '@clerk/nextjs/server'
import { testUserId } from '@/lib/api-user'
import { objectExists, presignedRedirect, putObject } from '@/lib/r2'
import { refuse, renderClip, type ClipRenderRequest } from '@/lib/apollo/server-render'

export const runtime = 'nodejs'
// A clip renders at roughly 20× realtime, so even a long one is a couple of
// seconds — but the default cap is short enough to cut a cold start plus a big
// clip in half, and a render killed at the finish line is the same as no
// renderer at all.
export const maxDuration = 60

// /api/render-clip — a render made somewhere other than this laptop.
//
// Brae: "The song would load on the program's backend using server CPU and sent
// the product to the user so that the calculations aren't done on the user's
// device unless they're on offline mode."
//
// GET  ?stamp=…  serves a render that already exists.
// POST           makes one that does not, then serves it.
//
// ⚠️ It used to be GET only, and nothing anywhere ever produced a render — so
// every clip 404'd and the studio reported that it had given up. That was the
// bug: a cache with no producer. The old note here said rendering "cannot be a
// serverless function" because a song is minutes of DSP against a 60s cap, and
// that reasoning was sound for a SONG and wrong for what is actually stored.
// The cache is keyed per CLIP, and a clip renders at ~20× realtime in plain
// Node — a dense 32-second one takes 1.4s. See lib/apollo/server-render.ts.
//
// The prize is not really the CPU offload. A clip's identity is a content hash
// of its notes, its patch and the tempo, which is identical for every user — so
// a song rendered once is served to everyone who ever opens it.

const KEY = (stamp: string) => `renders/${stamp}.wav`

// A content hash, nothing else: this becomes a storage key, and a key built
// from unchecked input is somebody else's bucket.
const VALID = /^[A-Za-z0-9_|-]{8,200}$/

async function requireUser(req: Request): Promise<boolean> {
  const { userId } = await auth()
  // DEV_OPEN test user, as the assistant route does — lets headless checks
  // exercise this path. Inert in production.
  return !!userId || !!testUserId(req)
}

export async function GET(req: Request) {
  if (!await requireUser(req)) {
    return Response.json({ error: 'Sign in to use server loading.' }, { status: 401 })
  }

  const stamp = new URL(req.url).searchParams.get('stamp') ?? ''
  if (!VALID.test(stamp)) return Response.json({ error: 'Bad stamp' }, { status: 400 })

  try {
    if (await objectExists(KEY(stamp))) return presignedRedirect(KEY(stamp), 86_400, 3_600)
  } catch {
    return Response.json({ error: 'Storage unavailable', retry: true }, { status: 503 })
  }

  // Nobody has rendered this part yet. `renderer: true` is the part that
  // changed: the client should POST the clip and get it made, rather than
  // giving up on server loading altogether.
  return Response.json({
    error: 'No server render exists for this part yet.',
    renderer: true,
  }, { status: 404 })
}

export async function POST(req: Request) {
  // ⚠️ One catch around the whole thing. An unhandled throw here is a bare 500
  // with an empty body, which tells the studio nothing and sends whoever is
  // debugging it to a log file on the other side of a deploy. Every failure
  // should say what it was.
  try {
    return await handlePost(req)
  } catch (err) {
    return Response.json({
      rendered: false,
      reason: 'render-failed',
      detail: String(err instanceof Error ? err.stack ?? err.message : err).slice(0, 400),
    }, { status: 200 })
  }
}

async function handlePost(req: Request) {
  if (!await requireUser(req)) {
    return Response.json({ error: 'Sign in to use server loading.' }, { status: 401 })
  }

  let body: ClipRenderRequest
  try { body = await req.json() as ClipRenderRequest } catch {
    return Response.json({ error: 'Bad body' }, { status: 400 })
  }

  const key = body?.key ?? ''
  if (!VALID.test(key)) return Response.json({ error: 'Bad stamp' }, { status: 400 })
  if (!body?.patch || !Array.isArray(body?.notes)) {
    return Response.json({ error: 'Bad body' }, { status: 400 })
  }

  // Somebody else may have rendered it in the time this client took to ask.
  try {
    if (await objectExists(KEY(key))) return presignedRedirect(KEY(key), 86_400, 3_600)
  } catch { /* fall through and render; storing is what needs storage */ }

  // ⚠️ Every refusal is a 200, not an error. The studio plays live perfectly
  // well without a server render — the only bad outcome is leaving it waiting
  // for something that is not coming, which is exactly what "gave up trying"
  // was. `rendered: false` plus a reason lets it drop straight back to its own
  // engine and say something true about why.
  const no = refuse(body)
  if (no) return Response.json({ rendered: false, ...no }, { status: 200 })

  let bytes: Uint8Array
  try {
    bytes = await renderClip(body)
  } catch (err) {
    return Response.json({
      rendered: false,
      reason: 'render-failed',
      detail: String(err).slice(0, 200),
    }, { status: 200 })
  }

  // A silent render is a failed render, and storing one poisons the key for
  // every other listener of this song — the cache has no way to tell "this part
  // is meant to be quiet" from "this render did not work".
  if (!hasSound(bytes)) {
    return Response.json({ rendered: false, reason: 'silent' }, { status: 200 })
  }

  try {
    await putObject(KEY(key), bytes, 'audio/wav')
  } catch {
    return Response.json({ error: 'Storage unavailable', retry: true }, { status: 503 })
  }

  // Redirect rather than return the bytes: a serverless response is capped
  // around 4.5MB and a 30-second stereo clip is bigger than that, while R2
  // serves it with no cap and no function time.
  return presignedRedirect(KEY(key), 86_400, 3_600)
}

/** Peak of the 16-bit PCM body, above the 44-byte header. */
function hasSound(wav: Uint8Array): boolean {
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength)
  let peak = 0
  // Every 64th frame: enough to find any audible signal, cheap on a big clip.
  for (let o = 44; o + 1 < wav.byteLength; o += 256) {
    peak = Math.max(peak, Math.abs(view.getInt16(o, true)))
    if (peak > 160) return true   // ≈ -46 dBFS
  }
  return false
}
