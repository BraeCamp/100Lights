import { presignedRedirect } from '@/lib/r2'

export const runtime = 'nodejs'

// Public streaming for catalog audio: 302 to a signed URL, edge-cached. The
// signature has to outlive the cache window — see presignedRedirect, which is
// where those two lifetimes are kept in step. Only catalog/ is servable.
export async function GET(req: Request) {
  const key = new URL(req.url).searchParams.get('key')
  if (!key || !key.startsWith('catalog/') || key.includes('..')) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }
  try {
    return presignedRedirect(key)
  } catch {
    return Response.json({ error: 'Unavailable' }, { status: 503 })
  }
}
