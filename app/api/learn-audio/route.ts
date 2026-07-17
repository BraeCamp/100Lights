import { presignDownload } from '@/lib/r2'

export const runtime = 'nodejs'

// Public streaming for article audio — mirrors the community audio route:
// 302 to a short-lived signed URL, edge-cached so repeat plays reuse it.
// Only the learn-audio/ prefix is servable.
export async function GET(req: Request) {
  const key = new URL(req.url).searchParams.get('key')
  if (!key || !key.startsWith('learn-audio/') || key.includes('..')) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }
  try {
    const url = await presignDownload(key, 900)
    return new Response(null, {
      status: 302,
      headers: {
        Location: url,
        'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=60',
      },
    })
  } catch {
    return Response.json({ error: 'Unavailable' }, { status: 503 })
  }
}
