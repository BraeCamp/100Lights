import { presignDownload } from '@/lib/r2'

export const runtime = 'nodejs'

// Public streaming for catalog audio — mirrors /api/learn-audio: 302 to a
// short-lived signed URL, edge-cached. Only the catalog/ prefix is servable.
export async function GET(req: Request) {
  const key = new URL(req.url).searchParams.get('key')
  if (!key || !key.startsWith('catalog/') || key.includes('..')) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }
  try {
    const url = await presignDownload(key, 900)
    return new Response(null, {
      status: 302,
      headers: { Location: url, 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=300' },
    })
  } catch {
    return Response.json({ error: 'Unavailable' }, { status: 503 })
  }
}
