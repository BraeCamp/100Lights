// Streams remote broadcast audio through our origin so Web Audio can analyse it (a cross-origin
// <audio> element taints the analyser and the visualizer would read silence). Host-allowlisted so
// it can't be used as an open proxy. Forwards Range so the <audio> element can seek/buffer.
import { NextRequest } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Only stream from known free/licensed music hosts. Add hosts here as you add sources.
const ALLOW_HOSTS = [
  'jamendo.com', 'mp3d.jamendo.com', 'mp3l.jamendo.com', 'prod-1.storage.jamendo.com',
  'cdn.pixabay.com', 'pixabay.com',
  'files.freemusicarchive.org', 'freemusicarchive.org',
  'incompetech.com', 'dl.dropboxusercontent.com', 'archive.org', 'ia800000.us.archive.org',
  'scottbuckley.com.au',
]
const allowed = (h: string) => ALLOW_HOSTS.some(a => h === a || h.endsWith('.' + a) || h === a.replace(/^www\./, ''))

export async function GET(req: NextRequest) {
  const src = req.nextUrl.searchParams.get('src')
  if (!src) return new Response('Missing src', { status: 400 })
  let u: URL
  try { u = new URL(src) } catch { return new Response('Bad src', { status: 400 }) }
  if (u.protocol !== 'https:') return new Response('https only', { status: 400 })
  if (!allowed(u.hostname)) return new Response('Host not allowed', { status: 403 })

  const range = req.headers.get('range') || undefined
  let upstream: Response
  try {
    upstream = await fetch(u.toString(), { headers: range ? { Range: range } : {}, redirect: 'follow' })
  } catch {
    return new Response('Upstream fetch failed', { status: 502 })
  }
  if (!upstream.ok && upstream.status !== 206) return new Response('Upstream error', { status: 502 })

  const headers = new Headers()
  const copy = (k: string) => { const v = upstream.headers.get(k); if (v) headers.set(k, v) }
  copy('content-type'); copy('content-length'); copy('content-range'); copy('accept-ranges'); copy('cache-control')
  if (!headers.has('content-type')) headers.set('content-type', 'audio/mpeg')
  if (!headers.has('accept-ranges')) headers.set('accept-ranges', 'bytes')
  headers.set('access-control-allow-origin', '*')
  return new Response(upstream.body, { status: upstream.status, headers })
}
