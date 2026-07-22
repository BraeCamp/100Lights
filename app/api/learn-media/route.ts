import { presignDownload } from '@/lib/r2'

export const runtime = 'nodejs'

// Public streaming for article images + video — mirrors the learn-audio route:
// 302 to a short-lived signed URL, edge-cached so repeat loads reuse it. The
// browser follows the redirect to R2, which honours Range requests, so video
// seeking works. Only the learn-media/ prefix is servable.
export async function GET(req: Request) {
  const key = new URL(req.url).searchParams.get('key')
  if (!key || !key.startsWith('learn-media/') || key.includes('..')) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }
  try {
    const url = await presignDownload(key, 900)
    return new Response(null, {
      status: 302,
      headers: {
        Location: url,
        // Images/video don't change once uploaded (new upload = new key), so a
        // longer edge cache than audio is safe.
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=300',
      },
    })
  } catch {
    return Response.json({ error: 'Unavailable' }, { status: 503 })
  }
}
