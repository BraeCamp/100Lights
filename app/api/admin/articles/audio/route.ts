import { isAdmin } from '@/lib/admin-auth'
import { putObject } from '@/lib/r2'

export const runtime = 'nodejs'
export const maxDuration = 60

// Admin-only: upload article audio. The bytes are sent to THIS route and
// pushed to R2 server-side — no browser→R2 PUT, so it can't be blocked by
// cross-origin CORS/CSP from whatever origin the admin panel runs on. Files
// live under learn-audio/, the only prefix the public streaming route serves.
const MAX_BYTES = 25 * 1024 * 1024   // 25 MB — article clips are short

export async function POST(req: Request) {
  if (!await isAdmin()) return Response.json({ error: 'Not signed in as admin' }, { status: 401 })

  const type = req.headers.get('content-type') || 'audio/mpeg'
  if (!/^audio\//.test(type)) return Response.json({ error: `Audio files only (got "${type}")` }, { status: 400 })

  const name = (new URL(req.url).searchParams.get('name') || 'audio').replace(/[^\w.-]+/g, '_').slice(0, 80)
  const buf = await req.arrayBuffer()
  if (buf.byteLength === 0) return Response.json({ error: 'Empty upload' }, { status: 400 })
  if (buf.byteLength > MAX_BYTES) return Response.json({ error: 'File too large (max 25 MB for article audio)' }, { status: 413 })

  const ext = type.includes('wav') ? 'wav' : type.includes('webm') ? 'webm' : type.includes('ogg') ? 'ogg' : type.includes('mp4') || type.includes('m4a') ? 'm4a' : 'mp3'
  const key = `learn-audio/${crypto.randomUUID()}-${name}.${ext}`
  try {
    await putObject(key, buf, type)
  } catch (e) {
    return Response.json({ error: `R2 upload failed: ${e instanceof Error ? e.message : 'unknown'}` }, { status: 502 })
  }
  return Response.json({ key, url: `/api/learn-audio?key=${encodeURIComponent(key)}` })
}
