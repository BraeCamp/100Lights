import { isAdmin } from '@/lib/admin-auth'
import { putObject, deleteObject } from '@/lib/r2'

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

  const params = new URL(req.url).searchParams
  const name = (params.get('name') || 'audio').replace(/[^\w.-]+/g, '_').slice(0, 80)
  const buf = await req.arrayBuffer()
  if (buf.byteLength === 0) return Response.json({ error: 'Empty upload' }, { status: 400 })
  if (buf.byteLength > MAX_BYTES) return Response.json({ error: 'File too large (max 25 MB for article audio)' }, { status: 413 })

  // In-place overwrite: when `key` names an existing learn-audio object, write
  // back to it so an edit replaces the source instead of minting a new file.
  // Guard the prefix + traversal so only the servable prefix can be targeted.
  const targetKey = params.get('key')
  const ext = type.includes('wav') ? 'wav' : type.includes('webm') ? 'webm' : type.includes('ogg') ? 'ogg' : type.includes('mp4') || type.includes('m4a') ? 'm4a' : 'mp3'
  let key: string
  if (targetKey) {
    if (!targetKey.startsWith('learn-audio/') || targetKey.includes('..')) {
      return Response.json({ error: 'Invalid target key' }, { status: 400 })
    }
    key = targetKey
  } else {
    key = `learn-audio/${crypto.randomUUID()}-${name}.${ext}`
  }
  try {
    await putObject(key, buf, type)
  } catch (e) {
    return Response.json({ error: `R2 upload failed: ${e instanceof Error ? e.message : 'unknown'}` }, { status: 502 })
  }
  return Response.json({ key, url: `/api/learn-audio?key=${encodeURIComponent(key)}` })
}

// DELETE /api/admin/articles/audio?key=learn-audio/… — remove an uploaded clip
// (e.g. an orphan no article references anymore). Guarded to the servable prefix.
export async function DELETE(req: Request) {
  if (!await isAdmin()) return Response.json({ error: 'Not signed in as admin' }, { status: 401 })
  const key = new URL(req.url).searchParams.get('key')
  if (!key || !key.startsWith('learn-audio/') || key.includes('..')) {
    return Response.json({ error: 'Invalid key' }, { status: 400 })
  }
  try {
    await deleteObject(key)
  } catch (e) {
    return Response.json({ error: `Delete failed: ${e instanceof Error ? e.message : 'unknown'}` }, { status: 502 })
  }
  return Response.json({ ok: true })
}
