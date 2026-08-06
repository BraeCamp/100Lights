import { auth } from '@clerk/nextjs/server'
import { putObject } from '@/lib/r2'
import { sql } from '@/lib/db'

// Server-side upload proxy: the browser POSTs the file bytes here and WE PUT them
// to R2. This sidesteps browser CORS entirely (which blocks the direct
// presigned PUT when the bucket's CORS policy is missing/misconfigured). Used as
// a fallback by the client when the direct upload fails. Capped well under
// Vercel's request-body limit — big files must still go direct-to-R2 (+ CORS).
const MAX_PROXY_BYTES = 4 * 1024 * 1024

let uploadLogReady = false
async function ensureUploadLog() {
  if (uploadLogReady) return
  await sql`
    CREATE TABLE IF NOT EXISTS upload_log (
      user_id TEXT NOT NULL, key TEXT NOT NULL,
      size BIGINT NOT NULL DEFAULT 0, at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`
  await sql`CREATE INDEX IF NOT EXISTS upload_log_user_idx ON upload_log (user_id)`
  uploadLogReady = true
}

const EXT_OK = new Set(['.mp4', '.mov', '.webm', '.mkv', '.avi', '.m4v', '.mp3', '.wav', '.flac', '.aac', '.m4a', '.ogg', '.opus'])

export async function POST(req: Request) {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const mediaId = (req.headers.get('x-media-id') || '').trim()
  const ext = (req.headers.get('x-ext') || '').trim().toLowerCase()
  const contentType = req.headers.get('content-type') || 'application/octet-stream'
  if (!mediaId) return Response.json({ error: 'Missing media id' }, { status: 400 })
  if (!contentType.startsWith('audio/') && !contentType.startsWith('video/'))
    return Response.json({ error: `Only audio/video uploads are allowed (got "${contentType}")` }, { status: 415 })
  if (!EXT_OK.has(ext)) return Response.json({ error: `Unsupported file type (${ext || 'unknown'})` }, { status: 415 })

  const buf = new Uint8Array(await req.arrayBuffer())
  if (buf.byteLength === 0) return Response.json({ error: 'Empty upload' }, { status: 400 })
  if (buf.byteLength > MAX_PROXY_BYTES)
    return Response.json({ error: 'File too large for server upload — needs direct-to-R2 (configure CORS).' }, { status: 413 })

  // Key MUST match the presign route's scheme so signed-url / library lookups line up.
  const key = `${userId}/${mediaId}${ext}`
  try {
    await putObject(key, buf, contentType)
  } catch (e) {
    return Response.json({ error: `Storage write failed: ${String(e)}` }, { status: 502 })
  }

  // Account for it AFTER the write succeeds (unlike presign, which logs
  // optimistically), deduped by key so re-uploads don't accumulate.
  try {
    await ensureUploadLog()
    await sql`DELETE FROM upload_log WHERE user_id = ${userId} AND key = ${key}`
    await sql`INSERT INTO upload_log (user_id, key, size) VALUES (${userId}, ${key}, ${buf.byteLength})`
  } catch { /* accounting is best-effort */ }

  return Response.json({ key })
}
