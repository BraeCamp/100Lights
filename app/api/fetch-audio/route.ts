// Proxy to fetch an audio file from an external URL, bypassing browser CORS.
// Only allows http/https and forwards the raw bytes.

export async function GET(req: Request): Promise<Response> {
  const { searchParams } = new URL(req.url)
  const url = searchParams.get('url')

  if (!url) return Response.json({ error: 'Missing url parameter' }, { status: 400 })

  let parsed: URL
  try { parsed = new URL(url) } catch {
    return Response.json({ error: 'Invalid URL' }, { status: 400 })
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return Response.json({ error: 'Only http/https URLs are allowed' }, { status: 400 })
  }

  try {
    const upstream = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ContentForge/1.0)' },
      signal: AbortSignal.timeout(20000),
    })
    if (!upstream.ok) {
      return Response.json({ error: `Remote returned ${upstream.status}` }, { status: 502 })
    }
    const ct   = upstream.headers.get('content-type') ?? 'audio/mpeg'
    const body = await upstream.arrayBuffer()
    return new Response(body, {
      headers: { 'Content-Type': ct, 'Cache-Control': 'no-store' },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return Response.json({ error: `Fetch failed: ${msg}` }, { status: 502 })
  }
}
