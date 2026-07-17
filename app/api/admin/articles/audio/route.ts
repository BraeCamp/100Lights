import { isAdmin } from '@/lib/admin-auth'
import { presignUpload } from '@/lib/r2'

export const runtime = 'nodejs'

// Admin-only: mint an upload slot for article audio. Files live under the
// learn-audio/ prefix, which is the only prefix the public streaming route
// will serve — article audio can never leak arbitrary user files.
export async function POST(req: Request) {
  if (!await isAdmin()) return new Response('Unauthorized', { status: 401 })
  let body: { filename?: string; contentType?: string }
  try { body = await req.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const safe = (body.filename ?? 'audio').replace(/[^\w.-]+/g, '_').slice(0, 80)
  const type = body.contentType ?? 'audio/mpeg'
  if (!/^audio\//.test(type)) return Response.json({ error: 'Audio files only' }, { status: 400 })
  const key = `learn-audio/${crypto.randomUUID()}-${safe}`
  const url = await presignUpload(key, type)
  return Response.json({ key, url })
}
