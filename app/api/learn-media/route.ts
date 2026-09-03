import { presignedRedirect } from '@/lib/r2'

export const runtime = 'nodejs'

// Public streaming for article images + video — mirrors the learn-audio route:
// 302 to a signed URL that outlives the edge cache, so repeat loads reuse it. The
// browser follows the redirect to R2, which honours Range requests, so video
// seeking works. Only the learn-media/ prefix is servable.
export async function GET(req: Request) {
  const key = new URL(req.url).searchParams.get('key')
  if (!key || !key.startsWith('learn-media/') || key.includes('..')) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }
  try {
    // Images/video don't change once uploaded (new upload = new key), so the
    // edge cache can be generous; presignedRedirect keeps the signature alive
    // longer than the cache, which is what this route got wrong before.
    return presignedRedirect(key)
  } catch {
    return Response.json({ error: 'Unavailable' }, { status: 503 })
  }
}
