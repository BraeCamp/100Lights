// Proxy to fetch an audio file from an external URL, bypassing browser CORS.
// SSRF-hardened: auth required, only http/https, and the target (plus every
// redirect hop) must resolve to a PUBLIC address — never loopback, private,
// link-local, or cloud-metadata ranges.
import { auth } from '@clerk/nextjs/server'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

export const runtime = 'nodejs'

const MAX_BYTES = 100 * 1024 * 1024   // 100 MB cap on proxied bodies
const MAX_REDIRECTS = 3

// True if an IP literal is in a range we must never proxy to.
function isBlockedIp(ip: string): boolean {
  const v = isIP(ip)
  if (v === 4) {
    const p = ip.split('.').map(Number)
    if (p.length !== 4 || p.some(n => Number.isNaN(n) || n < 0 || n > 255)) return true
    const [a, b] = p
    return (
      a === 0 || a === 10 || a === 127 ||                       // this-net, private, loopback
      (a === 169 && b === 254) ||                               // link-local (incl. 169.254.169.254 metadata)
      (a === 172 && b >= 16 && b <= 31) ||                      // private
      (a === 192 && b === 168) ||                               // private
      (a === 100 && b >= 64 && b <= 127) ||                     // CGNAT
      (a === 192 && b === 0 && p[2] === 0) ||                   // 192.0.0.0/24
      a >= 224                                                  // multicast / reserved
    )
  }
  if (v === 6) {
    const lower = ip.toLowerCase()
    // IPv4-mapped (::ffff:a.b.c.d) — validate the embedded v4.
    const mapped = lower.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)
    if (mapped) return isBlockedIp(mapped[1])
    return (
      lower === '::1' || lower === '::' ||                      // loopback / unspecified
      lower.startsWith('fe80') ||                              // link-local
      lower.startsWith('fc') || lower.startsWith('fd') ||       // unique-local (fc00::/7)
      lower.startsWith('fd00:ec2') ||                          // AWS IPv6 metadata
      lower.startsWith('ff')                                    // multicast
    )
  }
  return true   // not a valid IP → refuse
}

// Resolve the host and ensure every resolved address is public.
async function assertPublicHost(host: string): Promise<void> {
  if (isIP(host)) {
    if (isBlockedIp(host)) throw new Error('blocked address')
    return
  }
  const addrs = await lookup(host, { all: true })
  if (!addrs.length) throw new Error('unresolvable host')
  for (const a of addrs) if (isBlockedIp(a.address)) throw new Error('blocked address')
}

export async function GET(req: Request): Promise<Response> {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const start = searchParams.get('url')
  if (!start) return Response.json({ error: 'Missing url parameter' }, { status: 400 })

  try {
    // Follow redirects manually, re-validating the host at every hop so a
    // public URL can't 3xx-redirect us onto an internal address.
    let current = start
    let upstream: Response | null = null
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      let parsed: URL
      try { parsed = new URL(current) } catch { return Response.json({ error: 'Invalid URL' }, { status: 400 }) }
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return Response.json({ error: 'Only http/https URLs are allowed' }, { status: 400 })
      }
      await assertPublicHost(parsed.hostname)

      const res = await fetch(current, {
        redirect: 'manual',
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ContentForge/1.0)' },
        signal: AbortSignal.timeout(20000),
      })
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location')
        if (!loc) return Response.json({ error: 'Redirect without location' }, { status: 502 })
        current = new URL(loc, current).toString()
        continue
      }
      upstream = res
      break
    }
    if (!upstream) return Response.json({ error: 'Too many redirects' }, { status: 502 })
    if (!upstream.ok) return Response.json({ error: `Remote returned ${upstream.status}` }, { status: 502 })

    const len = Number(upstream.headers.get('content-length') ?? 0)
    if (len > MAX_BYTES) return Response.json({ error: 'File too large' }, { status: 413 })
    const body = await upstream.arrayBuffer()
    if (body.byteLength > MAX_BYTES) return Response.json({ error: 'File too large' }, { status: 413 })
    const ct = upstream.headers.get('content-type') ?? 'audio/mpeg'
    return new Response(body, { headers: { 'Content-Type': ct, 'Cache-Control': 'no-store' } })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    // Don't leak internal detail for blocked targets.
    if (msg === 'blocked address' || msg === 'unresolvable host') {
      return Response.json({ error: 'That URL can’t be fetched.' }, { status: 400 })
    }
    return Response.json({ error: `Fetch failed: ${msg}` }, { status: 502 })
  }
}
